import { describe, expect, it } from 'vitest'
import { corpus as rawLaws } from './corpus'

/**
 * These are US state exams, written for US learners.
 *
 * Maryland shipped with 58 British forms in it — "licence", "kerb", "tyre",
 * "windscreen", "give way", "junction" — and Pennsylvania and West Virginia
 * picked more up when their prose was rewritten, because whoever is writing
 * reaches for the register they think in. None of it is wrong exactly, which
 * is the problem: a learner reads "give way" and "kerb" on a Maryland test and
 * quietly wonders whether this app knows which country it is in. The real
 * handbooks say yield and curb, and the exam will too.
 *
 * This is spelling and idiom only. It has nothing to say about whether a
 * sentence is any good — tests/unit/readability.test.ts holds that.
 */
const STATES = Object.keys(rawLaws)

/**
 * Forms that are unambiguously British, paired with what a US handbook says.
 *
 * Deliberately excludes the words that are merely more common one side of the
 * Atlantic than the other. "Pavement" is the road surface in every US driver's
 * handbook, so it cannot be banned; "roundabout" is the MUTCD's own word; and
 * "overtaking" appears in US traffic statutes even though handbooks prefer
 * passing. A list that flagged those would be a list nobody could keep green,
 * and it would be switched off.
 */
const BRITISH: [RegExp, string][] = [
  [/\blicence\b/i, 'license'],
  [/\bcolour/i, 'color'],
  // `centres` and `centred` walk straight past a `\bcentre\b` that cannot see a
  // suffix. Oregon shipped "shopping centres" onto its own indexed parking page
  // and "Sitting centred" onto a study card through this list, and "bonnet"
  // reached an answer option with nothing at all looking for it.
  [/\bcentres?\b/i, 'center'],
  [/\bcentred\b/i, 'centered'],
  [/\bbonnet\b/i, 'hood'],
  [/\bkerb/i, 'curb'],
  [/\btyres?\b/i, 'tire'],
  [/\bmetres?\b/i, 'meter'],
  [/\bdefence\b/i, 'defense'],
  [/\boffences?\b/i, 'offense'],
  [/\bbehaviour/i, 'behavior'],
  [/\bneighbour/i, 'neighbor'],
  [/\bfavour/i, 'favor'],
  [/\bgrey\b/i, 'gray'],
  [/\bprogramme\b/i, 'program'],
  [/\bpractise\b/i, 'practice (verb)'],
  [/\banalyse\b/i, 'analyze'],
  [/\btravell(ing|ed)\b/i, 'traveling / traveled'],
  [/\bsignall(ing|ed)\b/i, 'signaling / signaled'],
  [/\bcancell(ing|ed)\b/i, 'canceling / canceled'],
  [/\bmodell(ing|ed)\b/i, 'modeling / modeled'],
  [/\bjudgement\b/i, 'judgment'],
  [/\bwindscreen\b/i, 'windshield'],
  [/\bwhilst\b/i, 'while'],
  [/\bamongst\b/i, 'among'],
  [/\b(learnt|spelt|burnt|dreamt)\b/i, 'learned / spelled / burned / dreamed'],
  [/\bgives? way\b/i, 'yield'],
  [/\bgiving way\b/i, 'yielding'],
  [/\blorr(y|ies)\b/i, 'truck'],
  [/\bmotorway\b/i, 'highway'],
  [/\bpetrol\b/i, 'gasoline'],
  [/\bcar park\b/i, 'parking lot'],
  [/\bchemist\b/i, 'drugstore'],
  [/\bfootpath\b/i, 'sidewalk'],
  [/\banticlockwise\b/i, 'counterclockwise'],
  [/\bjunction\b/i, 'intersection'],
  [/\bqueue/i, 'line of traffic'],
  // Connecticut's review found nine British strings this list walked past, two
  // of them selectable answer options. `why` is what a learner is shown when
  // they miss a card, so it is as visible as the option itself, and that is
  // where most of them were. Only the three that are clean across all thirteen
  // corpora are added here. The other six -- `reversing lights`, `carriageway`,
  // `paintwork`, `blind bend`, `dazzle`, and `round` used for `around` -- are
  // live in twenty-four strings across nine already-published states, so
  // widening to them reddens a shipped fleet and belongs in its own change;
  // docs/work/connecticut-corpus/verdict.md lists all twenty-four by id.
  // `tiredness` is deliberately absent: Connecticut's own manual uses it, and
  // the rule in this file is that the handbook wins.
  [/\bfortnight\b/i, 'two weeks'],
  [/\bshunt\b/i, 'rear-end crash'],
  [/\bpillion\b/i, 'passenger'],
  // The -ise family, named word by word rather than by a `\w+ised` pattern that
  // would also condemn advised, raised, supervised and surprised -- which is why
  // the list had only `analyse` and why everything else in the family got
  // through. Oregon shipped "recognising" into a law the Key numbers page prints
  // and "motorised" onto a study card; Ohio shipped "realising" into two
  // questions and has been live with them since.
  [
    /\b(?:recognis|realis|organis|apologis|emphasis|minimis|maximis|prioritis|summaris|memoris|utilis|categoris|criticis|motoris|legalis|penalis|specialis|authoris|analys)(?:e|es|ed|ing)\b/i,
    'the -ize / -yze spelling',
  ],
]

/**
 * A citation quotes what a source actually says, so it is reproduced as
 * written. If a state's own handbook says something in a way this list
 * dislikes, the handbook wins and the quotation stands.
 */
function learnerVisibleText(law: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['law', 'why', 'question'] as const) {
    const value = law[key]
    if (typeof value === 'string') out.push(value)
  }
  const answers = law.answers as { answer: string }[] | undefined
  for (const answer of answers ?? []) out.push(answer.answer)
  return out
}

for (const code of STATES) {
  const state = rawLaws[code] as { laws: Record<string, unknown>[]; metadata: unknown }

  describe(`${code} is written in the English its learners are tested in`, () => {
    it('uses US spelling and idiom everywhere a learner can see it', () => {
      const found: string[] = []
      for (const law of state.laws) {
        for (const text of learnerVisibleText(law)) {
          for (const [pattern, american] of BRITISH) {
            const hit = pattern.exec(text)
            if (hit !== null) found.push(`${law.id as string}: "${hit[0]}" — use "${american}"`)
          }
        }
      }
      expect(found).toEqual([])
    })

    it('keeps the same register in the metadata, which is where drift starts', () => {
      // The corpus notes are written by whoever wrote the laws, in the same
      // sitting and the same voice, so they are the leading indicator.
      const text = JSON.stringify(state.metadata)
      const found = BRITISH.filter(([pattern]) => pattern.test(text)).map(
        ([pattern, american]) => `${pattern.exec(text)?.[0]} — use "${american}"`,
      )
      expect(found).toEqual([])
    })
  })
}
