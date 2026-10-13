import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { comparedCsvPath } from './seo/pages'
import { prerender } from './seo/prerender'
import tailwindcss from '@tailwindcss/vite'
import { topicCsvs } from './scripts/statutes/csv'
import { publishedLawsOf, readCoverage, topicLawsFrom, topicsOf } from './scripts/statutes/laws'
import { publishedStateChips } from './scripts/state-chips-files'
import { lawsPath, type AskLaw } from './worker/src/law-retrieval'
import { topicPath, topicsPath } from './worker/src/law-topics'

const CORPUS_ID = 'virtual:corpus'
const RESOLVED_CORPUS_ID = `\0${CORPUS_ID}`
const MANIFEST = 'resource/manifest.json'
/** scripts/chips.ts's CHIP_ANSWERS_FILE, read here without importing the build's model client into Vite's config. */
const CHIP_ANSWERS = 'resource/chips-answers.json'

interface ManifestState {
  code: string
  name: string
  exam: { questions: number; passMark: number }
  spanish?: boolean
}
interface Manifest {
  products: { id: string; states: ManifestState[] }[]
}

/**
 * The synthetic state the browser suite assembles the app with: Maryland's
 * laws under a different name, a different question count and a different pass
 * mark. It goes into the manifest as well as the corpus, because the manifest
 * is what the state picker is built from -- a state that existed only in the
 * corpus could never be chosen, and the suite would be proving nothing.
 *
 * **Published on purpose.** Production offers one state today and conceals the
 * other three (docs/plans/maryland-only.md), which would take the picker, the
 * per-state landing page and every multi-state assertion out of the suite along
 * with them -- and a capability that ships untested is one that has quietly
 * stopped working by the time it is wanted back. These two keep the app build
 * at three published states, so all of it stays exercised. The single-state
 * shape production actually serves is proved separately, against the Pages
 * build, which is assembled from the real manifest: tests/e2e/maryland-only.spec.ts.
 */
const ALTERNATE_STATE = `
  const alternate = async () => {
    const source = structuredClone(await corpus['drivers/MD']())
    source.metadata.stateName = 'Test State'
    source.metadata.knowledgeTest.questions = 7
    source.metadata.knowledgeTest.passMark = 5
    return source
  }
  corpus['drivers/TS'] = alternate
  manifest.products
    .find((product) => product.id === 'drivers')
    .states.push({ code: 'TS', name: 'Test State', published: true, exam: { questions: 7, passMark: 5 } })
`

/**
 * The second synthetic state: the same laws again, but a paper scored in two
 * parts rather than one.
 *
 * It exists because a flat exam and a sectioned one cannot both be proved by
 * one fixture, and the sectioned case is the one that can fail silently — a
 * run that draws its questions from the whole pool still looks like a
 * full-length test, and still reports a score. Its parts are derived from the
 * source state's own pictorial concepts rather than listed here, so it stays a
 * partition of whatever that corpus actually carries.
 */
const SECTIONED_STATE = `
  const sectioned = async () => {
    const state = structuredClone(await corpus['drivers/MD']())
    state.metadata.stateName = 'Two-Part State'
    const pictorial = new Set(state.metadata.signImagery.pictorialConcepts)
    const pooled = [...new Set(state.laws.filter((law) => law.inPool).map((law) => law.concept))]
    state.metadata.knowledgeTest.questions = 8
    state.metadata.knowledgeTest.passMark = 7
    state.metadata.knowledgeTest.sections = [
      {
        id: 'signs',
        name: 'Road signs',
        questions: 3,
        passMark: 3,
        concepts: pooled.filter((concept) => pictorial.has(concept)),
      },
      {
        id: 'general',
        name: 'General knowledge',
        questions: 5,
        passMark: 4,
        concepts: pooled.filter((concept) => !pictorial.has(concept)),
      },
    ]
    return state
  }
  corpus['drivers/TP'] = sectioned
  manifest.products
    .find((product) => product.id === 'drivers')
    .states.push({ code: 'TP', name: 'Two-Part State', published: true, exam: { questions: 8, passMark: 7 } })
`

