import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXCLUDED, MIRROR, PUBLIC_OWN, PUBLIC_REPO, isExcluded, mirror, openPullRequest, parseArgs, type Run } from '../../scripts/public-mirror'

/**
 * The public reading copy (docs/plans/eval-lifecycle-build.md, decision 40,
 * criterion 36). Two ways it fails without anybody seeing: a phase adds a
 * module the harness imports and not to the list, and the public
 * `learner-ask-eval.ts` stops resolving -- the 2026-10-13 snapshot already
 * lacked `worker/src/answer-register.ts`, found by this test; or a list entry
 * publishes what the public README says is left out, a key or the partner
 * book, and nothing can take a push to a public repository back.
 */

const ROOT = process.cwd()

/**
 * The modules whose import closure the public copy must hold: the harness,
 * this phase's new worker modules and the handler that now imports one, and
 * the later phases' roots once they exist (the cron job, the admin routes,
 * the Ask quality tab). A root not written yet has no closure to miss.
 */
const ROOTS = [
  'scripts/learner-ask-eval.ts',
  'worker/src/learner-api.ts',
  'worker/src/eval-candidates.ts',
  'worker/src/usage.ts',
  'worker/src/eval-cron.ts',
  'worker/src/eval-admin.ts',
  'src/admin/Quality.tsx',
].filter((root) => existsSync(path.join(ROOT, root)))

/** Every file reachable from `roots` by relative import, as repository paths. */
function importClosure(roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const resolve = (from: string, spec: string): string => {
    const base = path.resolve(path.dirname(from), spec.replace(/\?.*$/, ''))
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    throw new Error(`${path.relative(ROOT, from)} imports ${spec}, which resolves to nothing`)
  }
  const walk = (file: string) => {
    const relative = path.relative(ROOT, file)
    if (seen.has(relative)) return
    seen.add(relative)
    if (!/\.tsx?$/.test(file)) return
    const source = readFileSync(file, 'utf8')
    const imports = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm
    for (const match of source.matchAll(imports)) {
      const spec = match[1] ?? match[2] ?? match[3]
      if (spec.startsWith('.')) walk(resolve(file, spec))
    }
  }
  for (const root of roots) walk(path.join(ROOT, root))
  return [...seen].sort()
}

describe('the mirror list', () => {
  // Guard 25.
  it('holds every module the harness and the eval lifecycle’s worker modules import, or names it as excluded', () => {
    expect(ROOTS).toContain('scripts/learner-ask-eval.ts')
    const listed = new Set(MIRROR)
    const missing = importClosure(ROOTS).filter((file) => !listed.has(file) && !isExcluded(file))
    expect(missing).toEqual([])
  })

  // Guard 26.
  it('holds nothing the public README says is left out: the deploy config, the partner books, any key', () => {
    expect(MIRROR.filter(isExcluded)).toEqual([])
    for (const file of ['worker/wrangler.toml', 'worker/src/knowledge-base.json', 'worker/src/rep-knowledge-base.json', '.env.production.local', 'worker/.dev.vars']) {
      expect(isExcluded(file)).toBe(true)
    }
  })

  it('leaves the public repository’s own README and notes to it, and lists each path once', () => {
    expect(MIRROR.filter((file) => PUBLIC_OWN.includes(file))).toEqual([])
    expect(new Set(MIRROR).size).toBe(MIRROR.length)
    expect(EXCLUDED.every((file) => !MIRROR.includes(file))).toBe(true)
  })
})

describe('npm run public:mirror -- --into <clone>', () => {
  const clone = () => mkdtempSync(path.join(tmpdir(), 'public-mirror-'))
  const put = (dir: string, file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }

  // Criterion 36.
  it('copies the listed paths, deletes one the source no longer has, reports each, and touches nothing off the list', () => {
    const into = clone()
    put(into, 'a.ts', 'old a')
    put(into, 'same.ts', 'same')
    put(into, 'gone.ts', 'deleted upstream')
    put(into, 'README.md', 'the public README')
    put(into, 'notes/unlisted.md', 'somebody else’s')
    const source: Record<string, string> = { 'a.ts': 'new a', 'same.ts': 'same', 'deep/new.ts': 'new', 'README.md': 'the private README', 'secret.ts': 'unlisted' }
    const read = (file: string) => (file in source ? Buffer.from(source[file]) : null)

    const changes = mirror(read, into, ['a.ts', 'same.ts', 'deep/new.ts', 'gone.ts'])

    expect(changes).toEqual([
      { path: 'a.ts', kind: 'changed' },
      { path: 'deep/new.ts', kind: 'added' },
      { path: 'gone.ts', kind: 'removed' },
    ])
    expect(readFileSync(path.join(into, 'a.ts'), 'utf8')).toBe('new a')
    expect(readFileSync(path.join(into, 'deep/new.ts'), 'utf8')).toBe('new')
    expect(existsSync(path.join(into, 'gone.ts'))).toBe(false)
    expect(readFileSync(path.join(into, 'README.md'), 'utf8')).toBe('the public README')
    expect(readFileSync(path.join(into, 'notes/unlisted.md'), 'utf8')).toBe('somebody else’s')
    expect(existsSync(path.join(into, 'secret.ts'))).toBe(false)
    // Run again, nothing moves.
    expect(mirror(read, into, ['a.ts', 'same.ts', 'deep/new.ts', 'gone.ts'])).toEqual([])
  })

  it('refuses to run over a list that holds an excluded path or one the public repository owns, before writing anything', () => {
    const into = clone()
    const read = () => Buffer.from('x')
    expect(() => mirror(read, into, ['a.ts', 'worker/wrangler.toml'])).toThrow(/worker\/wrangler\.toml/)
    expect(() => mirror(read, into, ['a.ts', 'README.md'])).toThrow(/README\.md/)
    expect(existsSync(path.join(into, 'a.ts'))).toBe(false)
  })

  it('with --pr commits only the changed paths on a branch, pushes it, and opens the pull request in the public repository', () => {
    const ran: string[] = []
    const execute: Run = (command, args) => {
      ran.push([command, ...args].join(' '))
      return command === 'gh' ? 'https://github.com/AiFirstDevelopment/howards-lantern-rag-pipeline/pull/9\n' : ''
    }
    const url = openPullRequest('/clone', [{ path: 'a.ts', kind: 'changed' }, { path: 'gone.ts', kind: 'removed' }], '0123456789abcdef', execute)
    expect(url).toBe('https://github.com/AiFirstDevelopment/howards-lantern-rag-pipeline/pull/9')
    expect(ran[0]).toBe('git checkout -b mirror/0123456789ab')
    expect(ran[1]).toBe('git add -- a.ts')
    expect(ran[2]).toBe('git rm --cached --quiet -- gone.ts')
    expect(ran[3]).toMatch(/^git commit -m Mirror 0123456789ab/)
    expect(ran[4]).toBe('git push -u origin mirror/0123456789ab')
    expect(ran[5]).toMatch(new RegExp(`^gh pr create --repo ${PUBLIC_REPO} --head mirror/0123456789ab`))
    expect(ran).toHaveLength(6)
  })

  it('needs --into, and refuses an argument it does not know rather than ignoring it', () => {
    expect(parseArgs(['--into', '/tmp/public-rag', '--pr'])).toEqual({ into: '/tmp/public-rag', pr: true, ref: null })
    expect(() => parseArgs(['--pr'])).toThrow(/--into/)
    expect(() => parseArgs(['--into'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--into', 'x', '--push'])).toThrow(/unknown argument --push/)
  })
})
