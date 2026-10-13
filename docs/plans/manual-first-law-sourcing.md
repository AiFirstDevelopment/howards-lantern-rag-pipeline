# Manual-first law sourcing

A proposal to change where the facts in a corpus are allowed to come from, and
a specification of the edits that change makes to
[docs/plans/how-to-build-laws.md](how-to-build-laws.md).

Nothing here is applied yet. This document is the argument and the edit list;
`how-to-build-laws.md` is the thing that gets edited once this is accepted.

## One word, used strictly

**"The manual" always means the single PDF the state publishes** — the book a
learner is told to study. Maryland calls it the Driver's Manual, West Virginia
the Driver's Licensing Handbook; state manual, DMV manual, driver's manual and
handbook are all the same document, and this plan says "the manual".

What it is *not* is the rest of the agency's website. The DMV's test page, its
press releases and its FAQs are a different kind of source — same agency,
outside the book — and the whole rule below turns on keeping the two apart.
Where this plan means those, it says "the agency's test page" or "the agency
site", never "the manual".

## The failure

`how-to-build-laws.md` Phase 0 sends the author to the open web. It names four
*roles* a source plays and says to find something for each — the agency's site,
the manual, the statute, third-party miss-rates — and it treats them as
interchangeably authoritative because each answers a different question.

They are not interchangeable, and the consequence is the one that matters:
**we taught learners law that the permit test does not ask.** The statute is
larger than the handbook, and the handbook is what the test is written from. A
fact that is true, correctly cited to the Transportation Article, and absent
from the manual is a fact a learner spends study time on and never sees on the
paper. The app's whole claim is predictive validity; every off-syllabus law
spends that claim down.

The corpora record how far this went:

| | laws | citations | naming a manual page | non-agency sources |
|---|---|---|---|---|
| MD | 221 | 68 | 20 | 22 (driving-tests.org, nextdoordriving.com, legalclarity.org) |
| PA | 189 | 267 | 0 | 0 |
| VA | 333 | 384 | 286 | 0 |
| WV | 288 | 348 | 245 | 0 |

**164 of Maryland's 221 laws carry no citation of any kind** — neither
`citations` nor `examCitations`. Not a weak source: no source. Twenty-two of
the citations it does carry point at practice-test vendors and content farms,
which Phase 2 itself ranks as the weakest rung of evidence and says is "usable
to corroborate, never alone."

Pennsylvania is a subtler version of the same hole. Every law is cited, and
every citation points at `pa.gov/agencies/dmv/.../online-drivers-manual/...` —
the *live HTML* manual. Not one names a page, because the live edition has no
pages. A live URL is not a citation; it is a promise that a page said something
once. When PennDOT re-flows that site the corpus keeps its links and loses its
evidence, and nothing goes red.

Virginia and West Virginia already do close to the right thing — 286 and 245
citations respectively naming a page of a specific PDF. The new process is
mostly the codification of what those two did, plus the enforcement that would
have stopped the other two from drifting.

## The rule

**The state's own driver manual is the syllabus, and a law that is not in it
does not go in the corpus.** The manual is downloaded by hand, committed to
`src/assets/drivers-manuals/<CODE>.pdf`, and cited by page. Every other source
is demoted to a supporting role it may not play alone:

| Source | Was | Becomes |
|---|---|---|
| The state manual (local PDF) | one of four roles | **the syllabus.** Nothing enters the corpus without a page in it |
| The agency's test page / press releases | "what is tested" | still that — emphasis and exam shape only, never a law's substance |
| The statute | "what the number is" | **corroboration of a number the manual already states.** Never the reason a law exists |
| Third-party miss-rates | "what people get wrong" | unchanged: depth, never inclusion |
| Practice-test vendors | weakest rung | **barred.** They are how off-syllabus law got in |

The statute demotion is the load-bearing one. It stays essential — a manual
that says "the speed limit in a business district" without the number is
completed from the code, and that check is exactly what Phase 9 item 4 is
for. What it may no longer do is *originate* a law. The test asks what the
handbook teaches.

### Why manual-by-hand rather than fetched

Because every automatic version of this fails in a way nobody sees. A fetcher
gets a 200 and a login wall, or the Spanish edition, or the CDL manual, or a
2019 revision still sitting at the same URL as the 2026 one. The manuals differ
per state in exactly the ways that break scripts: Virginia's is one PDF at a
stable path, Pennsylvania's primary edition is a website with a PDF beside it
that lags, West Virginia's is a 17 MB InDesign export. A human opening the
agency's page, reading which edition is current, and saving the file is the
step that cannot silently pick up the wrong document.

