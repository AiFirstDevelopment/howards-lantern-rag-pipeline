-- One row per completed Stripe Checkout session. `stripe_session_id` is unique,
-- which is what makes recording a purchase idempotent: the return redirect and
-- the webhook both race to write the same row and the second one loses harmlessly.
CREATE TABLE IF NOT EXISTS purchases (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT    NOT NULL UNIQUE,
  recovery_code     TEXT    NOT NULL UNIQUE,
  email             TEXT,
  amount_total      INTEGER,
  currency          TEXT,
  livemode          INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);

-- A purchase is redeemed on several devices, not one: there is no login, so the
-- device id is the only thing a browser can present, and a buyer moving from a
-- laptop to a phone has nothing else to carry.
--
-- "As many as the code is typed into" is what this said, and what the code did,
-- until 2026-09-23 -- which made a recovery code posted in public a free copy of
-- the product for everyone who read it. The ceiling is DEVICE_LIMIT in
-- worker/src/purchases.ts and is counted over these rows; it is deliberately
-- not a column here, because a limit stored per purchase is a limit somebody
-- has to remember to set on every insert.
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT    PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  linked_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_purchase ON devices(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchases_code   ON purchases(recovery_code);

-- How the app is actually used. Written by POST /api/event, read back only as
-- aggregates by GET /api/stats. `session` is the app's analytics id, minted
-- separately from the device id above: it says "one browser across visits" and
-- survives a learner who never buys anything.
--
-- It used to be the *only* id here, so that behaviour could not be attached to
-- a purchase. That is no longer true -- see the `device` column added at the
-- foot of this file, and the note there for what changed and why. This comment
-- claimed otherwise for four days after the column landed above it.
--
-- Columns rather than a JSON blob, so each question the stats endpoint answers
-- is one query and an unknown field cannot creep in unnoticed.
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Server time. A client clock can be wrong, deliberately or otherwise, and an
  -- event claiming to be from next year poisons every window that follows.
  at       INTEGER NOT NULL,
  session  TEXT    NOT NULL,
  name     TEXT    NOT NULL,
  state    TEXT,
  mode     TEXT,
  score    INTEGER,
  total    INTEGER,
  level    INTEGER,
  passed   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_at   ON events(at);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, at);

-- Crashes, kept apart from `events` on purpose.
--
-- These carry real text -- a message and a stack, which is the whole reason to
-- collect them. GET /api/stats is public, so a stack trace flowing through it
-- would not merely be stored but published, and a scrubbing miss would be
-- published with it. Its own table makes that structural rather than a matter
-- of remembering: computeStats never names this table, and cannot leak what it
-- does not read. Messages are read with `wrangler d1 execute`, which is
-- authenticated; /api/stats reports only how many, of which kind.
CREATE TABLE IF NOT EXISTS errors (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  session TEXT    NOT NULL,
  kind    TEXT    NOT NULL,   -- render | rejection | window
  screen  TEXT,               -- the component it happened in, if known
  message TEXT,               -- scrubbed and bounded on both sides of the wire
  stack   TEXT,
  release TEXT,               -- the commit the bundle was built from
  -- Stable across rebuilds, so one bug stays one bug. See error_status below.
  fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS idx_errors_at   ON errors(at);
CREATE INDEX IF NOT EXISTS idx_errors_kind ON errors(kind, at);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(fingerprint, at);

-- Triage state, one row per distinct problem rather than per crash.
--
-- `fingerprint` on `errors` above groups occurrences: one bug that crashes
-- fifty times is one thing to fix, not fifty. It is deliberately NOT derived
-- from stack positions -- those are minified offsets that move on every build,
-- so fingerprinting on them would make every deploy look like a fresh set of
-- bugs and nothing could ever be marked fixed. Kind, screen and a normalised
-- message survive a rebuild; that is what identity is built from.
--
-- Absence of a row here means open. `fixed_at` plus `fixed_in` is what makes a
-- recurrence legible: an occurrence newer than the fix is not a fix that did
-- not work, it is a regression, and that distinction is the whole reason this
-- table exists rather than a note in a file somewhere.
CREATE TABLE IF NOT EXISTS error_status (
  fingerprint TEXT PRIMARY KEY,
  status      TEXT NOT NULL,      -- open | fixed
  fixed_in    TEXT,               -- the commit that fixed it
  note        TEXT,
  fixed_at    INTEGER
);

-- What learners say about the app, which is the third and last kind of thing
-- this database holds -- and the only one somebody chose to write.
--
-- `events` is a closed enum. `errors` is text nobody meant to send. This is
-- text a person typed on purpose, knowing it was going somewhere, which is why
-- it is treated differently from both: it may contain an email address if the
-- sender wants a reply, and it is never, under any circumstances, served from
-- the public /api/stats endpoint. Its own table is what makes that structural:
-- computeStats cannot publish a column it never names, and the only query that
-- names `comment` at all asks whether one is present, never what it says.
--
-- `session` is the analytics id. It is here to rate-limit a public write and to
-- tell one person's ten comments from ten people's one.
--
-- It was once the only id on this row, so that a typed opinion could not be
-- joined to a paying identity. That is no longer the arrangement -- see the
-- `device` column at the foot of this file, and the note there for what
-- changed. Neither id is served from /api/stats, which is a separate property
-- and still holds: computeStats cannot publish a column it never names.
--
-- The context columns are the sender's own progress at the moment of writing.
-- "Too easy" from someone at level 0 with one test behind them is a different
-- report from "too easy" from a certified user who passed the real exam, and
-- nothing else in the row can tell them apart.
CREATE TABLE IF NOT EXISTS feedback (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Server time, as everywhere else: a client clock can be wrong.
  at       INTEGER NOT NULL,
  session  TEXT    NOT NULL,
  rating   INTEGER NOT NULL,   -- 1..5, the one required field
  outcome  TEXT,               -- passed | failed | not_yet, on the REAL exam
  comment  TEXT,               -- scrubbed and bounded; may be empty
  state    TEXT,
  level    INTEGER,
  tests    INTEGER,
  score    INTEGER,
  total    INTEGER,
  release  TEXT                -- the build they were rating
);

CREATE INDEX IF NOT EXISTS idx_feedback_at      ON feedback(at);
-- The rate limit reads this and nothing else.
CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback(session, at);

-- Which card an answer was about.
--
-- Added when the app started reporting per-card results, and that reversed a
-- promise it had made until then: that it never sent the answer to any
-- individual question. It is worth being exact about what changed. This is a
-- card identifier and a right-or-wrong, under the analytics id -- a random
-- number minted on the device, joined to no purchase and to no person. It is
-- what makes "which cards fail to teach" answerable, which is the one question
-- whose answer can improve the material.
--
-- README.md and the in-app privacy page say so plainly, and a test holds that
-- page to the event list so the two cannot drift apart.
ALTER TABLE events ADD COLUMN law TEXT;
CREATE INDEX IF NOT EXISTS idx_events_law ON events(law, at);

-- The browser that pays, on the rows that say what it did.
--
-- These two identities used to be kept apart on purpose: `session` above is the
-- analytics id and `device_id` in `devices` is the one a purchase is attached
-- to, and nothing joined them. That answered a privacy question at the cost of
-- a commercial one -- "which behaviour leads to a sale" was unanswerable, and
-- so was "did this buyer actually use the thing".
--
-- Both ids are still random numbers minted on the device and neither is a
-- name, so what this changes is that behaviour and purchase can be read
-- together. README.md and the in-app privacy page say so.
--
-- Carried on every row rather than kept in a join table: one column of 36
-- bytes is cheaper to store than a join is to get right, and every question
-- worth asking becomes a WHERE clause.
ALTER TABLE events ADD COLUMN device TEXT;
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device, at);

