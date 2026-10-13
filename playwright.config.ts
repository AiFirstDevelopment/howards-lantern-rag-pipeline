import { createHash } from 'node:crypto'
import { defineConfig } from '@playwright/test'

/**
 * Where this run's four servers listen, offset so two runs cannot collide.
 *
 * The ports used to be the literals 4174/4175/4176. With `reuseExistingServer`
 * below, that made a second concurrent run do one of two things, and the quiet
 * one is the dangerous one: fail every test with ECONNREFUSED after the first
 * run's servers went away, or **adopt the first run's servers and report green
 * against a bundle it never built**. Both happened on 2026-09-16, when two
 * agents building different states ran the suite at once — one of them killed
 * the other's preview servers while diagnosing what it thought were real
 * failures.
 *
 * `reuseExistingServer` is false everywhere below, and that is load-bearing
 * rather than tidy. Reuse is what turns a port clash from a refusal into a
 * silent wrong answer: a run whose neighbour is already answering on its port
 * adopts that neighbour's server and tests a bundle it never built. A derived
 * offset makes a clash rarer without making it impossible, so with reuse off a
 * clash is always EADDRINUSE -- a refusal somebody reads -- and never a green
 * suite about the wrong tree. The cost is that a warm server is never adopted,
 * a few seconds per local run.
 *
 * The offset is derived from the working directory rather than passed in,
 * because anything requiring coordination is a rule somebody forgets: two
 * checkouts of this repo get different ports without being told to. CI pins
 * offset 0 so its logs and any port-specific tooling stay predictable, and it
 * runs one job at a time anyway. `E2E_PORT_OFFSET` overrides both, for the case
 * where a person needs to know the number before the run starts.
 *
 * Kept off 4173: that is vite preview's own default and so the port a
 * developer's `npm run preview` occupies, which `reuseExistingServer` would
 * happily adopt — built from whatever env that terminal had. That has happened:
 * a preview built without VITE_API_BASE made every paywall test fail against a
 * dormant paywall.
 */
/**
 * The offset a given working directory gets, as a function of that directory.
 *
 * Exported and pure so the guard in tests/unit/e2e-ports.test.ts can sample
 * hundreds of directories by calling it, rather than re-importing this module
 * once per sample behind `vi.resetModules()`. Two hundred module reloads took
 * ~1.9s alone and over 5s under the rest of the suite, so the guard timed out
 * intermittently -- a loop of N operations against a fixed timeout, which is
 * the same flake already removed twice from this suite. A test that goes red
 * for a reason unrelated to what it guards is a test people learn to re-run.
 *
 * Steps of 4, because this config binds *four* ports and not three. At a
 * stride of 3 an offset-3 run put its `vite preview` on 4177 -- which is the
 * dev server's port, both its own and every other run's -- and
 * `reuseExistingServer` would then adopt a `vite` dev server as though it were
 * a preview of the built bundle. That fails quietly rather than loudly: both
 * answer HTTP at /, so the suite would run green against unbuilt source.
 */
export function portOffsetFor(cwd: string): number {
  const digest = createHash('sha256').update(cwd).digest()
  // 250 blocks, not 25. At 25 the space was small enough that two of the three
  // worktrees open on this machine hashed to the same offset on the first day
  // -- `wt-nh` and `wt-mo` both landed on 68, so the two states being built in
  // parallel ran their suites against one another's servers, and one of them
  // recorded 511 e2e errors that were all ERR_CONNECTION_REFUSED on 4242.
  // 250 blocks keep the four ports inside 4174-5173, which is unassigned.
  return (digest.readUInt16BE(0) % 250) * 4
}

const PORT_OFFSET = (() => {
  const explicit = process.env.E2E_PORT_OFFSET
  if (explicit !== undefined) return Number(explicit)
  if (process.env.CI) return 0
  return portOffsetFor(process.cwd())
})()

const PORT = 4174 + PORT_OFFSET
const BASE_URL = `http://localhost:${PORT}`