## The directory

Committed, one file per state, named by the state's code — the same key as
`resource/corpus/drivers/<CODE>.json`, `public/audio/<CODE>/`, the manifest's
`code` and the progress key. The manual for a state is then reachable from its
corpus key with no mapping table and no hyphen-versus-dot question.

```
src/assets/drivers-manuals/
  MD.pdf   8.0 MB   56 pp   "Maryland Driver's Manual"
  PA.pdf   8.2 MB  104 pp   "PennDOT - Pennsylvania Driver's Manual"
  VA.pdf   2.3 MB   40 pp   Virginia Driver's Manual (DMV 39), April 2026
  WV.pdf  17.2 MB   90 pp   WV Driver's Licensing Handbook, 2022 update
```

The renaming from `maryland.pdf` / `west-virginia.pdf` is done; the content of
each file was checked against its own embedded title before the move.

**These are committed, at ~36 MB.** That is against the precedent in
`.gitignore`, which keeps `src/assets/bio-pics/` out so a 4.5 MB source does
not live forever in a repository whose build is 800 KB — and it is the right
exception, because a page-number citation is only checkable against the exact
bytes it was written from. An ignored manual makes every `page 34` in the
corpus unverifiable the moment the agency revises the PDF at the same URL. The
cost is understood and accepted: a new edition is a new blob, permanently.

Alongside them, `src/assets/drivers-manuals/SOURCES.json` — the same shape and
the same job as `src/assets/signs/SOURCES.json`, which the sign contract
already reads:

```jsonc
{
  "VA": {
    "url": "https://www.dmv.virginia.gov/sites/default/files/forms/dmv39.pdf",
    "edition": "Virginia Driver's Manual (DMV 39), April 2026",
    "retrieved": "2026-09-06",
    "sha256": "886137824ac880e7356d1d1ab2de5c3d38beef9a7287dbaa74d80d3b883a9428",
    "pages": 40,
    "pageOffset": 2,        // printed page N is physical page N + 2. See below
    "textLayer": "clean"    // clean | partial | none. See below
  }
}
```

`pageOffset` and `textLayer` are not bookkeeping. They are the two traps.

## The two traps, both measured on the files already here

### Printed pages are not physical pages

Virginia's corpus cites "Section 2, Traffic Signs — Sign Shapes, pages 6-7",
and `VA.json` says plainly that its page numbers are the PDF's *printed* pages.
Physical page 6 of `VA.pdf` is "Section 1: Testing — Road Skills Test". Sign
Shapes is physical page 8. A reviewer told to "open page 6 and check the quote"
finds a different section, reports the citation as wrong, and is themselves
wrong.

This is the failure mode this repo keeps rediscovering: it looks correct and
fails quietly, and it wastes the reviewer rather than alerting them. Recording
the offset once, per manual, converts it from a trap into arithmetic.

### A third of one handbook has no readable text

`pdftotext` extracts all four manuals — 19.8k, 58.2k, 21.1k and 23.0k words.
That number is a lie for West Virginia. Its contents page extracts as:

```
%SJWJOHJO0UIFS4UBUFT
'BJMVSFUP$PNQMZXJUI*O4UBUF$JUBUJPOT
```

which is "DrivingInOtherStates" and "FailureToComplyWithInStateCitations"
through a font whose encoding is shifted 31 code points down. **33 of WV.pdf's
90 pages come out as mojibake; 54 are clean.** A mechanical "does this quote
appear on this page" check therefore returns *no match* for a third of the West
Virginia handbook, and no-match is indistinguishable from a fabricated
citation.

So the check is worth having and must never be the only witness. `textLayer`
says which manuals it can speak about. On a `partial` or `none` manual the
human reads the page.

## The edits to how-to-build-laws.md

Section by section. The document is 617 lines and most of it is untouched —
Phases 1, 3, 4, 5, 6, 7, 8 and 10 do not change at all.

**1. Phase 0 — rewritten, and renamed.** "Sources, before any writing" becomes
**"The manual, before any writing."** The four-role table stays, because the
roles are real, but it is reordered under the rule above and gains a column
saying what each source may *not* do. The instruction to search the web for a
state's law is removed. New opening step: find the agency's current manual,
download it by hand, save it as `<CODE>.pdf`, record it in `SOURCES.json` with
its hash, page count, page offset and text-layer quality, and read the contents
page before writing a single law.

