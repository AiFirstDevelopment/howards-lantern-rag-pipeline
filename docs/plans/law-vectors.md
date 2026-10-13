# Law vectors: finding the law by meaning as well as by its words

Written 2026-10-05, after [learner-ask-law](learner-ask-law.md) and the
Maryland [statute corpus](statute-corpus.md) went live. Joel's brief: do not
wait for the logs to show learners leaving because the box missed a law it
had; add a vector search beside the word search now, since it is cheap.

## Intent

BM25 finds a law that shares the question's words. It misses a law that
answers the question in other words ("fireplug" against "fire hydrant") and,
entirely, a question in Spanish against the English corpus. A vector index
finds a law by meaning. The box now asks both and merges their rankings by
reciprocal rank, so a law near the top of either reaches the model.

Nothing about what is shown changes. The index returns ids only; the law's
words and citation come from the published `/ask-laws/<CODE>.json` by id,
and `checkLawAnswer` decides what is shown exactly as before. A wrong or
stale vector can rank a law badly. It cannot put text on screen.

## Decisions

1. **Model: `@cf/baai/bge-m3`** on Workers AI, because it is multilingual. A
   Spanish hydrant question scores 0.73 cosine against Florida's English law.
2. **Index: Vectorize `howard-laws`**, 1024 dimensions, cosine, **one
   namespace per state**, so a query cannot return another state's law.
3. **What is embedded:** each law's rule and its card's question, which is
   how a learner would ask it. Every law in the retrieval file is embedded,
   manual and statute alike.
4. **Ingestion is a script, not part of a deploy.**
   `npm run laws:embed -- --push [CODE]` embeds and upserts the states whose
   laws changed. `resource/law-vectors.json` records a hash of what was
   embedded per state, and `tests/unit/law-vectors.test.ts` recomputes it. A
   corpus or statute change that was not re-embedded is red in the suite.
5. **Fusion: reciprocal rank** (k = 60) over BM25's top 16 and the index's
   neighbours above `NEAR_ENOUGH`, cut to the usual 8. With no index answer,
   retrieval is BM25 alone, byte for byte.
6. **Failure is BM25.** Without the binding, or if the index or the model
   throws, the box retrieves exactly as it did before, and the error is
   logged.
7. **Bindings:** `[ai]` and `[[vectorize]]` in `worker/wrangler.toml`. The
   workerd suite injects `nearLaws` and never calls either.

## Acceptance criteria

1. A Spanish question with no word in common with the English law reaches
   that law and is answered from it, with its citation.
2. When the index or the model throws, the box answers from BM25 alone.
3. An id the index returns that the state's published file does not hold is
   never given to the model.
4. Every published state's laws are embedded as they currently are, or the
   unit suite is red and names the command that fixes it.

## Non-goals

- Replacing BM25.
- Embedding anything but the laws: not the app book, and not the FAQ.
- A reranking model.