// A second build of the same app, with analytics configured and the paywall's
// variable deliberately absent. It exists to hold one line: the two switches
// are independent. Sending analytics to VITE_API_BASE would have turned the
// paywall on in a production deployed without it on purpose, charging learners
// as a side effect of wanting a number, and nothing else in the suite could
// see that -- the main build sets both.
const DORMANT_PORT = 4175 + PORT_OFFSET
export const DORMANT_URL = `http://localhost:${DORMANT_PORT}`
const DORMANT_DIST = 'dist-dormant'

// Its own output directory, and NOT dist/ -- which is what `npm run deploy`
// builds and ships.
//
// This suite used to serve dist/, and that quietly aimed the whole thing at
// production. `reuseExistingServer` below adopts a preview server that is
// already up; `npm run deploy` rebuilds dist/ from .env.production, where
// VITE_ANALYTICS_BASE is the real worker. A server started by an earlier test
// run therefore went on serving the deploy's files, and the next run drove 150
// tests through a bundle that reported for real -- filling the production
// tables with `unhandled boom` and every fixture comment in feedback.spec.ts.
//
// Two builds writing dist/ was the whole of it, so they no longer share one.
const E2E_DIST = 'dist-e2e'

/**
 * A notice address that is plainly not one, for the builds that serve the
 * agreement. The real one is not in this repository; see `agreementAsShown` in
 * src/partners/Portal.tsx.
 */
export const E2E_NOTICE_ADDRESS = 'PO Box 0000, Testville, MD 00000'

/**
 * A third server, and the only one that is not `vite preview`.
 *
 * Every other suite here drives the app, and for that a static server is a
 * static server. One suite does not: tests/e2e/routing.spec.ts is about what
 * the *host* does with an address, and the two hosts disagree in exactly the
 * places that matter.
 *
 * `vite preview` answers `/drivers/MD` from its SPA fallback with a 200 and the
 * landing page. Cloudflare Pages answers it with a 308 to `/drivers/MD/`, and
 * answers an address it cannot match with a 404 from 404.html. Those are the
 * two behaviours the prerendered build depends on, and a suite that only ever
 * asked `vite preview` said everything was fine while every canonical tag on
 * the site pointed at a redirect.
 *
 * So this one runs the real Pages asset server, and gets its own build
 * directory for the reason recorded above: two builds sharing one output race.
 */
const PAGES_PORT = 4176 + PORT_OFFSET
const PAGES_URL = `http://localhost:${PAGES_PORT}`
const PAGES_DIST = 'dist-e2e-pages'
/**
 * The two suites that must run against Cloudflare's own asset server.
 *
 * routing.spec.ts is about status codes and redirects, which is what this
 * server exists for. portal.spec.ts joins it for a narrower reason: the partner
 * portal is a second bundle at a real directory, and `vite preview` answers
 * `/partners/login` from its SPA fallback with the *study app* -- so every
 * emailed link would appear to work under one server and land on the wrong page
 * under the other, which is exactly the class of failure this project was added
 * to catch.
 *
 * published-states.spec.ts joins them for a different reason: it is the only
 * spec about the manifest production actually ships. The other two app servers
 * build with `E2E_ALTERNATE_STATE=1`, which appends the synthetic states so the
 * picker and every multi-state assertion stay exercised whatever the manifest
 * says -- and that same appending makes them blind to what it actually says,
 * because a picker appears either way. This server builds from
 * `resource/manifest.json` untouched.
 *
 * admin.spec.ts joins them for the same reason as portal.spec.ts: `/admin` is a
 * third bundle at a real directory, and "does not reach the study app" is a
 * claim about what the *host* does with that address. Asking `vite preview`
 * would answer it from the SPA fallback and prove nothing. kb-editor.spec.ts is
 * the same bundle at the same address, and joins for the same reason.
 * sales-rep.spec.ts is the partner bundle copied to `/sales-rep`, and joins
 * for the reason portal.spec.ts did.
 */
const PAGES_SPECS = /(routing|portal|admin|kb-editor|published-states|sales-rep)\.spec\.ts/

// The dev server: no build, no env, exactly what a developer types.
const DEV_PORT = 4177 + PORT_OFFSET
const DEV_URL = `http://localhost:${DEV_PORT}`
const DEV_SPEC = /dev-server\.spec\.ts$/