/**
 * The third synthetic state: a paper whose parts carry floors rather than bars,
 * so the whole thing is scored on its total.
 *
 * The two-part fixture above cannot prove this one. Under its rule every part
 * has a bar and the total is their sum, so checking the parts checks the total
 * and a run that missed the total by itself cannot exist. New York's paper is
 * the other shape -- "at least 14 of the 20 questions asked, but you must
 * correctly answer two of the four questions about road signs" -- where the bar
 * is over the whole paper and only one part carries a minimum. The general part
 * here takes a floor of zero for that reason: it is the part with no minimum,
 * and a fixture that gave it one would not be the shape under test.
 */
const TOTAL_SCORED_STATE = `
  const totalScored = async () => {
    const state = structuredClone(await corpus['drivers/MD']())
    state.metadata.stateName = 'Whole-Paper State'
    const pictorial = new Set(state.metadata.signImagery.pictorialConcepts)
    const pooled = [...new Set(state.laws.filter((law) => law.inPool).map((law) => law.concept))]
    state.metadata.knowledgeTest.questions = 8
    state.metadata.knowledgeTest.passMark = 6
    state.metadata.knowledgeTest.passRule = 'total'
    state.metadata.knowledgeTest.sections = [
      {
        id: 'signs',
        name: 'Road signs',
        questions: 3,
        passMark: 2,
        concepts: pooled.filter((concept) => pictorial.has(concept)),
      },
      {
        id: 'general',
        name: 'General knowledge',
        questions: 5,
        passMark: 0,
        concepts: pooled.filter((concept) => !pictorial.has(concept)),
      },
    ]
    return state
  }
  corpus['drivers/TW'] = totalScored
  manifest.products
    .find((product) => product.id === 'drivers')
    .states.push({ code: 'TW', name: 'Whole-Paper State', published: true, exam: { questions: 8, passMark: 6 } })
`

/**
 * The fourth synthetic state: a paper scored in parts whose parts are not on
 * one footing -- the signs part is the state's own figures, and the general
 * part is a length this app chose at the state's rate.
 *
 * North Carolina's shape. The two-part fixture above cannot prove it, because
 * there every figure is the state's and nothing is disclosed; and a flat paper
 * with a chosen count cannot either, because its disclosure is about the
 * whole paper. What this fixture has to show is the disclosure naming the
 * PART, at that part's own rate, and crediting the other part to the state.
 * The sources are placeholders a spec can read back whole.
 */
const MIXED_STATE = `
  const mixed = async () => {
    const state = structuredClone(await corpus['drivers/MD']())
    state.metadata.stateName = 'Mixed-Part State'
    const pictorial = new Set(state.metadata.signImagery.pictorialConcepts)
    const pooled = [...new Set(state.laws.filter((law) => law.inPool).map((law) => law.concept))]
    state.metadata.knowledgeTest.questions = 8
    state.metadata.knowledgeTest.passMark = 7
    state.metadata.knowledgeTest.sections = [
      {
        id: 'signs',
        name: 'Road signs',
        questions: 3,
        passMark: 3,
        concepts: pooled.filter((concept) => pictorial.has(concept)),
      },
      {
        id: 'general',
        name: 'General knowledge',
        questions: 5,
        passMark: 4,
        concepts: pooled.filter((concept) => !pictorial.has(concept)),
      },
    ]
    state.metadata.knowledgeTest.shapeBasis = {
      questions: 'chosen',
      passMark: 'stated',
      source: 'Rule 1',
      parts: { signs: { questions: 'stated', passMark: 'stated', source: 'Rule 2' } },
    }
    return state
  }
  corpus['drivers/TM'] = mixed
  manifest.products
    .find((product) => product.id === 'drivers')
    .states.push({ code: 'TM', name: 'Mixed-Part State', published: true, exam: { questions: 8, passMark: 7 } })
`

/**
 * A synthetic Spanish pack for the Test State, so the browser suite can drive
 * every Spanish screen by exact string (docs/plans/spanish-app.md, §7).
 *
 * The Test State is marked `spanish` and its pack is generated from its own
 * English file by `syntheticPack`: every translatable string prefixed `[es] `,
 * which no English corpus contains, so a Spanish screen showing a string
 * without it is showing English. Only the `app` build sets it, and only
 * alongside E2E_ALTERNATE_STATE, which is what creates the Test State.
 *
 * It was Maryland until Maryland had a real pack (docs/plans/spanish-md.md,
 * §11). Maryland's real loader is left alone here, because a fixture that
 * replaced it is exactly how the fake pack would reach a real state's screens
 * with every Spanish spec green.
 */
