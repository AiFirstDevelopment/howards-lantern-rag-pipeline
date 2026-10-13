# How the answers are made

This page says how the ask box and the state-by-state comparisons on this site are made: what they read, how a law is found, how an answer is checked before anyone sees it, what has been measured, and what they do not do. Every count on it is computed from the laws the site publishes, at the moment the page was built; every measurement is copied from the record of the change that made it, and names that record.

## What the box reads

The box answers road-law questions from two kinds of source and nothing else: each state's own driver manual, and, for {{codeStates}} of the {{states}}, the state's vehicle code, fetched from the legislature's own site or the publisher it designates. A manual law is a rule a person wrote from the manual, stored with the manual's page and the manual's own sentence; a test finds that sentence, word for word, in the manual's text. A code law is a subsection of a section cut exactly as the state prints it, and a test finds every one of them verbatim in the file that was fetched. Each fetched file is kept with the address it came from, the day it was fetched and a hash of its text, so anyone can see whether the law has changed since.

{{counts}}

Each law carries the date it was true as of. A code law's is the day its section was fetched. A manual law's is the day the manual it was written from was fetched from the agency that publishes it, recorded with the manual's address, a hash of the file and, where the manual prints one, its edition. The date is when the source was read, not when the law was enacted: a law can be older, and a later edition can change it. Under an answer, beside each comparison and in each downloaded file, that date is shown with the law.

## How a law is found

A question is first said again in the words the law uses, by a small model asked for a search or two in the vocabulary of a vehicle code — "maximum speed limit" where a learner wrote "fastest you can drive". Then two searches run over the state's laws, for the question and for each restatement: one by the words they share, and one by meaning, against an index of every law. The two rankings are merged, so a law high on either reaches the shortlist. A second small model reads the question beside the shortlist and picks the laws that actually answer it; only those are given to the model that writes the answer.

If either small model is slow or unavailable, the box searches with the question alone and answers from what the searches found, rather than not answering.

## How an answer is checked

The model that writes the answer is told to answer only from the laws it was given, and to cite them. What it writes is then checked before it is shown, and refused if any check fails:

- every law it cites must be one it was given, so a law from its memory is never shown;
- every figure in the answer — a distance, a speed, a fine, an age, a number of days — must be stated by one of the laws it cites, in that law's rule or its quoted words;
- a page or section it names must be one a cited law is on.

What the reader sees under the answer is not the model's account of its sources: it is each cited law's own citation, taken from the published laws, with the page of the manual or the section of the code and the date. When nothing it was given answers the question, the box says so instead of answering.

## What nationwide does

Ticked Nationwide, the box compares every state on one question. For the rules this site has compared — {{topics}} of them — a person or a model reading the state's laws chose, for each state, the one law that states the rule, or recorded that the state says nothing on it; those choices are the comparison pages, and a nationwide answer is written from exactly those laws, one per state, with the states that say nothing named under it. A question about a subject several rules make up, like drunk driving, reads up to four of them together.

A question no compared rule covers is answered from each state's nearest laws by meaning, found in every state's index at once, and checked the same way.

## What is measured

The box is measured against a fixed set of questions with known answers, asked through the same steps a reader's question takes, and changes to how a law is found are measured on questions asked of every state. Each figure below is copied from the record of the change it measured, which says how it was measured; none is written here first.

{{measurements}}

## What it does not do

- It does not read regulations, court decisions or local ordinances: a city's parking rule or a judge's reading of a statute is not in it.
- It does not read a manual's later edition until the site's copy is rebuilt from it, and it does not read a code's later amendment until the section is fetched again. Between those, it is a snapshot, dated as above. Once a month every section is fetched again and compared with its copy; [what changed](/drivers/laws/changes/) is listed, and a change reaches the answers only after a person has read it.
- It does not answer for a state you did not choose, unless Nationwide is ticked.
- It is not legal advice, and it is not the state's own site. The manual or the code it cites is what counts.