-- Which of our sites an event happened on.
--
-- The app runs under more than one name, and a browser scopes storage to an
-- origin -- so the names are separate audiences with separate progress, which
-- is the point rather than an accident. Without this column the numbers pool
-- them and the split is unreadable: you would be running two properties and
-- looking at one figure.
ALTER TABLE events ADD COLUMN site TEXT;
CREATE INDEX IF NOT EXISTS idx_events_site ON events(site, at);

-- Which exam an event or a rating was about.
--
-- The app teaches more than one now, reached by URL rather than by menu, and
-- a state means something different under each: driving in Maryland and
-- hunting in Maryland are two bodies of knowledge, not two views of one. Every
-- reader here therefore groups by product the way it already groups by site --
-- without it two products pool into one funnel and none of the existing
-- analysis means anything, because "how many finish the study pass" would be
-- an average over two different passes.
--
-- Read through COALESCE(product, 'drivers'): the rows written before this
-- column existed were all written by the driving app, because it was the only
-- app there was. That keeps them counting instead of needing a backfill that
-- could only ever write the same constant.
ALTER TABLE events ADD COLUMN product TEXT;
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product, at);

-- The same, for what people say. Which exam somebody passed is the whole point
-- of asking whether they passed.
ALTER TABLE feedback ADD COLUMN product TEXT;

-- Roughly where the request came from, as the edge had already worked it out.
--
-- Not a field of the event body, and that distinction is the whole value of
-- these two columns. Everything `parseEvent` accepts is written by the browser
-- and is therefore a claim; this is read off the connection, which the page
-- cannot dress up. A country a visitor could set for themselves would be worth
-- nothing -- and would be worth nothing silently, which is worse.
--
-- The IP address is never read and never stored. What is kept is the country
-- and, inside the United States, the state: `region` holds the two-letter code
-- rather than the region's name on purpose, because that is the same alphabet
-- as the state a visitor picks in the app. "Where they are" and "which exam
-- they chose" then compare with an equals sign instead of a lookup table, and
-- that comparison -- a Virginia visitor working through the Maryland test --
-- is the entire reason for the column. The state in `events.state` is a choice;
-- this is a location, and the two must not be confused.
--
-- Null on every row written before this existed, and null wherever the edge
-- had no answer, so read them as "unknown" rather than as "elsewhere".
ALTER TABLE events ADD COLUMN country TEXT;
ALTER TABLE events ADD COLUMN region  TEXT;
CREATE INDEX IF NOT EXISTS idx_events_region ON events(region, at);

-- A purchase that was given back.
--
-- Nothing in this system used to hear about a refund. The webhook subscribes to
-- one event type, `entitlementFor` joined device to purchase and answered yes,
-- and there was no state in which a purchase could be undone -- so a refunded
-- buyer kept every test forever, and the only person who knew was Stripe.
--
-- `payment_intent` is what makes the connection possible at all. A refund
-- arrives as a Charge, which carries no session id and no metadata of ours; the
-- payment intent is the only field the two objects share. Recorded when the
-- purchase is written so a refund is matched locally, with no second call to
-- Stripe from inside a webhook that has to answer quickly.
--
-- It is also, for free, the isolation the rest of the account needs: only
-- payment intents this app recorded are in this column, so a refund belonging
-- to the other app on the shared Stripe account matches no row and changes
-- nothing. Null on the rows written before the column existed, and a null
-- column never matches, so those simply cannot be refunded automatically --
-- which is correct rather than unfortunate: they predate the mechanism.
--
-- `refunded_at` is server time and nullable. Null is the whole of "still
-- entitled": every read asks for it to be null rather than asking for a flag to
-- be false, so a row that somehow gained a refund time is refused by default.
ALTER TABLE purchases ADD COLUMN payment_intent TEXT;
ALTER TABLE purchases ADD COLUMN refunded_at    INTEGER;
CREATE INDEX IF NOT EXISTS idx_purchases_payment_intent ON purchases(payment_intent);

-- The one column in this database written in milliseconds, corrected.
--
-- `created_at` beside it is integer epoch seconds -- the convention everywhere
-- here -- but `handleWebhook` passed `Date.now()` straight through, so a
-- refunded row carried a number a thousand times larger than its neighbour.
-- Harmless for as long as nothing read it as a time: every reader asked
-- `IS NULL`. It stops being harmless the moment a commission's clearing window
-- does arithmetic across the two columns, because the comparison is then wrong
-- by a factor of a thousand and wrong in the direction that looks plausible.
--
-- Bounded rather than blanket. 10^11 seconds is the year 5138 and 10^11
-- milliseconds was 1973, so anything above it is unambiguously a millisecond
-- value and anything below is already correct. That is what makes this safe to
-- re-run: a second application divides nothing a second time.
UPDATE purchases
   SET refunded_at = refunded_at / 1000
 WHERE refunded_at IS NOT NULL AND refunded_at > 100000000000;

-- Which exam was bought.
--
-- `events` gained a product column months ago and `purchases` never did, so
-- until now the database could not say which product any revenue came from --
-- which is exactly the question a per-programme commission rate has to answer.
--
-- Read through COALESCE(product, 'drivers') for the same reason `events` is:
-- every row written before this column existed was written by the driving app,
-- because it was the only app there was.
ALTER TABLE purchases ADD COLUMN product TEXT;

-- ---------------------------------------------------------------------------
-- The partner network. See docs/work/partners/spec.md for the reasoning; what
-- follows is the shape, in the order the foreign keys resolve.
-- ---------------------------------------------------------------------------

-- One row per sellable exam, keyed by the same product id the corpus manifest
-- uses -- so "which programme" and "which exam" can never drift apart, because
-- there is no second registry to keep in step.
--
-- What this row decides at the moment of sale is the clearing window and the
-- currency; a partner's own row decides the rates and the discount (see
-- decision 9 in the spec, and the `partners` comment below). A product with no
-- row here still sells and still records its code -- it simply writes no
-- commission until somebody adds the row, which is what makes the missing-row
-- case recoverable rather than lost.
CREATE TABLE IF NOT EXISTS programs (
  product        TEXT PRIMARY KEY,        -- 'drivers', 'hunting', 'fishing'
  direct_bps     INTEGER NOT NULL,        -- 5000 = 50% to the selling partner
  discount_bps   INTEGER NOT NULL,        -- 1000 = 10% off, for the buyer
  clearing_days  INTEGER NOT NULL,        -- 30: how long a commission stays pending
  -- No coupon column: coupons are pooled by percentage in `discount_coupons`,
  -- not held per programme. See the comment on that table.
  currency       TEXT NOT NULL DEFAULT 'usd',
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);