const SPANISH_FIXTURE = `
  manifest.products
    .find((product) => product.id === 'drivers')
    .states.find((state) => state.code === 'TS').spanish = true
  packs['drivers/TS'] = async () => syntheticPack(await corpus['drivers/TS']())
`

/**
 * The application depends on a corpus, not on one particular JSON file.
 *
 * What it gets is two things that are deliberately not the same thing: the
 * manifest -- which products exist, what they are called, and which states
 * each one carries -- and a loader for one state's laws. The manifest is
 * kilobytes and the welcome screen needs all of it; the laws are hundreds of
 * kilobytes per state and nothing needs them until somebody picks one.
 *
 * Every state named in the manifest gets a loader here, not an import, so
 * Rollup emits one chunk per state and `loadCorpus` fetches a state's laws the
 * first time somebody asks for that state. It was an import per state until
 * seven of them made a first visit 1.95 MB decoded (#247); the promise this
 * function has always returned is what made that a change to one function
 * rather than to every screen that reads a law.
 *
 * The keys are still derived from the manifest rather than from the directory,
 * so a state declared with no corpus file still fails the build rather than
 * failing the first learner who picks it.
 *
 * Production supplies the checked-in manifest. The browser suite supplies that
 * same manifest plus two deliberately different synthetic states -- one with
 * another question count and pass mark, one whose paper is scored in parts --
 * allowing the fully assembled application to prove that state addition is
 * data-only for both shapes.
 */