**2. Phase 0 gains "establishing the page offset."** Three lines: extract the
physical page that carries a section you can find in the table of contents,
subtract, write it down once. With the Virginia numbers above as the worked
example, because an abstract description of this will not land.

**3. Phase 0 gains "checking the text layer."** Run the extraction, eyeball a
few pages, set `textLayer`, and know that on `partial` and `none` manuals the
Phase 9 verification is a reading job with no mechanical backstop.

**4. Phase 2 — the evidence hierarchy is re-rooted.** Today its rung 1 is the
agency's statement of tested content and rung 2 the manual's structure. Those
swap in force but not in purpose: the manual becomes the gate on *what exists*,
and the agency's statement becomes the strongest evidence on *emphasis* —
which concept gets a second anchor, which gets more variations. Rung 5,
practice-test vendors, is struck. The section keeps its own best line, that
`examLikely` is not a likelihood filter.

**5. Phase 2 gains the citation contract.** A citation to the manual is
`{ source: "manual:<CODE>", location: "p.<printed> — '<quoted sentence>'",
supports: "…" }`. Naming the local manual by code rather than by URL is what
makes the citation checkable offline and stable across agency site
redesigns — the failure Pennsylvania is currently sitting on. The existing
`location` discipline, quote rather than summarise, is unchanged and is what
makes the whole thing verifiable.

**6. Phase 9 — item 4 is rewritten and an item 8 is added.** The adversarial
subagent's fact-check today says "against the primary sources". It becomes:
against the local PDF, at the physical page the offset resolves to, reporting
any quote the page does not carry. And a new item: **every law is traced back
to a page of the manual, and any law that cannot be is reported as
off-syllabus** — that is the check that would have caught this, and it belongs
to the reader rather than to a contract because it needs judgement about what
a paraphrase covers.

**7. "Honesty, which is the whole job" gains a paragraph.** It currently
frames invented *numbers* as the temptation. Off-syllabus law is the same
failure one level up — plausible, true, checkable, and still wrong to teach —
and it costs the learner study time rather than a wrong answer, which is why it
went unnoticed for four states.

**8. The two lines of housekeeping.** Phase 6's metadata table gains
`sourceManual` pointing at the committed file; Phase 8's command list gains
whatever guard lands from the next section.

## Guards

Three worth adding, all mechanical, all cheap. Each is mutation-tested per
CLAUDE.md — break the thing, watch it go red, restore.

1. **Every state in the manifest has a manual, a `SOURCES.json` record, and a
   file whose sha256 matches.** Catches a manual replaced by a newer edition
   without the citations being re-checked, which is the silent version of every
   page number in the state going stale.
2. **No cited printed page exceeds `pages - pageOffset`.** Currently green on
   all three states that cite pages (highest cited: MD 52 of 56, VA 34 of 40,
   WV 72 of 90), which is the point — it holds today and catches invention
   tomorrow.
3. **Every pooled law carries at least one citation.** Fails Maryland at 164
   laws today, so it lands with the Maryland backfill and not before.

And one deliberately **not** a guard: no test asserts that a quoted `location`
string appears in the extracted page text. It cannot distinguish a bad quote
from West Virginia's 33 unreadable pages, and Phase 9's own reasoning about the
similarity check applies exactly — a test nobody can keep green gets switched
off. It belongs in the verification script the subagent runs, where a no-match
is reported for a human to adjudicate rather than failing a build.

## What this does to the four states already shipped

The rule is retroactive in principle and staged in practice. Each is its own
work item, in this order, because they are different sizes of problem:

First, how far off each one actually is. Numbers are the falsifiable subset —
a speed limit, an age or a BAC threshold is either in the book or it is not —
so the cheap measurement is whether every number a law states appears anywhere
in that state's manual:

| | laws | stating a number | number absent from the manual |
|---|---|---|---|
| **MD** | 221 | 56 | **11 (20%)** |
| PA | 189 | 48 | 3 (6%) |
| VA | 333 | 68 | 0 |
| WV | 288 | 69 | 2 (3%) |

Maryland is the outlier and the others are nearly clean, which settles the
scope: **rebuild Maryland, re-cite the rest.** Deleting Virginia's 333 laws to
re-derive them from the same manual they already cite costs weeks and buys
nothing measurable.