-- The one programme that exists today, on the settled numbers.
--
-- Seeded rather than left to an operator because a missing row here is silent:
-- the sale still happens, the code is still recorded on the purchase, and no
-- commission is ever written. That is recoverable by design -- the purchase row
-- carries everything a commission needs -- but recovering it is a job somebody
-- has to notice, and nobody notices a partner not being paid until the partner
-- does.
--
-- `INSERT OR IGNORE`, so re-applying this file never rewrites terms that have
-- since been changed deliberately.
INSERT OR IGNORE INTO programs
  (product, direct_bps, discount_bps, clearing_days, currency, active, created_at)
VALUES ('drivers', 5000, 1000, 30, 'usd', 1, unixepoch());

-- What a new partner is given, when nobody is watching them sign up.
--
-- Exactly one row, and the CHECK is what keeps it that way: a second row here
-- would be a silent fork in the terms, where the answer to "what do we offer?"
-- depends on which query ran. Read at signup only -- a partner's own row is the
-- authority from then on.
CREATE TABLE IF NOT EXISTS defaults (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  discount_bps     INTEGER NOT NULL,       -- 1000: what a new partner's buyers get off
  direct_bps       INTEGER NOT NULL,       -- 5000: what a new partner earns
  -- Dead. Nothing reads this: the clearing window is a property of a
  -- programme, and `commissions.ts` dates every row from
  -- `programs.clearing_days`. It is left here rather than dropped because
  -- removing a column needs a deploy-then-migrate ordering and buys no
  -- behaviour -- but nothing may start reading it again, because a second home
  -- for this number is how `defaults --clearing-days 60` came to succeed,
  -- print its usual summary, and change nothing.
  clearing_days    INTEGER NOT NULL,       -- dead; see `partners -- program`
  -- The two guardrails, enforced at the point of sale and not only here. A row
  -- written when the cap was looser must not still be able to sell under it.
  max_discount_bps INTEGER NOT NULL,       -- 3000: nothing sells below this, ever
  min_keep_cents   INTEGER NOT NULL,       --  300: what must be left after fee and commission
  -- Whether an application becomes a partner without anybody approving it. Off
  -- to begin with: this switch is the whole distance between "somebody applied"
  -- and "a code exists in the world".
  auto_approve     INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
);

-- The settled numbers, as one row. INSERT OR IGNORE so applying this file to a
-- database that already has it changes nothing: what a partner already has must
-- not be rewritten by a redeploy.
INSERT OR IGNORE INTO defaults
  (id, discount_bps, direct_bps, clearing_days,
   max_discount_bps, min_keep_cents, auto_approve, updated_at)
VALUES (1, 1000, 5000, 30, 3000, 300, 0, unixepoch());