function corpus(): Plugin {
  return {
    name: 'corpus',
    /**
     * Each state's retrieval file for the ask box, at `/ask-laws/<CODE>.json`
     * (docs/plans/learner-ask-law.md, decision 1). Emitted by the build that
     * bundles the cards, from the same corpus files, so the law and citation the
     * box quotes are the ones the cards render in the same deploy. The worker
     * fetches the one it was asked about; a state missing here answers road law
     * with `no-laws`, never without its laws.
     */
    generateBundle() {
      const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
      const published = new Map<string, AskLaw[]>()
      for (const product of manifest.products) {
        if (product.id !== 'drivers') continue
        for (const state of product.states) {
          // The state's code, where it has been sourced, after the manual: Maryland's
          // hand-written laws and the chunked sections (docs/plans/vehicle-code.md);
          // then its own pages' passages (docs/plans/what-happens-if.md, phase 3).
          const laws = publishedLawsOf(process.cwd(), state.code)
          published.set(state.code, laws)
          this.emitFile({ type: 'asset', fileName: lawsPath(state.code).slice(1), source: JSON.stringify(laws) })
        }
      }
      // Every state's verdict law per topic, for a nationwide question
      // (docs/plans/nationwide.md, decision 1): the worker cannot read fifty-one
      // state files for one question, so the build writes the one law per state
      // it needs -- from the very lists emitted above, so a topic file cannot
      // quote a law its state's file does not hold. The list names only topics
      // with a file, so the worker never chooses one that 404s.
      const topicLaws = topicLawsFrom(topicsOf(process.cwd()), readCoverage(process.cwd()), (code) => {
        const laws = published.get(code)
        if (laws === undefined) throw new Error(`${code} has verdicts but no published laws`)
        return laws
      })
      const topics = topicsOf(process.cwd()).filter((topic) => topicLaws.has(topic.id))
      this.emitFile({ type: 'asset', fileName: topicsPath().slice(1), source: JSON.stringify(topics) })
      for (const [id, laws] of topicLaws) {
        this.emitFile({ type: 'asset', fileName: topicPath(id).slice(1), source: JSON.stringify(laws) })
      }
      // The same laws as a CSV beside each comparison page
      // (docs/plans/trusted-by-date.md, decision 9), from the lists above, so
      // the download and the table it sits under cannot disagree.
      for (const [id, csv] of topicCsvs(process.cwd(), topicLaws)) {
        this.emitFile({ type: 'asset', fileName: comparedCsvPath('drivers', id).slice(1), source: csv })
      }
      // The chips' stored answers (docs/plans/trusted-by-date.md, decision
      // 17), in the shape the box draws, fetched by src/chips.ts only when
      // Nationwide is ticked. The build's corpus fields stay behind: the box
      // needs the answer, not the hash it was checked against.
      const chips = existsSync(CHIP_ANSWERS)
        ? (JSON.parse(readFileSync(CHIP_ANSWERS, 'utf8')) as { chips: Record<string, unknown>[] }).chips
        : []
      this.emitFile({
        type: 'asset',
        fileName: 'ask-laws/chips.json',
        source: JSON.stringify(chips.map(({ id, lang, question, answer, sources, absent, asOf }) => ({ id, lang, question, answer, sources, absent, asOf }))),
      })
      // Each state's chips (docs/plans/what-happens-if.md, decision 24), one
      // file a state, fetched by src/chips.ts for the state being answered
      // for. The citations are built from the committed rows the state's
      // laws file above is built from, so a chip cannot show a citation the
      // box would not. A state with none stored has no file: its row is empty.
      for (const code of published.keys()) {
        const stored = publishedStateChips(process.cwd(), code)
        if (stored.length > 0) this.emitFile({ type: 'asset', fileName: `ask-laws/chips/${code}.json`, source: JSON.stringify(stored) })
      }
    },
    /**
     * The virtual module, and the data files it imports by root-relative path.
     *
     * The second half is what made `npm run dev` fail from the day this plugin
     * was written. The module below emits `import s0 from "/resource/corpus/..."`,
     * and Rollup resolves those against the project root during a build -- so
     * every build, every preview and the whole test suite were green while the
     * documented dev server had never once started. Vite's dev server cannot:
     * a virtual module's id begins with a NUL and has no directory, so there is
     * nothing for a root-relative specifier to be relative *to*, and it comes
     * back as "Failed to resolve import resource/manifest.json".
     *
     * Resolving them here rather than emitting absolute filesystem paths from
     * `load`: a baked `/Users/somebody/...` would work on the machine that built
     * it and is exactly the kind of thing that ships.
     *
     * **With and without the leading slash, because the two resolvers disagree
     * about it.** The module emits `/resource/...`; Rollup hands that specifier
     * to this hook exactly as written, and Vite's dev import-analysis strips
     * the slash first and asks for `resource/...` -- it reads a leading slash
     * as a root-relative *URL* and has already made it relative before any
     * plugin sees it. Matching only the slashed spelling is why this hook
     * existed, ran on every dev request, and resolved nothing: the fix written
     * for this bug never fired against the one resolver that had it.
     */
    resolveId(id, importer) {
      if (id === CORPUS_ID) return RESOLVED_CORPUS_ID
      if (importer === RESOLVED_CORPUS_ID) {
        const relative = id.startsWith('/') ? id.slice(1) : id
        // Narrow on purpose: this hook speaks for the data files the generated
        // module imports and for nothing else that may one day be added to it.
        // The one source module is the pack overlay, which the loader below
        // calls: it is typed, unit-tested code, and a copy of it written into
        // this template would be a second overlay nobody tests.
        if (relative.startsWith('resource/') || relative === 'src/data/pack.ts') {
          return path.resolve(process.cwd(), relative)
        }
      }
      return null
    },
    load(id) {
      if (id !== RESOLVED_CORPUS_ID) return null
      // Read rather than imported, because the emitted module's own import list
      // is derived from it: a state added to the manifest must be bundled by
      // the same edit that declares it, or it would list a state that cannot
      // be loaded.
      const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
      this.addWatchFile(MANIFEST)
      const pairs = manifest.products.flatMap((product) =>
        product.states.map((state) => ({ product: product.id, code: state.code })),
      )
      // A loader per state rather than an import per state. Rollup gives each
      // `import()` its own chunk, so a state's laws are fetched the first time
      // somebody asks for that state and never otherwise -- which is the whole
      // of issue #247. The keys are still every state the manifest names, so a
      // declared state with no file still fails the build.
      const entries = pairs.map(
        ({ product, code }) =>
          `  [${JSON.stringify(`${product}/${code}`)}]: () => import(${JSON.stringify(
            `/resource/corpus/${product}/${code}.json`,
          )}).then((m) => m.default),`,
      )
      // A second loader for each state the manifest declares `spanish`, and
      // for no other: a pack file nobody declares is not bundled, and a
      // declaration with no file fails the build here exactly as a state with
      // no corpus does -- rather than failing the first learner who switches.
      //
      // E2E_NO_SPANISH clears every declaration: the dormant build of the
      // browser suite is where "a build with no pack shows nothing" is proved,
      // and once the real manifest declares a state that build would otherwise
      // carry a pack like every other. Clearing it here, where the loaders are
      // made, gives it the exact shape production has when a pack is pulled.
      const noSpanish = process.env.E2E_NO_SPANISH === '1'
      const packEntries = manifest.products.flatMap((product) =>
        product.states
          .filter((state) => state.spanish === true && !noSpanish)
          .map(
            (state) =>
              `  [${JSON.stringify(`${product.id}/${state.code}`)}]: () => import(${JSON.stringify(
                `/resource/corpus/${product.id}/es/${state.code}.json`,
              )}).then((m) => m.default),`,
          ),
      )
      const spanishFixture = process.env.E2E_SPANISH_FIXTURE === '1' && process.env.E2E_ALTERNATE_STATE === '1'
      return [
        `import rawManifest from ${JSON.stringify(`/${MANIFEST}`)}`,
        `import { overlayPack${spanishFixture ? ', syntheticPack' : ''} } from "/src/data/pack.ts"`,
        'const corpus = {',
        ...entries,
        '}',
        'const packs = {',
        ...packEntries,
        '}',
        'const manifest = structuredClone(rawManifest)',
        noSpanish
          ? 'for (const product of manifest.products) for (const state of product.states) delete state.spanish'
          : '',
        process.env.E2E_ALTERNATE_STATE === '1'
          ? ALTERNATE_STATE + SECTIONED_STATE + TOTAL_SCORED_STATE + MIXED_STATE
          : '',
        spanishFixture ? SPANISH_FIXTURE : '',
        'export const productManifest = manifest',
        'export async function loadCorpus(product, state, lang = "en") {',
        '  const entry = corpus[`${product}/${state}`]',
        '  if (entry === undefined) throw new Error(`No corpus for ${product}/${state}`)',
        '  if (lang === "en") return await entry()',
        '  const pack = packs[`${product}/${state}`]',
        '  if (lang !== "es" || pack === undefined) throw new Error(`No ${lang} pack for ${product}/${state}`)',
        '  const [english, translated] = await Promise.all([entry(), pack()])',
        '  return overlayPack(english, translated)',
        '}',
      ].join('\n')
    },
  }
}