The absent Maryland numbers are worth reading, because none of them is *wrong*:
`0.07` (the DWI threshold), `0.02` (under-21), a `$570` school-bus fine, the
`1967` seat-belt requirement. They are true, statutory, and not in the book the
learner is told to study — which is precisely the failure this plan exists to
stop, and it is invisible to every contract in `tests/unit/`.

**Read the table as a floor, not a score.** It only sees laws that state a
number, which is a quarter of each corpus; a law with no figure in it can be
just as far off-syllabus and this test cannot tell. It also had to be told that
Maryland's manual writes `.08` rather than `0.08` — the first run of it
reported the most famous number in drunk-driving law as missing from the book,
which is a fair warning about how much weight one clever script should carry.
The real check is Phase 9's reader.

| State | Problem | Work |
|---|---|---|
| **VA** | none found | Record `SOURCES.json`; convert URL citations to `manual:VA`. Smallest and cleanest, so do it first and let it prove the citation format |
| **WV** | 2 laws | Same, plus `textLayer: "partial"` and the note about which 33 pages a checker cannot read. Adjudicate the 2 by hand |
| **PA** | 3 laws; 267 citations naming no page, all at a live HTML site | Re-cite against `PA.pdf`. Settle which edition is authoritative — `PA.json` currently hedges that the PDF is "a traceable secondary edition", which under this rule inverts |
| **MD** | 164 laws with no citation at all; 22 citations from vendors and content farms; 11 numbers absent from the manual | **Rebuilt from `MD.pdf`.** Every law is traced to a page or dropped. Expect the pool and concept counts to move |

### Maryland's audio is the only part that costs money

Maryland is the one recorded state — 1,438 clips, 53 MB, paid for by the
character. It is not a reason to avoid the rebuild, because
`scripts/voice.ts` names each clip after a hash of the sentence it speaks:
**only text that actually changes is re-rendered**, unchanged laws keep the
clips they have, and `--prune` deletes the orphans a rewrite leaves behind.

The order matters and Phase 10 already says why: render last. A law rewritten
after verification renames its clip and orphans the recording, so the rebuild
finishes, gets checked, and only then is
`npm run voice -- --dry-run` run to see the character count and cost before
anything is spent.

Once the rebuild lands, `tests/unit/audio-clip.test.ts` stops skipping and
starts requiring a clip for every spoken string — so a law edited without
re-rendering is a red build rather than a card that has quietly gone silent.

One thing to fix while in there: `MD.json`'s `factCheck` says "62 of 201 laws
contain a figure". The corpus holds 221. Prose in `metadata` is not checked
against the corpus the way the `conceptModel` counts are, so it drifted exactly
as Phase 6 says derived numbers do — and nothing went red.

## Not in scope

- **Extracting the manual into anything.** No index, no chunking, no search
  layer. The PDF is read by a person or by a subagent that opens it; a derived
  artefact is another thing to keep in sync with the source.
- **Removing the statute.** It corroborates numbers, which is the job Phase 9
  item 4 already gives it and the one it is genuinely best at.
- **Any change to `src/`.** The completion invariant in Phase 7 holds:
  adding a state stays data, assets and provenance. `drivers-manuals/` is
  provenance — nothing imports it, nothing bundles it.
- **A second product.** `drivers-manuals/` is named for the product it serves.
  A hunting corpus gets `hunting-manuals/`, and the question of whether that
  should instead be `manuals/<product>/<CODE>.pdf` is worth asking on the day
  there is a second product and not before.

## The one exception to the gate

A law the agency's *test page* says is tested but the manual does not cover is
allowed in, and must carry an `offManual` field naming the agency source that
puts it on the paper. It is rare and it is real — Maryland's press release
names hands-free driving and sharing the road with bicyclists as tested topics
in a sentence that already justified 23 citations.

The alternative, barring it outright, was rejected for the reason a bare ban
usually is: the fact is genuinely on the test, so it gets smuggled in later
under a vague manual citation, and then it is indistinguishable from a real
one. An honest flag is worth more than a rule nobody can follow. The field also
makes the exceptions countable — a state that accumulates thirty of them is
telling us something about its manual, not about its corpus.

That count is worth watching rather than capping. No threshold is set here,
because the first state to go near one will be the evidence for where it
belongs.