-- One Stripe coupon per distinct discount, shared by every partner on that
-- number. Not one per partner: two hundred partners would mean two hundred
-- coupon objects and a Stripe dashboard nobody can read, for no behaviour that
-- differs -- the identity of the seller lives in our metadata, not in Stripe's
-- coupon. Created on first use and remembered here, so adding a partner on 15%
-- when nobody has been on 15% before costs one Stripe call, once, ever.
CREATE TABLE IF NOT EXISTS discount_coupons (
  discount_bps  INTEGER PRIMARY KEY,
  stripe_coupon TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Somebody who sells for us. There is exactly one kind of account in this
-- system and this is it -- learners still have none, and that is the point.
--
-- There is one tier and no second one. Nobody earns on anybody else's sales,
-- which is what keeps this an ordinary affiliate arrangement -- describable to
-- a buyer of this business in a sentence, and unwindable inside the twelve
-- months a code lasts. See docs/plans/partners-v2.md.
--
-- `status` gates everything. A code belonging to a partner who is not `active`
-- resolves to no discount and no commission -- checked at checkout, so a
-- suspended partner stops earning at the next sale rather than at the next
-- payout run.
--
-- The two rate columns are this partner's actual terms, copied from the
-- programme or the defaults at application and then never re-read from
-- anywhere else. Changing what new partners are offered does not rewrite the
-- deal of somebody who already has it printed on eight hundred flyers.
--
-- There is deliberately no column here for a tax identification number, and
-- adding one is the kind of helpful change that must fail review: a schema with
-- nowhere to put an SSN cannot leak one, and this comment is here so the
-- absence reads as a decision rather than an oversight.
-- tests/unit/partner-schema.test.ts asserts it by name.
CREATE TABLE IF NOT EXISTS partners (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL,
  email                 TEXT    NOT NULL UNIQUE,
  status                TEXT    NOT NULL,     -- unverified | pending | active | suspended | closed
  discount_bps          INTEGER NOT NULL,
  direct_bps            INTEGER NOT NULL,
  -- Which defaults these were taken from, and when. What makes "why is this
  -- partner on 25%?" answerable a year later, when the defaults have moved.
  terms_source          TEXT,                 -- 'defaults' | 'program:drivers' | 'manual' | 'retro'
  terms_set_at          INTEGER NOT NULL,
  payout_method         TEXT,                 -- 'paypal' to start; the column is open for the next one
  payout_detail         TEXT,                 -- where the money goes
  -- When the payout details last moved. A payout is refused against details
  -- changed inside the hold, which turns a silent theft into a delay somebody
  -- has time to notice.
  payout_changed_at     INTEGER,
  -- A W-9 on file. Null blocks a payout rather than blocking earning: somebody
  -- can sell on day one and sort out paperwork before the first cheque. The
  -- form itself lives in the signing service and the number on it is never in
  -- this database.
  tax_form_at           INTEGER,
  tax_form_ref          TEXT,
  -- Which version of the agreement was accepted, when, and -- the part that
  -- decides a dispute -- a hash of the exact bytes that were served when it
  -- was. Version alone is not enough: a document edited after somebody accepted
  -- it leaves a row saying "accepted v1" pointing at a v1 that has since
  -- changed.
  agreement_version     TEXT,
  agreement_accepted_at INTEGER,
  agreement_sha256      TEXT,
  created_at            INTEGER NOT NULL,
  approved_at           INTEGER,
  suspended_at          INTEGER
);

-- What a buyer types or clicks. Uppercase, because it gets read off a
-- whiteboard and typed by somebody in a hurry.
--
-- `program` null means the code works on every product, and null is what a
-- minted code gets: a driving school that happens to send a hunting sale earns
-- on it. Pinning is the deliberate exception -- a code that stops working the
-- day we launch fishing is a support ticket, not a feature.
CREATE TABLE IF NOT EXISTS partner_codes (
  code            TEXT PRIMARY KEY,        -- normalised uppercase, e.g. 'LANTERN20'
  partner_id      INTEGER NOT NULL REFERENCES partners(id),
  program         TEXT REFERENCES programs(product),
  label           TEXT,                    -- 'Towson location', for the partner's own eyes
  -- Null means "the partner's own discount". Set only to run a campaign.
  discount_bps    INTEGER,
  status          TEXT    NOT NULL,        -- active | disabled
  expires_at      INTEGER,
  max_redemptions INTEGER,
  redemptions     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_codes_partner ON partner_codes(partner_id);

-- The code as it was resolved at checkout, and the partner it resolved to.
--
-- Recorded on the purchase even when no commission is written -- a suspended
-- partner, a missing programme row, a self-referral. That is deliberate: the
-- purchase row then carries everything a commission needs (amount, product,
-- code, time), so a commission missed because of a configuration mistake can be
-- written later from the record instead of being lost with the sale.
ALTER TABLE purchases ADD COLUMN partner_code TEXT;
ALTER TABLE purchases ADD COLUMN partner_id   INTEGER REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_purchases_partner ON purchases(partner_id);

-- The discount that was actually resolved for this sale.
--
-- `amount_total` records what was charged, which is not the same fact: the list
-- price moves, so "$15.99" alone cannot say afterwards whether that was 20% off
-- $19.99 or 27% off $21.99. Reconciling a partner's own arithmetic against ours
-- is the whole job of this column.
ALTER TABLE purchases ADD COLUMN discount_bps INTEGER;

-- Money actually sent. One row per payment, whatever the method; the commission
-- rows it covered point back at it.
--
-- Declared before `commissions` rather than after it, as the spec writes them,
-- because `commissions.payout_id` references this table and D1 enforces
-- foreign keys: a reference to a table that does not exist yet is a constraint
-- that fails on the first insert rather than at creation.
CREATE TABLE IF NOT EXISTS payouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id   INTEGER NOT NULL REFERENCES partners(id),
  amount_cents INTEGER NOT NULL,
  currency     TEXT    NOT NULL,
  method       TEXT    NOT NULL,
  reference    TEXT,                      -- the PayPal transaction id, the cheque number
  note         TEXT,
  paid_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payouts_partner ON payouts(partner_id, paid_at);

-- Every cent this system has ever owed anybody, as rows that are only ever
-- added.
--
-- There is no `status` column and no mutable `amount`, and both absences are
-- the design. A refund writes a *reversal* row -- same purchase, same partner,
-- negative amount -- rather than editing or deleting what it undoes. A balance
-- is then a SUM, a partner can be shown why a number changed, and the two ways
-- this goes wrong quietly (a status that says paid when nothing was sent, an
-- amount edited by a script nobody kept) are not representable.
--
-- `rate_bps` and `basis_cents` are copied from the partner and the purchase at
-- write time. Changing a rate must never rewrite what was already earned.
--
-- `clears_at` is what makes a payout safe: before it, the money is visible and
-- not payable, so a refund inside the window cancels a promise instead of
-- chasing a payment.
CREATE TABLE IF NOT EXISTS commissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id   INTEGER NOT NULL REFERENCES partners(id),
  purchase_id  INTEGER NOT NULL REFERENCES purchases(id),
  kind         TEXT    NOT NULL,          -- direct | reversal | adjustment
  -- The row this one undoes. Null except on a reversal.
  reverses_id  INTEGER REFERENCES commissions(id),
  product      TEXT,
  basis_cents  INTEGER NOT NULL,          -- what the buyer was actually charged
  rate_bps     INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,          -- signed; negative on a reversal
  currency     TEXT    NOT NULL,
  clears_at    INTEGER NOT NULL,
  -- Stamped when a payout consumes this row, which is what makes a row payable
  -- exactly once without anybody having to remember.
  payout_id    INTEGER REFERENCES payouts(id),
  created_at   INTEGER NOT NULL
);

-- The idempotency guard, and the direct equivalent of `stripe_session_id
-- UNIQUE` on purchases: the claim and the webhook both try to write the same
-- commission, a refund may be delivered twice, and Stripe retries. One row per
-- (purchase, partner, kind) means the second attempt writes nothing and is
-- harmless rather than doubling somebody's pay.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_once
  ON commissions(purchase_id, partner_id, kind);
CREATE INDEX IF NOT EXISTS idx_commissions_partner ON commissions(partner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commissions_unpaid  ON commissions(partner_id, payout_id, clears_at);

-- A login link, and the session it becomes. Both store a SHA-256 of the token
-- and never the token itself: a read of this database must not be a way to log
-- in as somebody. The same reasoning as any password table, for the same reason
-- -- these rows are read by scripts and printed in terminals during support.
--
-- `purpose` is not bookkeeping. Without it, the fifteen-minute login link a
-- partner forwards to their bookkeeper is also a token that can repoint their
-- payout. A token authorises the thing it was issued for and nothing else.
CREATE TABLE IF NOT EXISTS partner_logins (
  token_hash TEXT PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  purpose    TEXT    NOT NULL,            -- verify | login | payout
  expires_at INTEGER NOT NULL,            -- 15 minutes
  used_at    INTEGER,                     -- single use; a used link is dead
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_logins_partner ON partner_logins(partner_id, purpose);

CREATE TABLE IF NOT EXISTS partner_sessions (
  token_hash TEXT PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  issued_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,            -- 30 days
  last_seen  INTEGER,
  -- When this session last proved the address again, by spending a `payout`
  -- link. What makes changing where the money goes need more than a session.
  stepped_up_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_partner ON partner_sessions(partner_id);

-- Every change to somebody's terms, and the handful of per-sale events that
-- explain a number somebody will ask about, appended.
--
-- The tables above hold what is true now. This holds what was true before, and
-- the two questions that come up whenever money is disputed are only answerable
-- from here: "was this partner on 25% in March?" and "who set that?".
--
-- Written by the admin script and by self-registration alike, so a partner who
-- was never touched by a human still has a row saying where their terms came
-- from.
CREATE TABLE IF NOT EXISTS partner_admin_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT    NOT NULL,            -- an operator's name, 'self-registration', or 'system'
  -- approve | set-discount | set-rate | retro-terms | set-program | mint-code
  -- | disable-code | suspend | reinstate | pay | tax-form | apply | verify
  action     TEXT    NOT NULL,
  partner_id INTEGER REFERENCES partners(id),
  detail     TEXT,                        -- the code, the payout reference
  before_val TEXT,
  after_val  TEXT
);
CREATE INDEX IF NOT EXISTS idx_partner_admin_log_partner ON partner_admin_log(partner_id, at);

-- Which campaign a referral event was about.
--
-- The three referral events are counts of clicks, redemptions and dead codes,
-- and a count alone cannot say *which* code has quietly stopped working -- or
-- which partner's redemptions are arriving without any matching clicks, which
-- is the one number that catches coupon leakage before a monthly total does.
--
-- It names a partner's campaign and never a person; nothing about the buyer is
-- in it, and it is set on no other event.
ALTER TABLE events ADD COLUMN ref TEXT;
CREATE INDEX IF NOT EXISTS idx_events_ref ON events(ref, at);

-- The browser that paid, on the row that says how the real exam went.
--
-- `session` above is the analytics id, chosen when this table was written so
-- that a typed opinion could not be attached to a paying identity. That
-- reasoning was overtaken on 2026-09-01, when `events` gained the device id and
-- made the same link reachable in two hops anyway -- so the isolation was
-- already gone, and only the ability to use it deliberately was missing.
--
-- What it buys is the question this product exists to answer: **did the people
-- who reached Certified actually pass?** `feedback.outcome` is the only record
-- of the real result, and until now it could not be joined to a purchase in one
-- step. It reached across `events` or not at all, which fails for anyone whose
-- events were dropped by a beacon that never fired.
--
-- Nullable, because a rating from somebody who never bought anything is still
-- worth having, and because every row written before this column existed has
-- no answer to give.
ALTER TABLE feedback ADD COLUMN device TEXT;
CREATE INDEX IF NOT EXISTS idx_feedback_device ON feedback(device, at);

-- Reading a session's other rows, which is what learner activity is.
--
-- Every query in docs/plans/learner-activity.md has the same shape: find the
-- sessions that arrived on a partner's code, then count what those sessions did
-- afterwards. The first half is served by idx_events_ref above. The second half
-- had no index at all -- `session` is the one identifying column this table
-- never indexed, because until now nothing read the table that way.
--
-- Without it the second half is a full scan that grows with every beacon the
-- site has ever received, and the failure is the quiet kind: the endpoint does
-- not break, it gets slow enough to time out under a table nobody is watching.
--
-- `(session, at)` rather than `(session)`: the scan is always bounded by a
-- window, and the ordering is what makes last-touch attribution -- the code
-- whose referral_seen most recently preceded an event -- a range scan instead
-- of a sort.
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session, at);

-- How somebody arrived, as five bounded facts on `opened` and on nothing else.
--
-- `ref` above says which partner handed out a card. None of these do: they say
-- which site linked here, which campaign the link named, which page was landed
-- on, how wide the window was and what language the browser reads. The two were
-- conflated in conversation once -- "do we capture the referrer" answered by
-- pointing at a column that holds partner codes -- so they are separated here
-- in writing.
--
-- Only ever set by `opened`. It fires once per load, so these are facts about a
-- visit rather than about an action, and repeating them on forty study events
-- would be forty copies of one answer.
--
-- `source` is a host and never a URL. A full referrer carries the search terms
-- somebody typed, the private group they were reading and occasionally a token;
-- the host answers "which sites send us people" and carries none of it. Our own
-- hosts are dropped before sending, or howardslantern.com becomes the largest
-- referrer to howardslantern.com.
--
-- `viewport` is three buckets rather than a width, and `lang` is the primary
-- subtag rather than the full tag: both settle a product argument -- is
-- mobile-first still right, is it worth translating -- and neither needs the
-- precision that would narrow the crowd somebody stands in.
ALTER TABLE events ADD COLUMN source   TEXT;
ALTER TABLE events ADD COLUMN campaign TEXT;
ALTER TABLE events ADD COLUMN entry    TEXT;
ALTER TABLE events ADD COLUMN viewport TEXT;
ALTER TABLE events ADD COLUMN lang     TEXT;
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, at);
CREATE INDEX IF NOT EXISTS idx_events_entry  ON events(entry, at);

-- What somebody asked the partner page, and which written answer they got.
--
-- **The unmatched questions are the most valuable thing this table holds.**
-- They are the first direct evidence of what a prospective partner wants to
-- know and cannot find out -- today there is no channel that would even record
-- one -- and they are the input to the next batch of entries. Matched ones are
-- kept too, because knowing which entries are never chosen is how the knowledge
-- base stops growing for ever.
--
-- `partner_id` is nullable because the public route has no session and no
-- partner: a stranger on the partner page is exactly who this was built for.
-- `entry_id` is nullable rather than a sentinel so that "nothing matched" can
-- never be confused with an entry somebody later names `no-match`.
--
-- `conversation` is what makes a follow-up chain readable afterwards. A
-- question that only makes sense after the one before it -- "what if I don't
-- hit that?" -- is misleading on its own, and it is also what the worker reads
-- back to give the router the earlier turns rather than trusting a browser to
-- send them.
--
-- `model` records what chose, or why nothing did (`unavailable` with no key,
-- `unreachable` when the call failed), so a run of no-matches can be told apart
-- from a run of outages. No IP address: this database has never held one and
-- this is not the change that starts.
--
-- Kept 180 days; docs/work/partners/privacy.md says so and src/legal.ts says it
-- to the person typing.
CREATE TABLE IF NOT EXISTS partner_questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id     INTEGER REFERENCES partners(id),  -- NULL on the public route
  conversation   TEXT    NOT NULL,                 -- groups a follow-up chain
  turn           INTEGER NOT NULL,
  asked_at       INTEGER NOT NULL,
  question       TEXT    NOT NULL,
  entry_id       TEXT,                             -- NULL when nothing matched
  model          TEXT    NOT NULL
);