/**
 * The commit this bundle was built from, stamped into it so a minified stack
 * frame reported from production can be matched to the source that produced it.
 * Never fatal: a build outside a git checkout is still a valid build.
 */
function release(): string {
  if (process.env.VITE_RELEASE !== undefined) return process.env.VITE_RELEASE
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

/**
 * The addresses the partner portal answers at, as real files.
 *
 * The portal is one bundle with its own routing, but Cloudflare Pages matches a
 * file by its exact name -- so `/partners/login`, which is where every emailed
 * link points, would be a 404 without a file at that path. This copies the
 * built `partners/index.html` into each of them, exactly as `prerender()` copies
 * the app's shell into one directory per state.
 *
 * Kept to the addresses that are actually linked from somewhere: an email, a
 * form, the agreement checkbox. Everything a signed-in partner moves between is
 * a tab inside one page, which needs no file at all.
 */
const PORTAL_ROUTES = ['login', 'apply', 'agreement', 'privacy']

/**
 * The shells the partner bundle is served at: the partners' own, and the sales
 * reps', which are the same bundle under a second name (docs/plans/sales-reps.md,
 * decision 7). Each prefix gets `dist/<prefix>/index.html` and one copy per
 * route, on the dev server and in the build alike -- a route missing from
 * either is the address that works in a demo and 404s in production.
 */
const PORTAL_SHELLS: readonly { prefix: string; routes: readonly string[] }[] = [
  { prefix: 'partners', routes: PORTAL_ROUTES },
  // `leads` and `follow-ups` because the desk and its list are where a rep
  // works all day, so they are addresses bookmarked, not tabs found again
  // every morning.
  { prefix: 'sales-rep', routes: ['login', 'apply', 'agreement', 'leads', 'follow-ups'] },
]

function portal(): Plugin {
  let outDir = 'dist'
  return {
    name: 'portal',
    /**
     * The same addresses, on the dev server, where no `closeBundle` ever runs.
     *
     * Without this the routes above exist only in `dist`: vite falls through to
     * the *app's* root index.html, so `/partners/agreement` renders the
     * learner's welcome page. That is the address the agreement checkbox links
     * to and the one every answer from the ask box cites, so the first click of
     * a demonstration left the portal and landed on a page about Maryland road
     * signs -- while production, which has the files, was correct the whole
     * time. A demo path that disagrees with production is the one place this
     * can hide.
     */
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = (request.url ?? '').split('?')[0]
        // Only the exact route addresses, never an asset: a single lowercase
        // segment, no dot, and a member of the list built above.
        const match = /^\/([a-z-]+)(?:\/([a-z-]+))?\/?$/.exec(url)
        const shell = PORTAL_SHELLS.find((each) => each.prefix === match?.[1])
        const route = match?.[2]
        if (shell !== undefined && (route === undefined || shell.routes.includes(route))) {
          request.url = '/partners/index.html'
        } else if (url === '/admin') {
          request.url = '/admin/index.html'
        }
        next()
      })
    },
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const shell = path.join(outDir, 'partners', 'index.html')
      const html = readFileSync(shell, 'utf8')
      for (const { prefix, routes } of PORTAL_SHELLS) {
        for (const route of ['', ...routes]) {
          const directory = path.join(outDir, prefix, route)
          mkdirSync(directory, { recursive: true })
          writeFileSync(path.join(directory, 'index.html'), html)
        }
      }
    },
  }
}

