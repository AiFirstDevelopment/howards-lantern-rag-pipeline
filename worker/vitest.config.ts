import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

// Anchored to this file rather than to the working directory, so the suite runs
// the same whether it is started from the repository root or from worker/.
const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * The worker's own suite. It runs the worker in workerd against a real (local)
 * D1, rather than against a hand-written stand-in, because most of what these
 * two endpoints do IS the SQL: a fake database would only prove that the fake
 * agrees with itself.
 *
 * Separate from vitest.config.ts because the app's unit tests run in Node and
 * these cannot -- the worker has no Node globals and D1 has no Node equivalent.
 */
export default defineWorkersConfig({
  root: HERE,
  test: {
    include: ['tests/**/*.test.ts'],
    /**
     * Vitest's default is 5000, and this suite cannot live inside it.
     *
     * Every test here boots workerd and talks to a real local D1, so a single
     * `it` is several round trips through a runtime that has to start. On an
     * idle machine `learners.test.ts` runs its 57 tests in 6.2s; on a loaded
     * CI runner the same file took 35.5s and one test -- "shows a partner
     * nothing about a code belonging to somebody else" -- tripped the
     * five-second per-test default and went red on a commit that changed three
     * markdown files and no code at all.
     *
     * #302 made this argument for the unit config and raised it there; the
     * worker config was left on the default, so the flake simply moved. A
     * timeout is not an assertion -- nothing here is testing how fast D1
     * answers -- so it is set well clear of the work rather than trimmed to it.
     * A test that genuinely hangs still fails, thirty seconds later; a test
     * that is merely slow on a busy runner no longer reports as broken, which
     * is the failure mode that teaches people to re-run a red check instead of
     * reading it.
     */
    testTimeout: 30_000,
    poolOptions: {
      workers: {
        // Bindings, vars and the D1 database all come from the deployed
        // configuration, so the suite cannot pass against a shape production
        // does not have.
        wrangler: { configPath: path.join(HERE, 'wrangler.toml') },
        miniflare: {
          // The one thing the deployed configuration cannot supply, because it
          // is a secret and secrets are not in the file. A webhook that cannot
          // be signed cannot be tested at all: every request would be refused
          // at the signature and the handler behind it would never run. This
          // value is a fake, and it is the only reason a suite can reach past
          // `verifyWebhookSignature` -- which is itself tested against it.
          //
          // The mesh's key pair is bound for the same reason and with the same
          // status: it is a **throwaway pair generated for this suite**, and it
          // is here because a suite that could not sign could only ever prove
          // the refusals -- every assertion about a token that *works* would
          // run around the verification instead of through it. Nothing outside
          // this file has ever seen it, and the deployed key is a Worker secret
          // installed by hand; see the runbook in
          // docs/plans/ask-mcp-architecture.md.
          //
          // `ASK_VIA_MESH` is deliberately **not** bound. The mesh ships inert,
          // and the suite's default must be the deployed default: every
          // existing ask test answers the way it always has, and the tests that
          // drive the mesh construct the dependency themselves.
          //
          // `KB` is bound here so the suite gets miniflare's own bucket --
          // local, empty until a test seeds it -- rather than reaching for the
          // real one. `wrangler.toml` has named it since step 8 of the runbook
          // was taken on 2026-09-14; before that it could not, because the
          // Workers API refuses a script bound to a bucket that does not exist.
          r2Buckets: ['KB'],
          // The coarse aggregator, which `wrangler.toml` has named since the
          // runbook was taken. workerd has no `ask-coarse` to resolve it to, and
          // an unresolvable service binding stops the whole runtime from
          // starting -- not one test, all of them, with an ERR_RUNTIME_FAILURE
          // that names miniflare rather than this line.
          //
          // It answers 503 because nothing should reach it: `ASK_VIA_MESH` is
          // deliberately unbound below, so `meshAskerFor` returns undefined and
          // every ask test takes the old path. A test that wants the mesh builds
          // its own asker. If this stub is ever seen in a response body, the
          // flag has been bound by accident and that is worth failing over.
          serviceBindings: {
            COARSE: () =>
              new Response('the mesh is off in this suite', { status: 503 }),
          },
          bindings: {
            STRIPE_WEBHOOK_SECRET: 'whsec_test_isolation',
            MESH_PRIVATE_KEY: 'MC4CAQAwBQYDK2VwBCIEIBo1Suah/Ju7vrkYse3ejNQ4Qzq+2kEHvRF7oJgyTb3n',
            MESH_PUBLIC_KEY:
              '{"crv":"Ed25519","x":"sl0twclTU7Ecm40wE5FTisUGvkIjnp43DcMuaqY6fcw","kty":"OKP"}',
          },
        },
      },
    },
  },
})