-- The daily ceiling counts rows in a window, the way `sentRecently` does for
-- feedback and login: no counter table, nothing to keep in step.
CREATE INDEX IF NOT EXISTS idx_partner_questions_at ON partner_questions(asked_at);
-- Every request reads its own conversation back -- which turn this is, and what
-- was asked before it. Without this that is a full scan of a table that only
-- grows, and the failure is the quiet kind: it does not break, it gets slow.
CREATE INDEX IF NOT EXISTS idx_partner_questions_thread
  ON partner_questions(conversation, id);
-- One request may hold a given turn of a given conversation, and that is what
-- makes the turn cap a cap. The row is written before the model is asked, so
-- without this a burst of concurrent posts on one conversation all read the
-- same history, all skip the challenge as follow-ups, and all become paid model
-- calls off a single Turnstile solve. With it, a conversation can never cost
-- more than MAX_TURNS calls however hard it is driven.
--
-- Two partial indexes rather than one, because a conversation id is minted by a
-- browser and the public and signed-in threads are separate namespaces: the
-- worker already scopes `turnsOf` by partner so a guessed id reads nothing, and
-- a single index over (conversation, turn) would undo that by letting a
-- partner's row block a stranger's -- or the other way about.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_questions_public_turn
  ON partner_questions(conversation, turn) WHERE partner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_questions_partner_turn
  ON partner_questions(partner_id, conversation, turn) WHERE partner_id IS NOT NULL;

-- The learner's ask box (docs/plans/learner-ask.md). Its own table rather than
-- NULL-partner rows in partner_questions: a learner's question must never
-- appear in the partner box's log or count against its ceiling, and a
-- NULL-column convention is how that would quietly happen. Kept 180 days by the
-- same purge-on-write; the question is scrubbed before it is written, and
-- `answer` is what the learner was shown -- empty where nothing the model
-- wrote was -- which is what the next turn replays.
CREATE TABLE IF NOT EXISTS learner_questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation   TEXT    NOT NULL,
  turn           INTEGER NOT NULL,
  asked_at       INTEGER NOT NULL,
  lang           TEXT    NOT NULL,                 -- 'en' or 'es'
  state          TEXT,                             -- the chosen state's code, for the road-law pointer
  question       TEXT    NOT NULL,
  answer         TEXT,                             -- NULL while asking, '' when nothing was shown
  scope          TEXT,                             -- what the model called it
  sources        TEXT,                             -- JSON array of section ids
  model          TEXT    NOT NULL                  -- the model, or why nothing was shown
);
CREATE INDEX IF NOT EXISTS idx_learner_questions_at ON learner_questions(asked_at);
-- One request may hold a given turn, which is what makes the turn cap a cap;
-- see idx_partner_questions_public_turn. The same index orders the thread.
CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_questions_turn
  ON learner_questions(conversation, turn);

-- Finer geolocation, on the events and on the ratings.
--
-- `country` and `region` answered one question -- is the exam they are studying
-- the one for where they are -- and answered it well. Two others they cannot
-- answer at all:
--
--   Seventeen sessions from one region with exactly one event each is either a
--   school class or a crawler fleet. `as_org` is the only column that tells
--   them apart: a residential ISP and a cloud provider look identical in every
--   other field.
--
--   And a rating carried no geography whatsoever. When `events` was emptied on
--   2026-09-07 the one real rating on the table lost the only rows that could
--   say where it came from, which is a fact about it that can never be
--   recovered. These columns mean the next one keeps its own.
--
-- Free text rather than codes, bounded at GEO_TEXT_LIMIT in analytics.ts: a
-- town, a postcode, an IANA zone and a network operator are none of them the
-- two or three characters `geoCode` allows, and squeezing them through it
-- would store null for every one while looking like it had worked.
ALTER TABLE events ADD COLUMN city TEXT;
ALTER TABLE events ADD COLUMN postal_code TEXT;
ALTER TABLE events ADD COLUMN timezone TEXT;
ALTER TABLE events ADD COLUMN as_org TEXT;