export { corpus }

export default defineConfig({
  // prerender() runs last and reads what the others produced: it stamps the
  // built index.html, hashed asset links and all, into one file per page.
  // portal() does the same job for the partner portal's own addresses.
  plugins: [corpus(), react(), tailwindcss(), prerender(), portal()],
  define: {
    'import.meta.env.VITE_RELEASE': JSON.stringify(release()),
  },
  build: {
    /**
     * Three entries, three bundles.
     *
     * The learner's bundle is already 750 KB and none of it should be a login
     * form; a partner signing in should not download Maryland's driving
     * material, and the operator's dashboard should not be in either of them.
     * Emitting `dist/partners/index.html` and `dist/admin/index.html` as real
     * files is also what makes Cloudflare Pages serve those addresses *before*
     * the SPA fallback -- the same mechanism that already reserves
     * `public/audio`, and the reason both names are in RESERVED_SEGMENTS.
     *
     * The admin bundle has no sub-addresses of its own: nothing links into it,
     * every screen is a tab inside one page, and there is no emailed link to
     * land on. So it needs no equivalent of `portal()` below, which exists only
     * because `/partners/login` is a real address in a real email.
     */
    rollupOptions: {
      input: {
        main: 'index.html',
        partners: 'partners/index.html',
        admin: 'admin/index.html',
      },
    },
    /**
     * Published, and referenced from the bundle.
     *
     * Not because a map is harmless -- it contains the whole source -- but
     * because the alternative was worse. Keeping maps only on the machine that
     * deployed meant symbolication silently degraded to unreadable minified
     * offsets anywhere else, which is exactly when you need it most. Served,
     * the map for any still-deployed release can be fetched by its own URL,
     * derived from the stack that needs it. See scripts/errors.mjs.
     *
     * The trade was made deliberately: this app's advantage is getting to
     * market, not hiding a bundle that anyone could reverse-engineer anyway,
     * and fixing crashes quickly is worth more than obscurity. It also means
     * browser devtools resolve properly on production.
     */
    sourcemap: true,
  },
})