/**
 * Every port this config binds, so a test can hold them to being distinct.
 *
 * Exported rather than re-derived in the test, because a test that recomputed
 * the offset from its own copy of the arithmetic would agree with itself while
 * disagreeing with the servers -- which is how the stride bug survived: the
 * comment said three ports and the file bound four.
 */
export const E2E_PORTS = {
  app: PORT,
  dormant: DORMANT_PORT,
  pages: PAGES_PORT,
  dev: DEV_PORT,
} as const


// Behavioral suite: drives the production build through a real browser at the
// 375px mobile viewport the acceptance criteria are written against.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  // Two projects because they need two servers. Everything that drives the app
  // runs against `vite preview`, exactly as before; the two suites that are
  // about what the *host* does with an address run against Cloudflare's own
  // asset server.
  projects: [
    { name: 'app', testIgnore: [PAGES_SPECS, DEV_SPEC], use: { baseURL: BASE_URL } },
    /**
     * The study pass again, with focus mode already on.
     *
     * AC6 of the motion change says the flows behave *exactly* as they do with
     * the switch off -- "every existing e2e assertion about those flows passes
     * unchanged". A bespoke test written alongside the feature cannot say that
     * about assertions it was written next to; the only thing that can is the
     * spec that was already there, re-driven with the preference seeded. So
     * this project runs the three flow specs AC6 names -- the study pass and its
     * quiz, the restudy walk, and the full test -- a second time, and changes
     * nothing else about them.
     *
     * Seeded through `storageState` rather than `addInitScript`, which is what
     * lets an existing spec be reused without editing a line of it. It carries
     * localStorage only, so the `seed()` helper's sessionStorage marker still
     * applies exactly once per test, as it does in the `app` project.
     */
    {
      name: 'app-focus',
      testMatch: /(study|restudy|test-flow)\.spec\.ts$/,
      use: {
        baseURL: BASE_URL,
        storageState: {
          cookies: [],
          origins: [
            {
              origin: BASE_URL,
              localStorage: [{ name: 'teach-and-test/v1/focus-mode', value: '1' }],
            },
          ],
        },
      },
    },
    { name: 'routing', testMatch: PAGES_SPECS, use: { baseURL: PAGES_URL } },
    /**
     * The dev server, which no other project here can speak for.
     *
     * Everything else builds first, and a build goes through Rollup. `vite`
     * resolves modules itself and disagrees with Rollup about how a
     * root-relative specifier is spelled -- which is how `npm run dev` came to
     * be broken from the day the corpus plugin was written while the whole
     * suite stayed green. One spec, one page, and it costs a server that boots
     * in about a third of a second because it builds nothing.
     */
    { name: 'dev', testMatch: DEV_SPEC, use: { baseURL: DEV_URL } },
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 375, height: 700 },
    deviceScaleFactor: 2,
    hasTouch: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        `npx vite build --outDir ${E2E_DIST} && ` +
        `npx vite preview --outDir ${E2E_DIST} --port ${PORT} --strictPort`,
      // The paywall worker lives on its own origin. Pointing the build at an
      // unroutable host means the entitlement check fails closed in every suite
      // that does not deliberately stub it, which is what an offline visitor sees.
      //
      // Analytics gets the same treatment, for a stronger reason: it is
      // fire-and-forget, so an unreachable analytics origin must be invisible.
      // Pointing every suite at one means the whole suite proves that, rather
      // than one test claiming it.
      env: {
        ...process.env,
        VITE_API_BASE: 'https://paywall.test.invalid',
        VITE_ANALYTICS_BASE: 'https://analytics.test.invalid',
        // The app reports nothing from localhost unless a build says it may,
        // and only these two builds say so. They are aimed at a host that
        // cannot resolve, so what they report goes nowhere by construction.
        VITE_ANALYTICS_ALLOW_LOCAL: '1',
        // An ads account that does not exist, because this is the one thing the
        // suite sends that cannot be aimed at an unroutable host: gtag.js is
        // fetched from Google's own domain or not at all.
        //
        // `.env.production` carries the real account and `vite build` reads that
        // file, so leaving this out would build the suite's bundle with it --
        // and `asPublishedSite` serves that bundle under howardslantern.com,
        // which is exactly the hostname the tag is waiting for. Every CI run
        // would have loaded a live ads account. Empty would also be safe and is
        // worse: it would make the tag untestable, which is how the conversion
        // that never fires gets found in the dashboard a month later.
        VITE_ADS_ID: 'AW-0000000000',
        VITE_ADS_PURCHASE_LABEL: 'e2ePurchase',
        VITE_ADS_PASS_LABEL: 'e2ePass',
        VITE_PARTNER_NOTICE_ADDRESS: E2E_NOTICE_ADDRESS,
        // Open, though `.env.production` says `suspended` and `vite build` reads
        // that file. The twenty-odd tests that reach the partner page through the
        // strip or the menu are this build's, and they stay true of a programme
        // that is recruiting: re-opening is one line, and on that day nothing
        // else should have rotted. The dormant build below holds the suspended
        // state, which is what production ships.
        VITE_PARTNER_PROGRAM: 'open',
        E2E_ALTERNATE_STATE: '1',
        // A synthetic Spanish pack for the Test State, so every Spanish screen
        // is driven by exact string (docs/plans/spanish-app.md, §7). Maryland
        // keeps its real pack beside it (docs/plans/spanish-md.md, §11).
        E2E_SPANISH_FIXTURE: '1',
      },
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Its own output directory: two builds writing dist/ would race, and the
      // whole point of this one is that it was built from different env.
      command:
        `npx vite build --outDir ${DORMANT_DIST} && ` +
        `npx vite preview --outDir ${DORMANT_DIST} --port ${DORMANT_PORT} --strictPort`,
      env: {
        ...process.env,
        // Empty, not absent-from-the-object: process.env is spread in above.
        VITE_API_BASE: '',
        VITE_ANALYTICS_BASE: 'https://analytics.test.invalid',
        VITE_ANALYTICS_ALLOW_LOCAL: '1',
        // Off, for the reason above: this build is never served under the
        // published name, so a real account here could only ever be a mistake.
        VITE_ADS_ID: '',
        // Empty on purpose: this is the build that proves a deployment with no
        // notice address refuses to show the agreement rather than showing the
        // placeholder. See tests/e2e/partner-agreement.spec.ts.
        VITE_PARTNER_NOTICE_ADDRESS: '',
        // Suspended, the production value, written here rather than inherited
        // from `.env.production` so that re-opening production cannot silently
        // turn this build's guards into tests of an open programme. See
        // tests/e2e/partner-suspended.spec.ts.
        VITE_PARTNER_PROGRAM: 'suspended',
        E2E_ALTERNATE_STATE: '1',
        // No pack at all, though the real manifest declares Maryland: this is
        // the build where "a build with no pack shows nothing" is proved
        // (spanish-app guards 8 and 14), the shape production has whenever a
        // pack is pulled.
        E2E_NO_SPANISH: '1',
      },
      url: DORMANT_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // No build step, and no env: this is `npm run dev` as a developer runs
      // it, which is the whole point of watching it. It boots in a fraction of
      // a second precisely because it bundles nothing.
      command: `npx vite --port ${DEV_PORT} --strictPort`,
      url: DEV_URL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // `wrangler pages dev` runs Cloudflare's asset server and this
      // repository's own functions/ against a real build -- the middleware
      // included, which `vite preview` never loads at all.
      //
      // Its own output directory, for the same reason as the two above: these
      // servers start in parallel, and one building into a directory another is
      // serving is a race with a green suite as its usual outcome.
      command:
        `npx vite build --outDir ${PAGES_DIST} && ` +
        `npx wrangler pages dev ${PAGES_DIST} --port ${PAGES_PORT} ` +
        `--compatibility-date=2026-05-01 --log-level=warn`,
      // Same reason as the app build above: `.env.production` carries the real
      // account, and nothing here should be able to reach it.
      // No fixture pack: this build is the real manifest, which declares
      // Maryland, so the portal's Spanish link for a Maryland code and its
      // refusal for Virginia are the production behaviour (spanish-md.md, §11).
      env: {
        ...process.env,
        VITE_ADS_ID: '',
        VITE_PARTNER_NOTICE_ADDRESS: E2E_NOTICE_ADDRESS,
      },
      url: `${PAGES_URL}/`,
      reuseExistingServer: false,
      // Longer than the others: this one boots workerd, not a file server.
      timeout: 180_000,
    },
  ],
})