ALTER TABLE feedback ADD COLUMN country TEXT;
ALTER TABLE feedback ADD COLUMN region TEXT;
ALTER TABLE feedback ADD COLUMN city TEXT;
ALTER TABLE feedback ADD COLUMN postal_code TEXT;
ALTER TABLE feedback ADD COLUMN timezone TEXT;
ALTER TABLE feedback ADD COLUMN as_org TEXT;

-- The network operator is the column a bot question is asked of, so it is the
-- one worth an index: "every session from this ASN, in this window" is the
-- shape of every query that follows from docs/todo.md item 3.
CREATE INDEX IF NOT EXISTS idx_events_as_org ON events(as_org, at);

-- How long an arrival looked at the first screen before leaving, in seconds.
--
-- On 2026-09-21 roughly four in ten genuine phone arrivals opened the page and
-- pressed nothing, and the table could not say whether they read it for a
-- minute or bounced in two seconds -- `opened` fires on load and the next
-- thing recorded is a press. `left_landing` sends this on the way out, from
-- the state picker or a state's own page, and nothing else: no scroll, no
-- element, no address. Nullable, and null on every other event.
ALTER TABLE events ADD COLUMN seconds INTEGER;

-- Which of the three doors led a learner to the price, on `paywall_shown`.
--
-- The event carried the state and nothing else, and the three doors are not
-- one thing: the offer on the ten-question test's results (#387), the wall
-- after the free section (#391), and asking for a full test once the free one
-- is spent. Two of those are reached from the study card, so the screen the
-- learner came from cannot tell them apart.
--
-- Nullable, and null is not a fourth door: it is an event from an app bundle
-- that predates this column, which every open tab goes on sending for as long
-- as it lives. The worker accepts those rather than refusing them, so the
-- count stays whole while the field fills in.
ALTER TABLE events ADD COLUMN reason TEXT;

-- The business name a partner shows to the learners they send.
--
-- Not `partners.name`, and the distance between the two is the point. `name` is
-- what was typed on an application that asked for a name *or* a business, and
-- is often a person -- an instructor applying as herself -- so it is not
-- necessarily the name she would put on a learner's screen. This column is only
-- ever written by the partner, from a field in the portal that says where it
-- appears, or from the application form, which asks for it separately.
--
-- Null means there is none on file yet, which is every row that predates the
-- form asking. The portal pre-fills its field from `name` for those, to accept
-- in one click or type over; nothing reaches a learner until it is saved. What
-- null is *not* is a preference: whether the name is shown is
-- `private_branding` at the foot of this file, which is a switch with a label
-- rather than a meaning hidden in an empty field.
ALTER TABLE partners ADD COLUMN display_name TEXT;

-- Which state a code's link opens, or null for the product's front door.
--
-- A driving school teaches in one state and every learner it sends is sitting
-- that state's paper, so the link it hands out should not begin by asking. The
-- column holds only what the link is built from: `/drivers/MD?ref=CODE` rather
-- than `/drivers?ref=CODE`, resolved by src/path.ts exactly as a search result
-- naming a state already is.
--
-- Deliberately not a restriction. A code with a state still works on every
-- state and every product it was ever good for -- this is where the link
-- *points*, not what the code is allowed to sell, and a partner whose learner
-- moves to Virginia still earns on that sale.
ALTER TABLE partner_codes ADD COLUMN state TEXT;

-- Whether this partner's business name stands in for ours on the screens the
-- learners they send are looking at.
--
-- Null is on, and that is what makes this column safe to add ahead of the code
-- that reads it: every row that exists today reads as "on", which is the
-- default a partner who never opens the switch goes on meaning, so nothing has
-- to be backfilled and an undeployed column cannot silently un-brand anybody.
--
-- It is not a consent mechanism and the empty business name that used to double
-- as one is gone: the name is required now, and this is the branding choice a
-- partner makes on purpose. Off means a learner sees HowardsLantern.com exactly
-- as they do today.
ALTER TABLE partners ADD COLUMN private_branding INTEGER;

-- What a code is for: a campaign a partner hands out, or an invite made for
-- one student.
--
-- An invite is a partner code minted for a single learner, carrying a label
-- the school chose -- "Maria P." -- so the roster can say who a row is and the
-- ready alert can say who is ready. A code and not a new table, because every
-- part of attribution already keys on the code: `referral_seen` carries it,
-- `learnerActivity` windows on it, and the commission is paid on it. A second
-- token in the URL would be a second attribution path that disagreed with the
-- first eventually, which is the failure `scripts/partners.ts` shipped once by
-- minting links of its own.
--
-- Default 'campaign', so every row that exists today keeps its meaning, and
-- NOT NULL so a mint site that forgets the column writes a campaign rather
-- than a row that is neither. Three readers would otherwise misread an invite
-- as a campaign -- the dashboard's code list, the code-state switch and
-- `deadLinks` -- and each filters on this. `label` on an invite is the first
-- human-chosen word this database holds about a learner; it lives as long as
-- the invite and is nulled when the invite is deleted or expires.
ALTER TABLE partner_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'campaign';

-- When the ready alert for this invite was sent, or null.
--
-- The claim, not the receipt: the row is stamped before the mail is handed to
-- the sender, in the same statement that reads the invite, so two beacons
-- arriving at once cannot both send. A send that then fails is logged and not
-- retried -- the alert is best-effort by design, and the roster is the record.
ALTER TABLE partner_codes ADD COLUMN notified_at INTEGER;

-- When the Green Light alert for this invite was sent, or null.
--
-- A second column rather than a second use of `notified_at`, because the two
-- alerts are independent facts: a student reaches Green Light (one full test
-- passed) and later Certified (three in a row), and the school is told about
-- each once. One column for both would let the first alert's claim swallow
-- the second, and the second is the one the pass-or-refund guarantee rests on.
-- Claimed before the mail is sent, exactly as `notified_at` is.
ALTER TABLE partner_codes ADD COLUMN green_light_notified_at INTEGER;

-- The language the buyer paid in: 'en' or 'es', and null on every row written
-- before this column existed -- all of them English, so it is read through
-- COALESCE(lang, 'en'). Recorded because it decides whether pass-or-refund
-- covers the purchase: the guarantee covers the English course only, and the
-- language at checkout is the one that counts (docs/plans/spanish-app.md, §6).
-- Applied to production by hand before the worker that writes it is deployed.
ALTER TABLE purchases ADD COLUMN lang TEXT;

-- The language a comment was written in, 'es' or null. Null is English: the
-- app sends the field only from a Spanish screen, so every row before a pack
-- existed, and every English one after, reads the same.
ALTER TABLE feedback ADD COLUMN lang TEXT;

-- Sales reps: a person who holds a state and earns on every sale in it
-- (docs/plans/sales-reps.md).
--
-- A rep is a `partners` row rather than a table of its own, because links,
-- sessions, the ledger, payouts, the W-9 gate and the admin log are all keyed
-- by `partner_id` and every one of them applies to a rep unchanged -- a second
-- table would be a second copy of partners.ts that drifts. The cost is that
-- every query meaning *the partners* has to say `role = 'partner'`. Default
-- 'partner' and NOT NULL, so every row that exists today keeps its meaning
-- and a writer that forgets the column writes a partner, never a row that is
-- neither.
ALTER TABLE partners ADD COLUMN role         TEXT NOT NULL DEFAULT 'partner';  -- partner | rep
-- For the CRM that follows. Shown to the operator and nowhere else.
ALTER TABLE partners ADD COLUMN phone        TEXT;
-- The states the applicant asked for, 'MD,VA'. An ask, not a holding: what a
-- rep holds is `territories`, and only an operator writes that.
ALTER TABLE partners ADD COLUMN wants_states TEXT;
-- The rep whose share link this partner applied from. A CRM fact and never a
-- money fact: nothing in commissions.ts, referral.ts or payouts.ts reads it,
-- which is what keeps this from being the second tier partners-v2 deleted.
-- tests/unit/partner-schema.test.ts asserts the absence.
ALTER TABLE partners ADD COLUMN recruited_by INTEGER REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_partners_recruited_by ON partners(recruited_by);

-- The state whose exam was bought, from the checkout's metadata. Not where the
-- buyer was standing -- that is `events.region`, and a rep is paid on the exam
-- their state sets, whoever sits it. Null on every row written before this
-- column existed, and on a session whose state did not look like one: those
-- earn no rep a commission, and `whyNoTerritoryCommission` says so.
ALTER TABLE purchases ADD COLUMN state       TEXT;
CREATE INDEX IF NOT EXISTS idx_purchases_state ON purchases(state, created_at);

-- Who held which state, when. Dated rows that are ended rather than deleted,
-- because "who was paid on Maryland in March?" is answered from here, and a
-- reassignment that overwrote the holder would make every commission written
-- before it unexplainable.
--
-- The holder of a state at instant t is the row with
-- assigned_at <= t < ended_at, a null `ended_at` meaning still held. The
-- partial unique index is what makes "one rep per state" a property of the
-- table rather than of the screen that assigns: a second live row for a state
-- is a constraint failure, not a quiet double commission.
CREATE TABLE IF NOT EXISTS territories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  state       TEXT    NOT NULL,                          -- 'MD'
  partner_id  INTEGER NOT NULL REFERENCES partners(id),
  assigned_at INTEGER NOT NULL,
  ended_at    INTEGER,                                   -- NULL while held
  assigned_by TEXT    NOT NULL                           -- the operator's address, or 'script'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_territories_held    ON territories(state) WHERE ended_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_territories_partner ON territories(partner_id, assigned_at);

-- The call list, moved off the Google Sheet (docs/plans/lead-desk.md). A lead
-- is an asset: sourced from a register, enriched by hand, and every one handed
-- to somebody is either being worked or has been accounted for. So a claim
-- ends only by an outcome or by the operator -- there is no expiry and no skip
-- -- and every hand-out, call, release and model assist is a `lead_log` row.
--
-- The sheet's columns as they were, less `state`, which is `lead_states` so a
-- school licensed in two states is one lead rather than two that get called
-- twice. `lead_id` is the sheet's own id and the only key a rep knows a lead
-- by; it is never reused.
CREATE TABLE IF NOT EXISTS leads (
  lead_id          TEXT PRIMARY KEY,               -- 'MD-013', the sheet's id, kept
  source_key       TEXT NOT NULL UNIQUE,           -- '<STATE>-<licence>' or the 8-char sha1
  business_name    TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'school', -- 'school' | 'instructor' | 'private_school'
  contact_name     TEXT, phone TEXT, email TEXT, website TEXT,
  address TEXT, city TEXT, zip TEXT, county TEXT,
  license_number   TEXT, source TEXT, source_url TEXT,
  date_added       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'new',
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_called      INTEGER,
  next_action_date TEXT,                           -- 'YYYY-MM-DD'
  claimed_by       TEXT,                           -- 'rep:<partnerId>' or the operator's address
  claimed_at       INTEGER,
  notes            TEXT NOT NULL DEFAULT '',
  written_prep     TEXT,                           -- 'yes' | 'no' | 'no-site' | NULL
  written_prep_evidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_claimed ON leads(claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_due     ON leads(next_action_date) WHERE next_action_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS lead_states (
  lead_id TEXT NOT NULL REFERENCES leads(lead_id),
  state   TEXT NOT NULL,
  PRIMARY KEY (lead_id, state)
);
CREATE INDEX IF NOT EXISTS idx_lead_states_state ON lead_states(state, lead_id);

CREATE TABLE IF NOT EXISTS lead_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  at               INTEGER NOT NULL,
  -- Null only on an `assist` row for a filter: asking for a lead is a model
  -- call made before there is a lead to name, and it is counted all the same.
  lead_id          TEXT REFERENCES leads(lead_id),
  owner            TEXT NOT NULL,
  kind             TEXT NOT NULL,                  -- 'claim' | 'call' | 'release' | 'assist'
  state            TEXT,                           -- the state the call was about
  status           TEXT,                           -- the status a call set
  outcome          TEXT,                           -- free text, as CallLog.outcome; the release reason
  notes            TEXT,
  next_action_date TEXT,
  direction        TEXT                            -- 'out' | 'in' | 'email'
);
CREATE INDEX IF NOT EXISTS idx_lead_log_lead  ON lead_log(lead_id, at);
CREATE INDEX IF NOT EXISTS idx_lead_log_owner ON lead_log(owner, kind, at);

-- Every law the ask box can quote, by id: what a nationwide question no topic
-- covers is answered from (docs/plans/nationwide.md, phase 2).
--
-- The vector index returns only ids, one namespace per state. For a state's
-- question the worker reads the words from that state's published file; for a
-- question across all of them it cannot, because the fifty-one files are 137 MB
-- and the worker reads one per question. So the hits' words are read from
-- here, with one SELECT per question, and never from anything carried on the
-- vector -- the index can rank badly but cannot put text on screen.
--
-- The rows are the published laws exactly (`lawsOf` in scripts/statutes/laws.ts,
-- the same output the files and the index are built from), plus the state.
-- `npm run laws:store -- --push` owns them: nothing else writes this table, and
-- resource/laws-store.json records a hash per state of what was pushed, which
-- tests/unit/laws-store.test.ts holds to the corpus. A corpus change deployed
-- without a push is red there rather than a quote of a law that is gone.
--
-- Apply this before the worker that reads it deploys: a worker reading a table
-- that is not there refuses every such question as `no-laws`.
CREATE TABLE IF NOT EXISTS laws (
  id       TEXT PRIMARY KEY,                        -- the law's id, "MD-C-21-902-a"
  state    TEXT NOT NULL,                           -- its state's code
  kind     TEXT,                                    -- 'statute', or NULL for the manual's
  law      TEXT NOT NULL,
  question TEXT NOT NULL,
  concept  TEXT NOT NULL,
  citation TEXT
);

-- The date each law was true as of (docs/plans/trusted-by-date.md, decision 6):
-- the day its section or its manual was fetched, as the published files carry
-- it. Without it the index path's citations went out undated -- the one place
-- in the box a law was quoted with no date under it, beside the topic path's
-- dated ones. Filled by the next `npm run laws:store -- --push --all`.
--
-- One-shot on production: SQLite has no ADD COLUMN IF NOT EXISTS, so applying
-- this statement to a table that already has the column fails, and it is run
-- once, by hand, before the worker that selects it deploys. A worker deployed
-- first refuses every index-path question `no-laws`, loudly.
ALTER TABLE laws ADD COLUMN as_of TEXT;

-- The section each statute row belongs to (docs/plans/what-happens-if.md,
-- decision 1): its citation's reference without the subsection, as
-- `sectionOf` in worker/src/law-nationwide.ts derives it and `laws:store`
-- writes it -- "Tex. Transp. Code § 521.025" for every one of (a) to (f).
-- NULL for a manual row. A learner asking what happens without a license was
-- given (b), the duty, alone; the fine in (c) and the defence in (d) are the
-- same section, and this is how the worker finds them.
--
-- One-shot on production, like as_of above: the ALTER, then the index, then
-- `npm run laws:store -- --push --all` to fill it. A worker deployed before the
-- ALTER logs "no such column" and gives the model the laws it chose, nothing
-- more; deployed before the push, every section is NULL and the same is true.
ALTER TABLE laws ADD COLUMN section TEXT;
CREATE INDEX IF NOT EXISTS idx_laws_state_section ON laws(state, section);

-- The court's fine schedule, by the section the `laws` table keys a statute
-- row by (docs/plans/what-happens-if.md, phase 2, decision 9). What a learner
-- pays is not in the code for most states: Maryland's § 16-112 says carry the
-- license and show it, and the $50 is the District Court's DC-CR-090, so the
-- box told a Maryland learner the laws "do not state the penalty". The worker
-- reads the rows for the sections a question's laws are in and gives each to
-- the model as a cited law after its section (`penaltiesForDb`,
-- worker/src/law-nationwide.ts).
--
-- `npm run penalties:fetch -- XX --push` owns the rows: each `quote` is a
-- line of the fetched schedule, checked as a substring of it before it was
-- written, and `as_of` is the day it was fetched. `code` is the schedule's own
-- reference ("16-112(c)") and `id` the law id made from it ("MD-P-16-112-c").
-- `appear` is 'payable' (paid without going to court), 'must-appear', or
-- 'court-sets' (no statewide figure: the row carries the code's range and the
-- answer must say the court sets it).
--
-- Created by hand on production before the worker that reads it deploys; a
-- worker deployed first logs "no such table" and answers without it, as
-- today. CREATE TABLE IF NOT EXISTS, so it is safe to repeat.
CREATE TABLE IF NOT EXISTS penalties (
  id             TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL,
  section        TEXT NOT NULL,
  code           TEXT NOT NULL,
  offence        TEXT NOT NULL,
  fine_text      TEXT NOT NULL,
  fine_min_cents INTEGER,
  fine_max_cents INTEGER,
  points         INTEGER,
  appear         TEXT NOT NULL CHECK (appear IN ('payable', 'must-appear', 'court-sets')),
  source_url     TEXT NOT NULL,
  source_title   TEXT NOT NULL,
  as_of          TEXT NOT NULL,
  quote          TEXT NOT NULL,
  PRIMARY KEY (state, section, offence)
);

-- The monthly list: what changed in state driving law
-- (docs/plans/trusted-by-date.md, decision 13). An address, the language it
-- asked in, and the three moments that matter -- asked, confirmed, left. A row
-- is written only after the challenge passes, and only one per address, so a
-- stranger cannot fill this table or mail somebody twice by asking twice.
--
-- `token` is the one secret here: the confirm and unsubscribe links carry it,
-- and nothing else can confirm or remove an address. Never shown on a page.
--
-- Nothing is sent from the worker but the confirmation itself: the monthly
-- mail is a person with a mail client and `npm run subscribers`, which lists
-- the confirmed addresses that have not left.
--
-- Apply this before the worker that writes it deploys (CREATE TABLE IF NOT
-- EXISTS is safe to repeat): a worker without the table answers every sign-up
-- with a 500 and sends nothing.
CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,          -- lower-cased
  lang            TEXT    NOT NULL,                 -- 'en' or 'es'
  created_at      INTEGER NOT NULL,                 -- seconds
  confirmed_at    INTEGER,                          -- NULL until the link in the mail is opened
  unsubscribed_at INTEGER,                          -- NULL while on the list
  token           TEXT    NOT NULL UNIQUE           -- 32 hex characters, in both links
);

-- Question tokens (docs/plans/trusted-by-date.md, decisions 22-24): a pack
-- bought through Stripe Checkout, held under a random code rather than an
-- account. `bought - spent` is the balance, and the worker is the only thing
-- that moves either column: the browser shows a count and is never asked for
-- one, so a request claiming tokens it does not have is refused here, not
-- trusted there.
--
-- `stripe_session` is UNIQUE because the webhook and the buyer's own return
-- both record the same session and either may arrive first; the second insert
-- must find the first and credit nothing. Without it a redelivered webhook is
-- a free pack.
--
-- Apply this before the worker that reads it deploys (CREATE TABLE IF NOT
-- EXISTS is safe to repeat): a worker without the table answers every paid
-- question, checkout and balance with a 500.
CREATE TABLE IF NOT EXISTS question_credits (
  code           TEXT    PRIMARY KEY,               -- ten characters of Crockford base32, shown as LQ-XXXXX-XXXXX
  bought         INTEGER NOT NULL,                  -- tokens paid for, carried-over remainders included
  spent          INTEGER NOT NULL DEFAULT 0,        -- tokens spent on questions, refunds already taken back
  created_at     INTEGER NOT NULL,                  -- seconds
  stripe_session TEXT    UNIQUE                     -- the Checkout session that paid for it
);

-- The code a paid question was paid with (decision 23), and since 2026-10-12
-- the code the asking browser holds on a free question too; NULL from a
-- browser holding none. `paid` below says which.
-- Joel, 2026-10-10: what buyers ask is to be readable by buyer, so this is the
-- one id deliberately joined to behaviour; docs/observability.md says why.
-- `npm run questions -- --code <code>` reads it.
--
-- One-shot on production: SQLite has no ADD COLUMN IF NOT EXISTS, so this is
-- run once, by hand, before the worker that writes it deploys. A worker
-- deployed first fails every question -- free ones too -- on the INSERT that
-- names the column.
ALTER TABLE learner_questions ADD COLUMN credit_code TEXT;
CREATE INDEX IF NOT EXISTS idx_learner_questions_credit ON learner_questions(credit_code);

-- Whether the question was paid for with a token. Until 2026-10-12 a code on
-- the row meant it was paid; now every question from a browser holding a code
-- carries it, so the daily ceiling over free questions counts this instead --
-- counted by the code, a held code would lift the ceiling for its holder.
--
-- One-shot on production, both statements, before the worker that writes the
-- column deploys: a worker deployed first fails every question on the INSERT
-- that names it. The UPDATE marks the rows written before, when a code on a
-- row meant exactly that it paid -- so run it immediately before `wrangler
-- deploy`, and never again: a paid question the old worker writes after it
-- stays `paid = 0` for good, and a re-run once the new worker is live would
-- mark its free code-holding rows as paid.
ALTER TABLE learner_questions ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
UPDATE learner_questions SET paid = 1 WHERE credit_code IS NOT NULL;
