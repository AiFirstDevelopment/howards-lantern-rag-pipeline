/**
 * Every word a learner reads that is not a law, in English and in Spanish
 * (docs/plans/spanish-app.md, §1).
 *
 * One table per language, keyed by where the string appears, and read through
 * `useStrings()` in src/language.ts. No i18n library: the app has one switch and
 * no plurals a ternary cannot carry, and a dependency is a lockfile change this
 * repo has paid for before.
 *
 * **A leaf module.** It imports nothing from the app but types, so src/exam.ts,
 * src/pitch.ts and src/method.ts can build their sentences from it without an
 * import cycle, and the unit suite can read both tables with no corpus loaded.
 * Numbers and names arrive as arguments for the same reason.
 *
 * **The Spanish is complete, with no allow-list.** `es` is typed as `Strings`,
 * so a key missing from it does not compile, and tests/unit/strings.test.ts
 * holds the flattened key sets equal as well -- a string that falls back to
 * English on a Spanish screen is the failure nobody reading Spanish would
 * report, because they would not know it was meant to be otherwise.
 *
 * The register is *usted* throughout, the register of every state's Spanish
 * handbook and of the exam the cards will quote; *manejar* and *carro*, never
 * *conducir* or *coche*; every number, unit and proper noun as the English has
 * it. HowardsLantern.com, Stripe and a school's display name are never
 * translated. The paywall's guarantee is not in either table: it is rendered in
 * English only, by condition, so no later translation pass can add it by
 * filling a gap (src/screens/Paywall.tsx).
 */

export type Lang = 'en' | 'es'

/** A run of text with bold parts, for a sentence that carries `<b>` inside it. */
export type Rich = readonly (string | { b: string })[]

/** One level's words: what it is called, what it took, and what to post. */
export interface LevelWords {
  name: string
  earnedBy: string
  /** With `{state}` standing in for the state's name. */
  share: string
}

interface Floor {
  passMark: number
  questions: number
  name: string
}

/**
 * An ISO date as a learner reads it: "6 Oct 2026", "6 oct 2026". The months are
 * written out here rather than asked of `Intl`, whose short months differ by
 * engine and by ICU version -- Node writes "Sept" where an older Chromium
 * writes "Sep" -- and a date a test reads one way and a phone another is a date
 * nobody can hold. Read as a calendar day, never through the browser's clock or
 * zone. A string that is not a date is shown as it came rather than as
 * "Invalid Date".
 */
const MONTHS: Record<Lang, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}

export function shortDate(iso: string, lang: Lang): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const month = parts === null ? undefined : MONTHS[lang][Number(parts[2]) - 1]
  if (parts === null || month === undefined) return iso
  return `${Number(parts[3])} ${month} ${parts[1]}`
}

const en = {
  /** The language switch and the translation line (§3). */
  lang: {
    label: 'Language',
    english: 'English',
    spanish: 'Español',
    /** In Spanish on every screen: it is read by somebody looking for Spanish. */
    unavailable: 'Español todavía no está disponible para este estado.',
  },
  common: {
    back: 'Back',
    backTop: '← Back',
    continue: 'Continue',
    notNow: 'Not now',
    keepGoing: 'Keep going',
    backToHub: 'Back to the hub',
    backToCard: 'Back to the card',
    startStudying: 'Start studying',
    backToStudying: 'Back to studying',
    readable: (concept: string) => concept.replaceAll('-', ' '),
  },
  chrome: {
    menu: 'Menu',
    readAloud: 'Read aloud',
    readAgainLabel: 'Read this again',
    readAgain: 'Read again',
    previousConcept: 'Previous concept',
    nextConcept: 'Next concept',
    of: (count: number | undefined, max: number) => `${count} of ${max}`,
    openMap: (label: string, count: number, max: number) =>
      `${label}: ${count} of ${max}. Open the section map.`,
    course: 'Course',
    courseNames: { full: 'Full course', short: 'Short course' },
    cards: (count: number) => `${count} cards`,
    levelOf: (earned: number, total: number, name: string | null) =>
      `Level ${earned} of ${total}${name === null ? '' : `: ${name}`}`,
    partnerAsk: 'Teach driving or run a school?',
    partnerInvite: 'Partner with us',
    /** Read aloud unavailable in Spanish on this device (§9). */
    speechUnavailable: '',
  },
  /** The top bar's labels, which App.tsx composes. */
  status: {
    section: (index: number, total: number) => `Section ${index} of ${total}`,
    everyLaw: (stateName: string | null) => `Every ${stateName} law`,
    retest: 'retest',
    shortTest: 'short test',
    practiceTest: 'practice test',
    restudy: 'restudy',
    certified: 'prepared',
    passOne: 'pass 1 test',
    inARow: (streak: number, requires: number) => `${streak} of ${requires} passed in a row`,
  },
  milestones: {
    threeQuarters: 'Three quarters of the way',
    half: 'Halfway',
    quarter: 'A quarter of the way',
  },
  errors: {
    notConfirmed: (email: string) =>
      'We could not confirm that payment. If you were charged, email ' + email + '.',
    checkoutUnavailable: 'Checkout is unavailable right now. Please try again in a moment.',
    deviceLimit:
      'That code is already in use on the maximum number of devices. Open the app on one of those, or contact support.',
    unrecognised: 'That code was not recognized. Check it and try again.',
    crashHeading: 'Something went wrong',
    crashBody: 'Your progress is saved. Reloading should put you back where you were.',
    crashRetry: 'Try again',
  },
  levels: [
    {
      name: 'Green Light',
      earnedBy: '1 test passed',
      share: 'I passed a practice permit test for {state}.',
    },
    {
      name: 'Cruise Control',
      earnedBy: '2 tests passed in a row',
      share: 'That’s 2 practice permit tests in a row for {state}.',
    },
    {
      name: 'Prepared',
      earnedBy: '3 tests passed in a row',
      share: 'I’m ready for my {state} permit test.',
    },
  ] as LevelWords[],
  exam: {
    subject: 'A test is',
    subjectChosen: 'This practice test is',
    flat: (subject: string, questions: number, passMark: number) =>
      `${subject} ${questions} questions and ${passMark} right is a pass.`,
    total: (subject: string, questions: number, passMark: number, floors: readonly Floor[]) =>
      `${subject} ${questions} questions and ${passMark} right is a pass, ` +
      `and at least ${floors
        .map((floor) => `${floor.passMark} of the ${floor.questions} ${floor.name.toLowerCase()} questions`)
        .join(' and ')} have to be right.`,
    parts: (subject: string, questions: number, parts: readonly Floor[]) =>
      `${subject} ${questions} questions in ${parts.length} parts — ` +
      `${parts
        .map((part) =>
          part.passMark === part.questions
            ? `${part.questions} ${part.name.toLowerCase()}, all ${part.questions} right`
            : `${part.questions} ${part.name.toLowerCase()}, ${part.passMark} right`,
        )
        .join('; ')} — and every part has to be passed.`,
    noteBothChosen: (stateName: string, questions: number, passMark: number) =>
      `${stateName} does not publish how many questions its knowledge test asks, ` +
      `or the score that passes it. This practice test asks ${questions} ` +
      `and passes at ${passMark}.`,
    noteQuestionsChosen: (
      stateName: string,
      questions: number,
      percent: number,
      derived: boolean,
      cite: string,
    ) =>
      `${stateName} does not publish how many questions its knowledge test asks. ` +
      `This practice test asks ${questions}, and passes at the ${percent}% ` +
      `${derived ? 'that follows from' : 'set by'} ${stateName}’s own rules${cite}.`,
    notePassMarkChosen: (stateName: string, questions: number, passMark: number, cite: string) =>
      `${stateName} states that its knowledge test asks ${questions} ` +
      `questions${cite} but does not publish the score that passes it. ` +
      `This practice test passes at ${passMark}.`,
    noteDerived: (stateName: string, questions: number, passMark: number, cite: string) =>
      `${stateName} does not state the score that passes its knowledge test ` +
      `directly: ${passMark} of ${questions} follows from what it does ` +
      `state${cite}.`,
    // The same four disclosures, said of one part of a paper scored in parts,
    // and a fifth naming the parts that need none. Each names the part so the
    // sentences can sit beside `parts` above and be read against it.
    notePartQuestionsChosen: (
      stateName: string,
      part: Floor,
      percent: number,
      derived: boolean,
      cite: string,
    ) =>
      `${stateName} does not publish how many questions the ${part.name.toLowerCase()} part ` +
      `of its knowledge test asks. This practice test asks ${part.questions} there, and ` +
      `passes it at the ${percent}% ${derived ? 'that follows from' : 'set by'} ` +
      `${stateName}’s own rules${cite}.`,
    notePartBothChosen: (stateName: string, part: Floor) =>
      `${stateName} does not publish how many questions the ${part.name.toLowerCase()} part ` +
      `of its knowledge test asks, or the score that passes it. This practice test asks ` +
      `${part.questions} there and passes it at ${part.passMark}.`,
    notePartPassMarkChosen: (stateName: string, part: Floor, cite: string) =>
      `${stateName} states that the ${part.name.toLowerCase()} part of its knowledge test ` +
      `asks ${part.questions} questions${cite} but does not publish the score that passes ` +
      `it. This practice test passes it at ${part.passMark}.`,
    notePartDerived: (stateName: string, part: Floor, cite: string) =>
      `${stateName} does not state the score that passes the ${part.name.toLowerCase()} ` +
      `part of its knowledge test directly: ${part.passMark} of ${part.questions} follows ` +
      `from what it does state${cite}.`,
    notePartsOwn: (stateName: string, parts: readonly Floor[]) =>
      `The ${parts
        .map((part) => `${part.name.toLowerCase()} part, ${part.passMark} of ${part.questions},`)
        .join(' and the ')} ${parts.length === 1 ? 'is' : 'are'} ${stateName}’s own.`,
    hintFirst: (requires: number, timed: boolean, name: string) =>
      requires === 1
        ? `Pass 1${timed ? ' timed' : ''} test to earn ${name}.`
        : `Pass ${requires}${timed ? ' timed' : ''} tests in a row to earn ${name}.`,
    hintMore: (need: number, timed: boolean, name: string) =>
      need === 1
        ? `Pass 1 more${timed ? ' timed' : ''} test to earn ${name}.`
        : `Pass ${need} more${timed ? ' timed' : ''} in a row to earn ${name}.`,
  },
  readiness: {
    verdicts: { 'Getting started': 'Getting started', 'Closing in': 'Closing in', Ready: 'Ready' },
    odds: 'One pass predicts about a three-in-four chance on the day; three in a row, about nine in ten.',
    ready: (streak: number) =>
      `${streak} tests passed in a row — that is the bar, and you have cleared it. Go and book the real one.`,
    restarted: (odds: string) =>
      `The run restarts at zero — passes have to come back to back. Take the next one. ${odds}`,
    begin: (odds: string) => `Pass one test and the run begins. ${odds}`,
    oneDown: (need: number, odds: string) => `One down. ${need} more in a row and you are there. ${odds}`,
    inARow: (streak: number, need: number) =>
      `${streak} in a row. ${need === 1 ? 'One more' : `${need} more`} and you are ready.`,
  },
  pitch: {
    freeSections: (free: number) => (free === 1 ? 'section' : `${free} sections`),
    yourState: 'your state',
    why: (whose: string, free: number, top: string) => [
      {
        title: `Written from ${whose}’s own manual`,
        text:
          `Every rule here comes out of the driver manual ${whose} publishes, one rule at a ` +
          'time with the reason behind it, and a question on it while it is still fresh. Get it ' +
          'wrong and you have found the gap now, not on the morning of the exam.',
      },
      {
        title: 'One payment, no subscription',
        text:
          'One payment, once. Nothing renews, there is nothing to cancel, and no ' +
          'reminder to set. ' +
          `The 10-question test and the first ${
            free === 1 ? 'section' : `${free} sections`
          } of cards are free; the payment is the rest of the cards and the full tests ` +
          `that carry you to ${top}.`,
      },
      {
        title: 'No account, no name',
        text:
          'Your progress lives on this device. There is nothing to sign into and nothing to ' +
          'delete afterwards, nothing here knows who you are, and the short list of what is ' +
          'counted is on the',
        link: { text: 'privacy page', href: '#privacy' },
      },
    ],
    refundPromise: 'Do the work, fail the real exam, and we refund you.',
    // The refund promise rides on the English line only: pass-or-refund does
    // not cover the Spanish course (§5), so the Spanish line stops before it.
    freeToStart: (free: number) =>
      `Free to start: a 10-question test and the first ${
        free === 1 ? 'section' : `${free} sections`
      } of cards. No sign-up, no account. Do the work, fail the real exam, and we refund you.`,
    difference: {
      title: 'Not a bank of random questions',
      text:
        'Most practice sites hand you a pile of questions and let you find the gaps by ' +
        'failing. Here every question is attached to the rule it tests and the reason ' +
        'that rule exists, so a wrong answer sends you back to something you can read ' +
        'rather than to a score you cannot act on.',
    },
    coverage:
      'The practice papers are shaped to your state’s real exam — same pass mark, and ' +
      'the same number of questions wherever the state publishes one.',
  },
  method: {
    method:
      'read one law and the reason behind it, then answer a question on that law while it is still fresh',
    prose: (method: string) => [
      'Most practice tests hand you a bank of questions and leave the manual somewhere else. This one puts them together.',
      `You ${method}. Get it right and you move on; get it wrong and you have found the gap while it is cheap to fix, not on the morning of the exam.`,
      'Learning one rule at a time, and proving it immediately, is what turns a manual you skimmed into something you actually know — and it makes studying feel like getting somewhere rather than like waiting to find out.',
    ],
    headline: (stateName: string) => `Pass your ${stateName} written test`,
    benefit: 'Know every rule on the test before you walk in.',
  },
  picker: {
    title: 'Pass the Test',
    tagline: (manifest: string) => manifest,
    choose: 'Choose your state',
    search: 'Search for your state',
    states: 'States',
    noMatch: (query: string) => `No state matches “${query}”`,
    diagnostic: 'Take a 10-question test',
    study: 'or start studying',
    licenseAlt: (name: string) =>
      `An illustration of a specimen ${name} driver’s license with Howard’s photograph on it.`,
    howItWorks: 'How it works',
    stepLearn: 'Learn the key concepts, one card at a time',
    stepTest: 'Take practice tests shaped to match your state’s real exam',
    stepLevels: (levels: readonly { name: string; requires: number }[]) =>
      `Pass 1 test for ${levels[0].name}, ${levels[1].requires} in a row for ${levels[1].name}, ${levels[2].requires} in a row for ${levels[2].name}`,
    whyThisOne: 'Why this one',
    whatThisIs: 'What this is',
    whatItCovers: 'What it covers',
    youtube: 'Watch us on YouTube',
  },
  landing: {
    sentBy: (partner: string): Rich => ['Sent by ', { b: partner }, '. Their discount is applied when you buy.'],
    diagnostic: 'Take a 10-question test',
    study: 'or start studying',
    licenseAlt: (name: string) =>
      `An illustration of ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} driver's license with Howard's photograph on it.`,
    intro: (laws: number, stateName: string, exactly: boolean) =>
      `${laws} ${stateName} permit rules, one at a time: read the rule and why it exists, then ` +
      `answer a question on it straight away. Then practice tests shaped ${
        exactly ? 'exactly like the real exam' : 'like the real exam'
      }.`,
    theExam: 'The exam',
    questions: 'questions',
    toPassParts: 'to pass, part by part',
    toPass: 'to pass',
    passMark: 'pass mark',
    timeLimit: (minutes: number) => ` You get ${minutes} minutes for it.`,
    comesOutOf: (manual: string, agency: string | null) =>
      ` Everything on it comes out of the ${manual}` +
      (agency !== null ? `, published by the ${agency}.` : '.'),
    howThisWorks: 'How this works',
    fromTheManual: 'Straight from the manual',
    whatTests: (stateName: string) => `What ${stateName} tests`,
    conceptsCount: (concepts: number, laws: number) => `${concepts} concepts, ${laws} separate rules.`,
    courses: (short: number, full: number) =>
      `Every topic in ${short} cards, or every law in ${full} — you choose on the first card, and change your mind any time.`,
    gettingPermit: (stateName: string) => `Getting your ${stateName} permit`,
    whyThisOne: 'Why this one',
    whereFrom: 'Where this comes from',
    sources: (manual: string, agency: string | null, updated: string | null) =>
      `Every rule here is written from the ${manual}` +
      (agency !== null ? `, published by the ${agency}` : '') +
      (updated !== null ? `, last checked ${updated}` : '') +
      '. Where they disagree, the handbook is right.',
  },
  study: {
    quizMe: 'Quiz me',
    takeTest: 'Take the test',
    tryTen: 'Try 10 sample questions',
    fromWhole: (stateName: string) => `from the whole ${stateName} test`,
  },
  question: {
    signLabels: ['Sign 1', 'Sign 2', 'Sign 3', 'Sign 4'],
    correct: 'Correct',
    wrong: 'Wrong',
    backToCard: 'Back to the card',
    right: 'Nice! That’s right.',
    notQuite: 'Not quite.',
    inTheManual: (page: string) => `In the manual, ${page}`,
    inTheEnglishManual: (page: string) => `In the manual, ${page}`,
    nextLaw: 'Next law',
    reviewLaw: 'Review the law',
    nextQuestion: 'Next question',
    /** The line under every Spanish card; empty in English (§3). */
    translation: '',
    translationLink: '',
  },
  prescreen: {
    position: (position: number, length: number) => `Question ${position} of ${length}`,
    explainer:
      'You’ll get most of these wrong. That’s fine — a wrong guess with the answer right behind it sticks better than reading. Anything you miss, we teach next.',
    skip: 'Skip to the cards',
  },
  checkpoint: {
    done: (concept: string) => `${concept} — done`,
    topics: (topics: number) =>
      topics === 1
        ? 'One more topic'
        : `${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][topics] ?? topics} more topics`,
    testedOut: (count: number) => `${count} you already knew`,
    freePart: 'That was the free part.',
    wall: (sections: number) =>
      `One payment opens everything from here to the exam: all ${sections} sections, every law it can ask, and unlimited full tests. The price is next.`,
  },
  test: {
    timeRemaining: (left: string) => `Time remaining: ${left}`,
    left: (left: string) => `${left} left`,
    stopClock: 'Stop the clock',
  },
  setup: {
    heading: 'Ready to test?',
    missed: (count: number) =>
      `You missed ${count} question${count === 1 ? '' : 's'} last time. Want to take another run at just those?`,
    everyLevel: 'You’ve earned every level.',
    retest: 'Retest the ones you missed',
    fresh: 'Fresh full test',
  },
  passComplete: {
    headingShort: 'Every topic covered',
    headingFull: 'Every law covered',
    taughtShort: (stateName: string | null) =>
      stateName === null
        ? 'You have been taught one or two laws on every topic the test can ask about.'
        : `You have been taught one or two laws on every topic ${stateName} can ask you about.`,
    taughtFull: (stateName: string | null) =>
      stateName === null
        ? 'You have been taught every law the test can ask.'
        : `You have been taught every law ${stateName} can ask you about.`,
    lawsTaught: 'laws taught',
    topics: 'topics',
    testsShort:
      'Now the tests. They draw from every law in the state, not just the ones you were shown, so some of them will be new.',
    testsFull:
      'Now the tests. They draw from the same laws you have just been through, so nothing on them is new.',
    start: 'Start testing',
  },
  walkDone: {
    heading: (cards: number) =>
      cards === 1 ? 'The card you missed — done' : `All ${cards} cards you missed — done`,
    nextHub: 'Next up: back to the hub.',
    nextStart: 'Next up: start studying, from card 1.',
    nextResume: (card: number) => `Next up: back to studying, picking up at card ${card}.`,
  },
  hub: {
    covered: (concepts: number) => `All ${concepts} concepts covered`,
    level: (level: number, earnedBy: string) => `Level ${level} · ${earnedBy}`,
    everyLevel: 'Every level earned.',
    earned: (date: string) => `Earned ${date}.`,
    timedOn: (minutes: number) => `Timed: ${minutes} min`,
    timedOff: 'Timed: off',
    worthAnother: 'Worth another look',
    restudy: (count: number) =>
      count === 1 ? 'Restudy this concept' : `Restudy these ${count} concepts`,
    lastTest: (score: number, total: number, passed: boolean) =>
      `Last test: ${score} / ${total}${passed ? ' — passed' : ''}`,
    mastered: (count: number) => `${count} question${count === 1 ? '' : 's'} mastered`,
    takeTest: 'Take the test',
    studyAgain: 'Study the laws again',
    dateLocale: undefined as string | undefined,
  },
  results: {
    tellSomeone: 'Tell someone',
    copied: 'Copied',
    share: 'Share this',
    copiedNote: 'Copied. Paste it wherever you like.',
    unlocked: (name: string) => `${name} unlocked`,
    expired:
      'Time ran out. Anything you did not reach counts as missed, which is what the real paper does too.',
    whereYouStand: 'Where you stand',
    retestComplete: 'Retest complete',
    passed: 'Passed',
    fellShort: (names: readonly string[]) => `${names.join(' and ')} fell short`,
    oneShort: 'One question short',
    short: (short: number) => `${short} short of a pass`,
    covered: (covered: number, total: number) => `You have covered ${covered} of ${total} laws`,
    gainedNone: ' — no new ones since you last checked.',
    gained: (gained: number) => ` — ${gained} more than when you last checked.`,
    yourRuns: 'Your runs: ',
    outOf: (total: number) => ` out of ${total}`,
    drawFresh: (total: number) =>
      `These ten questions were drawn from all ${total} laws — a starting point, not a grade.`,
    drawRetake: (total: number) =>
      'These ten started with the laws you missed and the cards you have studied since — a check on what you just fixed, not a fresh sample of all ' +
      `${total}.`,
    partScore: (name: string, score: number, total: number, passMark: number, cleared: boolean) =>
      `${name}: ${score} of ${total}` +
      (passMark === 0 ? '' : cleared ? `, ${passMark} needed — passed` : `, ${passMark} needed`),
    certified: 'Prepared.',
    streakReset: 'Tests must be passed back to back, so this one restarts the count.',
    newlyMastered: (count: number) => `+${count} mastered`,
    improvedCards: (gained: number) =>
      `That is ${gained} card${gained === 1 ? '' : 's'} of studying, showing up in the score.`,
    improvedPlain: 'The studying is showing up in the score.',
    fullNext: (questions: number) =>
      `The full ${questions}-question paper is next — the real shape, scored the way the real one is.`,
    takeFull: (questions: number) => `Take the full ${questions}-question test`,
    worthAnother: 'Worth another look',
    restudyBefore: 'Restudy before your next try',
    oneConcept: 'Every miss was on this one concept.',
    concepts: 'The concepts your misses point at, most-missed first.',
    restudyStart: 'Restudy what you missed',
    missed: 'Questions you missed',
    feedback: 'Tell us how it is going',
  },
  paywall: {
    heading: (price: string) => `Keep going for ${price}`,
    offWith: (percent: number) => `${percent}% off with`,
    from: 'from',
    scoredShort: (score: number, total: number) => `You scored ${score} of ${total} on the short test.`,
    realExam: (questions: number, passMark: number) =>
      `The real exam is ${questions} questions and needs ${passMark}.`,
    passHere: (passMark: number, questions: number) => `A pass here is ${passMark} of ${questions}.`,
    scored: (score: number, total: number) => `You scored ${score} of ${total}.`,
    realNeeds: (passMark: number) => `The real exam needs ${passMark}.`,
    passHereMark: (passMark: number) => `A pass here is ${passMark}.`,
    threeTimes: 'Do that three times in a row and you are ready.',
    whatYouGet: 'What you get',
    sections: (sections: number) =>
      `All ${sections} sections of study cards — every law the exam can ask, and why`,
    shortCourse: 'Or the short course — every topic, one or two laws each',
    onCourse: (course: 'full' | 'short') => `You’re on the ${course} course`,
    unlimited: (questions: number, chosen: boolean) =>
      `Unlimited ${questions}-question tests, ${
        chosen ? 'drawn from your state’s own manual' : 'drawn like the real paper'
      }`,
    retests: 'Retests built from exactly what you missed',
    levels: 'Every level up to Prepared — three passes in a row',
    oneTime: 'One payment. Not a subscription. Nothing to cancel.',
    discountCode: 'Discount code',
    enterCode: 'Enter your code',
    apply: 'Apply',
    deadNone: 'That code is not working. You can still buy at the usual price.',
    dead: (code: string) => `We do not recognize ${code}. You can still buy at the usual price.`,
    recoveryCode: 'Recovery code',
    checking: 'Checking…',
    restore: 'Restore my purchase',
    opening: 'Opening checkout…',
    unlock: (price: string) => `Unlock for ${price}`,
    backToPayment: 'Back to payment',
    alreadyPaid: 'I already paid',
    contact: (email: string) => `Questions or refunds: ${email}`,
  },
  purchased: {
    heading: 'You’re in',
    unlocked: 'Every test up to Prepared is now unlocked.',
    writeDown: 'Write this down',
    onlyWay:
      'It is the only way back in on another phone or browser, or if you clear this one. We did not email it to you.',
    start: 'Start a test',
    lost: (email: string) => `Lost it? ${email}`,
  },
  menu: {
    title: 'Pass the Test',
    thisTest: 'This test',
    settings: 'Settings',
    contact: 'Get in touch',
    about: 'About this app',
    home: 'Home',
    stateTest: (name: string) => `The ${name} test`,
    sendFeedback: 'Send feedback',
    restartTest: 'Start this test over',
    startOver: 'Start over',
    close: 'Close',
    aboutState: (name: string) => `About the ${name} test`,
    keyNumbers: 'Key numbers',
    timed: (on: boolean, minutes: number) => `Timed tests: ${on ? `on · ${minutes} min` : 'off'}`,
    course: (name: 'full' | 'short', cards: number) => `Course: ${name} · ${cards} cards`,
    motion: (off: boolean) => `Motion: ${off ? 'off' : 'on'}`,
    refund: 'Request a refund',
    contactUs: 'Contact us',
    faq: 'Questions people ask',
    aboutUs: 'About us',
    partner: 'Become a partner',
    privacy: 'Privacy',
    terms: 'Terms of use',
  },
  restart: {
    heading: 'Start over?',
    forgets:
      'This forgets everything this device has learned: how far through the cards you are, which laws you have mastered, every practice test you have taken and the streak they built. You will begin at the first card again.',
    cannotUndo:
      'It cannot be undone. Your progress is kept on this device and nowhere else, so there is no copy of it for us to put back.',
    keepsPurchase: 'If you have paid, your purchase is not affected. You keep the tests you bought.',
    confirm: 'Yes, start over',
    cancel: 'Keep my progress',
  },
  course: {
    toShort: 'Switch to the short course?',
    toFull: 'Switch to the full course?',
    sizesShort: (short: number, full: number): Rich => [
      'Every topic, one or two laws each — ',
      { b: `${short} cards instead of ${full}` },
      '.',
    ],
    testsUnchanged: (full: number) =>
      `The tests still cover all ${full}, so your score will show what you skipped.`,
    backShort:
      'You can switch back any time; nothing you’ve done is lost. Any topic you want more of is a tap on the section map — a green pill walks every card of it.',
    sizesFull: (full: number, short: number): Rich => [
      'Every law, card by card — ',
      { b: `${full} cards instead of ${short}` },
      '.',
    ],
    backFull:
      'You can switch back any time; nothing you’ve done is lost. Cards you’ve already studied stay studied.',
    confirmShort: 'Switch to the short course',
    confirmFull: 'Switch to the full course',
    keepFull: 'Keep the full course',
    keepShort: 'Keep the short course',
  },
  map: {
    heading: (stateName: string | null) => (stateName === null ? 'Every law' : `Every ${stateName} law`),
    summary: (done: number, total: number) =>
      `${done} of ${total} topics behind you. Tap a green one to go over it again, or a grey one to be tested out of it.`,
  },
  feedback: {
    thanks: 'Thank you',
    duplicate: 'You have already sent feedback recently, so the first one was kept. It is read.',
    read: 'It is read by the person who makes this, and it is the only way to know whether any of this worked.',
    heading: 'How is this going?',
    rate: 'How would you rate the app?',
    ratingOf: (value: number) => `${value} of 5`,
    taken: 'Have you taken the state exam?',
    outcomes: { passed: 'I passed it', failed: 'I did not pass', not_yet: 'I have not taken it yet' },
    anything: 'Anything else? (optional)',
    placeholder: 'What worked, what did not, what was wrong.',
    email: 'Leave your email for a reply — it is kept. Your recovery code is removed before sending.',
    failed: (email: string) =>
      `That did not send. Try again, or email it to ${email} — what you wrote is still here.`,
    sending: 'Sending…',
    tryAgain: 'Try again',
    send: 'Send',
  },
  refund: {
    heading: 'Request a refund',
    intro: 'If you reached Prepared here and still did not pass the real exam, we give you your money back.',
    email: (address: string) => `Email ${address}`,
    photo: [
      'Attach a photo of your official result from the licensing office — the printout or the screen — showing ',
      { b: 'your name' },
      ' and ',
      { b: 'the date' },
      '. A phone photo is fine. It does not need to be a scan.',
    ] as Rich,
    code: [
      'Include the ',
      { b: 'recovery code' },
      ' from your receipt. It is the only thing that identifies your purchase — there are no accounts here — so we cannot find you without it.',
    ] as Rich,
    conditions: 'Three conditions',
    certified: ['You reached ', { b: 'Prepared' }, ' — three full tests passed in a row.'] as Rich,
    within: ['You are within ', { b: '21 days' }, ' of paying.'] as Rich,
    photoSent: 'You send the photo described above.',
    back: 'What comes back',
    paid: [
      'What you paid, ',
      { b: 'less the card processing fee' },
      ' — the card company keeps that even when a payment is given back, so it is not ours to return. Your access here ends when the refund is made.',
    ] as Rich,
    /** Question tokens (docs/plans/trusted-by-date.md, decision 21): no exam, no photo, only an unspent pack. */
    tokensHeading: 'Question tokens',
    tokens: [
      'A pack of question tokens none of which has been spent is refundable, ',
      { b: 'less the card processing fee' },
      ': write with its ',
      { b: 'question code' },
      '. Tokens do not expire, so there is no window. A token is a question about one state; a nationwide question is five.',
    ] as Rich,
  },
  /** The site footer on the resting screens (src/components/SiteFooter.tsx). */
  footer: {
    nav: 'About this site',
    terms: 'Terms',
    privacy: 'Privacy',
    faq: 'FAQ',
    ask: 'Ask a question',
    about: 'About',
    contact: 'Contact',
    /** The page saying how an answer is made and checked (docs/plans/trusted-by-date.md, decision 8). */
    method: 'How it works',
    line: (year: number) => `© ${year} Howard’s Lantern · Not an official state site`,
  },
  /** The contact page (src/screens/Contact.tsx). */
  contact: {
    title: 'Contact us',
    intro:
      'A person reads this and replies by email. For a refund, use the Request a refund page instead — it needs a photo this form does not take.',
    email: 'Your email, so we can reply',
    message: 'Your message',
    placeholder: 'What you want to tell us or ask.',
    send: 'Send',
    sending: 'Sending…',
    waiting: 'One moment — checking this is a person.',
    sentHeading: 'Sent',
    sent: (address: string) =>
      `A person reads it and replies to the address you gave. If you hear nothing in a few days, write to ${address}.`,
    notAPerson: (address: string) =>
      `That did not look like a person to the checker. Try again, or write to ${address}.`,
    failed: (address: string) => `That did not send. Try again, or write to ${address}.`,
    page: 'Contact page',
  },
  /** The ask page (src/screens/Ask.tsx) and the box's own words on it. */
  ask: {
    title: 'Ask a question',
    /** The button's words: the short form alone on the narrowest phones, the rest from 360px. */
    short: 'Ask',
    rest: ' a question',
    cantFind: 'Can’t find it? Ask.',
    /** The way to the feedback form, which this button replaced in the chrome. */
    feedback: 'Something wrong with a card, or a thought for us? Send feedback.',
    /** The field on the front pages that opens this page (src/components/AskEntry.tsx). */
    entry: (stateName: string | null) => `Ask any question about ${stateName === null ? 'your state’s' : stateName} driving law`,
    /** The line under the title naming the state road law is answered for. */
    answeringFor: (stateName: string) => `Answering for ${stateName}.`,
    noState: 'No state chosen yet.',
    change: 'Change',
    cancel: 'Cancel',
    /** The checkbox that asks across every state (docs/plans/nationwide.md, decision 11). */
    nationwide: 'Nationwide — compare all states',
    answeringNationwide: 'Answering across all 50 states and DC.',
    /** The week's questions are counted in the browser (src/ask-quota.ts); the modal when they run out. */
    limitTitle: 'That’s the limit for this week',
    limitNationwide: (count: number) =>
      `You’ve asked ${count} nationwide questions this week, which is the weekly limit. A nationwide answer reads every state’s law, so they are rationed; the count starts again on Monday.`,
    limitState: (count: number) => `You’ve asked ${count} questions this week, which is the weekly limit. The count starts again on Monday.`,
    /**
     * The line above the input: what is left to ask with, for the kind of
     * question the box is set to. "8/10 ... n more free in m days, or
     * purchase" (Joel, 2026-10-13) in place of two counts and a label that
     * said in words what a question spends. "Free questions", not "tokens":
     * the pop-up says a nationwide question is five tokens, so "3/3 tokens"
     * under the Nationwide tick would contradict it.
     */
    questionsLeft: (left: number, limit: number, days: number, tokens: number | null) =>
      tokens === null
        ? `${left}/${limit} free questions left · ${limit} more in ${days} ${days === 1 ? 'day' : 'days'}, or buy tokens`
        : `${left}/${limit} free questions left · ${tokens} ${tokens === 1 ? 'token' : 'tokens'} · ${limit} more free in ${days} ${days === 1 ? 'day' : 'days'}`,
    /**
     * The purchase pop-up and the paid path (docs/plans/trusted-by-date.md,
     * decision 25). Addressed to whoever is at the keyboard -- a learner, a
     * teacher, a school office -- so no line says "your state" or "your test".
     */
    buyTitle: 'More questions',
    tokenIs: 'A token is a question about one state; a nationwide question is five.',
    pack: (tokens: number, price: string) => `${tokens} tokens — ${price}`,
    buyPack: (tokens: number, price: string) => `Buy ${tokens} tokens for ${price}`,
    dollarPack: 'The one-dollar pack buys fewer tokens per dollar, because the card fee is a third of it.',
    classroom: 'A teacher or a school can share one code across a classroom’s devices.',
    notNow: 'Not now',
    haveCode: 'I have a code',
    codeLabel: 'Question code',
    codeSubmit: 'Use this code',
    codeUnknown: 'That code was not recognized.',
    codeTrouble: 'That could not be checked just now. Try again in a moment.',
    codeRestored: (code: string, count: number) => `Code ${code} is on this device now, with ${count} ${count === 1 ? 'token' : 'tokens'}.`,
    notForSale: 'Tokens are not on sale yet. Try again soon.',
    checkoutTrouble: 'The payment page could not be reached. Try again in a moment.',
    tokensReady: 'The tokens are ready — tap Ask to send that question.',
    tokensReadyNoQuestion: 'The tokens are ready.',
    questionCode: (code: string) => `The question code is ${code}. Keep it: it moves these tokens to another device. A copy is sent to the email given at checkout.`,
    tokensPending: 'The payment is still being confirmed. Reload this page in a minute; if the tokens have not arrived, write to us.',
    spendTitle: 'Spend a token?',
    spendBody: (cost: number, left: number) =>
      `This week’s free questions are used up. This question costs ${cost} ${cost === 1 ? 'token' : 'tokens'}, and the code holds ${left}. This is asked once a visit.`,
    spendYes: 'Spend',
    labels: {
      label: 'Ask a question',
      placeholder: 'Type your question here',
      button: 'Ask',
      asking: 'Asking…',
      waiting: 'One moment — checking this is a person.',
      trouble: 'That did not go through. Try again in a moment.',
      noMatch: 'I do not have an answer to that one.',
      handOff: 'That is two I could not answer, so this one is better asked of a person.',
      writeTo: 'Write to',
      reads: 'and a person reads it.',
      readMore: 'Read more',
      statePage: 'Your state’s page',
      chooseState: 'Choose your state',
      inTheLaw: (reference: string) => `Not in your manual — ${reference}`,
      card: 'See the card',
      comparePage: 'What the states can be compared on',
      absent: (names: string) => `No rule found in the manual or code of: ${names}`,
      moreStates: (count: number) => `Show ${count} more ${count === 1 ? 'state' : 'states'}`,
      asOf: (date: string) => `as of ${shortDate(date, 'en')}`,
      sourcesLine: (documents: string) => `Sources: ${documents}`,
      manualSource: (state: string | null, pages: string) =>
        `${state === null ? 'The driver’s manual' : `${state} driver’s manual`}${pages === '' ? '' : ` ${pages}`}`,
      statesSources: (states: readonly string[]) =>
        states.length === 1
          ? `${states[0]} law`
          : states.length <= 3
            ? `${states.slice(0, -1).join(', ')} and ${states[states.length - 1]} laws`
            : `${states[0]}, ${states[1]} and ${states.length - 2} more states’ laws`,
      showLaw: 'Show the law',
      hideLaw: 'Hide the law',
      showAnswer: 'Show the answer',
      hideAnswer: 'Hide the answer',
      deleteQuestion: 'Delete this question',
      showEarlier: (count: number) => `Show ${count} more`,
      showLess: 'Show less',
    },
    /**
     * Under the box on a comparison page's arrival, the list's offer
     * (trusted-by-date.md, decision 13): the form is on the changes page,
     * which the app does not mount over, so its challenge is the only one there.
     */
    subscribeOffer: 'Monthly: what changed in state driving law.',
    subscribeLink: 'Get it by email',
    /**
     * Above the chips in nationwide mode (trusted-by-date.md, decision 17):
     * questions answered in advance, so a tap shows a checked answer at once
     * and costs none of the week's nationwide questions.
     *
     * "Free" first, and "as many as you like" (Joel, 2026-10-11): the line it
     * replaced, "tap one, it doesn’t count toward this week’s questions", was
     * read as one free tap, and a learner who believes a chip spends a
     * question taps none of them.
     */
    chipsLabel: 'Free facts across the states — tap as many as you like',
    /** Above a state's chips (what-happens-if.md, decision 24), in the same words as the nationwide row's. */
    stateChipsLabel: (state: string) => `Free answers for ${state} — tap as many as you like`,
    /** On every chip, so the difference survives the heading scrolling off a phone. */
    chipFree: 'free',
    /**
     * The box's own label. It once also said what a typed question spends --
     * "counts toward this week’s 10, or spends a token" -- which Joel found
     * confusing (2026-10-13); the remaining-count line beside it says that
     * with numbers instead.
     */
    ownQuestion: 'Ask your own question',
  },
  /** The FAQ page's own words; the questions are in src/faq.ts. */
  faq: {
    heading: 'Questions people ask',
    groups: {
      test: 'The test here',
      paying: 'Paying',
      data: 'Your data',
      us: 'Who we are',
    },
  },
  about: {
    heading: 'About us',
    people: 'The people who make this.',
    roles: {
      'President/CEO': 'President/CEO',
      'Project Manager': 'Project Manager',
      Host: 'Host',
    } as Record<string, string>,
  },
  aboutState: {
    heading: (stateName: string) => `About the ${stateName} test`,
    theTest: 'The test',
    passMark: 'Pass mark',
    timeLimit: 'Time limit',
    howGiven: 'How it is given',
    languages: 'Languages',
    gettingPermit: 'Getting your permit',
    whereFrom: 'Where this comes from',
    source: (manual: string | null, agency: string | null, updated: string | null) =>
      (manual !== null ? `Written from the ${manual}` : '') +
      (manual !== null && agency !== null ? ', published by the ' : '') +
      (agency !== null ? (manual === null ? 'Published by the ' : '') + agency : '') +
      (updated !== null ? `, and last checked against it on ${updated}` : '') +
      '. Where this app and the handbook disagree, the handbook is right.',
  },
  numbers: {
    heading: (stateName: string | null) => `Key numbers${stateName !== null ? ` — ${stateName}` : ''}`,
    choose: 'Choose a state to see its key numbers.',
    intro: (stateName: string) =>
      `Every rule in ${stateName}’s handbook that comes down to a number — speed limits, blood alcohol, distances, fines, points, ages and hours — as it is taught here. Print this page, or save it as a PDF.`,
    print: 'Print or save as PDF',
  },
  /** What the voice says between the answers it reads out. */
  speech: {
    numbers: ['One.', 'Two.', 'Three.', 'Four.'],
  },
  /** The Spanish summaries above Terms and Privacy (§4); empty in English. */
  legal: {
    termsSummary: [] as readonly string[],
    privacySummary: [] as readonly string[],
  },
  /**
   * The partner page (src/screens/Partner.tsx) and its flow
   * (src/components/PartnerFlow.tsx). What stays English in Spanish -- the
   * agreement, the portal, the answers from the ask box -- says so on the page.
   */
  partnerPage: {
    back: '← Back',
    backButton: 'Back',
    title: 'Become a partner',
    lead:
      'A student calls about lessons and has no permit yet. The usual answer is “come back when you have it” — and by the time the permit arrives, they may call somebody else. Send them your own link instead: they study for the permit test under your name from that first call, you see how they are getting on, and you know the day they are ready to book. You keep the student. The code and the commission come second.',
    without: 'Without it',
    withoutSays: '“Come back when you have your permit.”',
    withoutThen:
      'They hang up and study on their own. Weeks later, permit in hand, they book with whoever they find then — and you never hear from them.',
    with: 'With it',
    withSays: '“Here’s our link — start studying today.”',
    withThen:
      'They study under your name from the first call, you watch them get there, and we email you when they are ready. The first lesson is booked with you.',
    atAGlance: 'At a glance',
    howItWorks: 'How it works',
    how: [
      {
        title: 'You invite a student',
        body: 'From your portal, with a first name or initials so you know who is who. You get a link to text the student. There is a general code and link too, for everybody else.',
      },
      {
        title: 'They study under your name',
        body: 'Your business name is at the top of every screen they see, and they pay less than they otherwise would.',
      },
      {
        title: 'You see how each one is getting on',
        body: 'Whether they have started, which cards they get wrong, and whether they have passed a practice test.',
      },
      {
        title: 'We tell you when they are ready',
        body: 'When a student you invited passes their first full practice test, we email you: that is the time to book their knowledge test appointment. When they pass three in a row, we email you again — they are ready, and it is the day to book their first lesson.',
      },
      {
        title: 'A sale also earns you a commission',
        body: 'It is pending for 30 days after the sale — longer than any refund we have seen — and payable after that. Your own terms are fixed when your application is approved and are written on your portal page in words, not in a schedule you have to ask us for.',
      },
      {
        title: 'Your code renews itself',
        body: 'Every twelve months, for as long as you are using it. You do not have to ask, and the portal shows you the next renewal date.',
      },
      {
        title: 'Either of us can stop',
        body: 'The agreement ends at any time, for any reason, on either side. What you have already earned still clears and is still paid.',
      },
    ] as readonly { title: string; body: string }[],
    askHeading: 'Ask us anything',
    /** Empty in English: the answers are already in the reader's language. */
    askLanguage: '',
    // Three questions somebody actually weighs before applying, in the order
    // they weigh them: what it costs, whether they are the sort of person this
    // is for, and how the money reaches them. Questions rather than topics,
    // because the box takes a question and the first tap should show what it is.
    examples: ['What does it cost to join?', 'Who can be a partner?', 'How do you pay?'] as readonly string[],
    beforeHeading: 'Before you apply',
    before: 'The whole agreement is published — you can read every word of it before you give us an email address.',
    agreementLink: 'Read the partner agreement',
    apply: 'Apply to be a partner',
    flow: {
      label: 'How a student you invite reaches your lessons',
      to: 'to',
      you: 'You',
      student: 'Your student',
      us: 'Howard’s Lantern',
      emailTo: 'Email to you',
      youEarn: 'You earn',
      link: 'You send your link',
      linkDetail: 'You invite them from your portal, by first name or initials.',
      study: 'They study under your name',
      studyDetail: 'Your name is on every screen. You watch their progress in your portal.',
      buy: 'They buy the course',
      buyDetail: 'The first section is free; they buy at your discount to keep going.',
      buyReward: 'A commission on every sale. Pending for 30 days, then it’s yours.',
      first: 'They pass a first full practice test',
      firstDetail: 'We email you.',
      firstEmail: 'Time to book their knowledge test appointment.',
      three: 'They pass three in a row',
      threeDetail: 'We email you again.',
      threeEmail: 'They are ready. Book their first lesson.',
    },
  },
}

export type Strings = typeof en

const es: Strings = {
  lang: {
    label: 'Idioma',
    english: 'English',
    spanish: 'Español',
    unavailable: 'Español todavía no está disponible para este estado.',
  },
  common: {
    back: 'Volver',
    backTop: '← Volver',
    continue: 'Continuar',
    notNow: 'Ahora no',
    keepGoing: 'Seguir',
    backToHub: 'Volver al inicio',
    backToCard: 'Volver a la tarjeta',
    startStudying: 'Empezar a estudiar',
    backToStudying: 'Volver a estudiar',
    readable: (concept: string) => concept.replaceAll('-', ' '),
  },
  chrome: {
    menu: 'Menú',
    readAloud: 'Leer en voz alta',
    readAgainLabel: 'Leer esto otra vez',
    readAgain: 'Leer otra vez',
    previousConcept: 'Concepto anterior',
    nextConcept: 'Concepto siguiente',
    of: (count: number | undefined, max: number) => `${count} de ${max}`,
    openMap: (label: string, count: number, max: number) =>
      `${label}: ${count} de ${max}. Abrir el mapa de secciones.`,
    course: 'Curso',
    courseNames: { full: 'Curso completo', short: 'Curso corto' },
    cards: (count: number) => `${count} tarjetas`,
    levelOf: (earned: number, total: number, name: string | null) =>
      `Nivel ${earned} de ${total}${name === null ? '' : `: ${name}`}`,
    partnerAsk: '¿Enseña a manejar o tiene una escuela?',
    partnerInvite: 'Asóciese con nosotros',
    speechUnavailable: 'La lectura en voz alta no está disponible en este dispositivo.',
  },
  status: {
    section: (index: number, total: number) => `Sección ${index} de ${total}`,
    everyLaw: (stateName: string | null) => `Todas las leyes de ${stateName}`,
    retest: 'repaso',
    shortTest: 'prueba corta',
    practiceTest: 'examen de práctica',
    restudy: 'repaso',
    certified: 'preparado',
    passOne: 'apruebe 1 examen',
    inARow: (streak: number, requires: number) => `${streak} de ${requires} aprobados seguidos`,
  },
  milestones: {
    threeQuarters: 'Tres cuartas partes del camino',
    half: 'La mitad del camino',
    quarter: 'Una cuarta parte del camino',
  },
  errors: {
    notConfirmed: (email: string) =>
      'No pudimos confirmar ese pago. Si se le hizo un cargo, escriba a ' + email + '.',
    checkoutUnavailable: 'El pago no está disponible en este momento. Inténtelo de nuevo en un momento.',
    deviceLimit:
      'Ese código ya se usa en el número máximo de dispositivos. Abra la aplicación en uno de ellos, o comuníquese con nosotros.',
    unrecognised: 'No reconocimos ese código. Revíselo e inténtelo de nuevo.',
    crashHeading: 'Algo salió mal',
    crashBody: 'Su progreso está guardado. Al volver a cargar la página, debería regresar a donde estaba.',
    crashRetry: 'Intentar de nuevo',
  },
  levels: [
    {
      name: 'Luz verde',
      earnedBy: '1 examen aprobado',
      share: 'Aprobé un examen de práctica del permiso de {state}.',
    },
    {
      name: 'Control de crucero',
      earnedBy: '2 exámenes aprobados seguidos',
      share: 'Ya van 2 exámenes de práctica del permiso aprobados seguidos en {state}.',
    },
    {
      name: 'Preparado',
      earnedBy: '3 exámenes aprobados seguidos',
      share: 'Estoy listo para mi examen del permiso de {state}.',
    },
  ],
  exam: {
    subject: 'Un examen tiene',
    subjectChosen: 'Este examen de práctica tiene',
    flat: (subject: string, questions: number, passMark: number) =>
      `${subject} ${questions} preguntas y se aprueba con ${passMark} correctas.`,
    total: (subject: string, questions: number, passMark: number, floors: readonly Floor[]) =>
      `${subject} ${questions} preguntas y se aprueba con ${passMark} correctas, ` +
      `y por lo menos ${floors
        .map((floor) => `${floor.passMark} de las ${floor.questions} preguntas de ${floor.name.toLowerCase()}`)
        .join(' y ')} tienen que estar correctas.`,
    parts: (subject: string, questions: number, parts: readonly Floor[]) =>
      `${subject} ${questions} preguntas en ${parts.length} partes — ` +
      `${parts
        .map((part) =>
          part.passMark === part.questions
            ? `${part.questions} de ${part.name.toLowerCase()}, las ${part.questions} correctas`
            : `${part.questions} de ${part.name.toLowerCase()}, ${part.passMark} correctas`,
        )
        .join('; ')} — y hay que aprobar cada parte.`,
    noteBothChosen: (stateName: string, questions: number, passMark: number) =>
      `${stateName} no publica cuántas preguntas tiene su examen de conocimientos, ` +
      `ni la calificación para aprobarlo. Este examen de práctica tiene ${questions} ` +
      `y se aprueba con ${passMark}.`,
    noteQuestionsChosen: (
      stateName: string,
      questions: number,
      percent: number,
      derived: boolean,
      cite: string,
    ) =>
      `${stateName} no publica cuántas preguntas tiene su examen de conocimientos. ` +
      `Este examen de práctica tiene ${questions}, y se aprueba con el ${percent}% ` +
      `${derived ? 'que se desprende de' : 'que fijan'} las reglas de ${stateName}${cite}.`,
    notePassMarkChosen: (stateName: string, questions: number, passMark: number, cite: string) =>
      `${stateName} dice que su examen de conocimientos tiene ${questions} ` +
      `preguntas${cite}, pero no publica la calificación para aprobarlo. ` +
      `Este examen de práctica se aprueba con ${passMark}.`,
    noteDerived: (stateName: string, questions: number, passMark: number, cite: string) =>
      `${stateName} no dice directamente la calificación para aprobar su examen ` +
      `de conocimientos: ${passMark} de ${questions} se desprende de lo que sí ` +
      `dice${cite}.`,
    notePartQuestionsChosen: (
      stateName: string,
      part: Floor,
      percent: number,
      derived: boolean,
      cite: string,
    ) =>
      `${stateName} no publica cuántas preguntas tiene la parte de ${part.name.toLowerCase()} ` +
      `de su examen de conocimientos. Este examen de práctica tiene ${part.questions} ahí, ` +
      `y la aprueba con el ${percent}% ${derived ? 'que se desprende de' : 'que fijan'} ` +
      `las reglas de ${stateName}${cite}.`,
    notePartBothChosen: (stateName: string, part: Floor) =>
      `${stateName} no publica cuántas preguntas tiene la parte de ${part.name.toLowerCase()} ` +
      `de su examen de conocimientos, ni la calificación para aprobarla. Este examen de ` +
      `práctica tiene ${part.questions} ahí y la aprueba con ${part.passMark}.`,
    notePartPassMarkChosen: (stateName: string, part: Floor, cite: string) =>
      `${stateName} dice que la parte de ${part.name.toLowerCase()} de su examen de ` +
      `conocimientos tiene ${part.questions} preguntas${cite}, pero no publica la ` +
      `calificación para aprobarla. Este examen de práctica la aprueba con ${part.passMark}.`,
    notePartDerived: (stateName: string, part: Floor, cite: string) =>
      `${stateName} no dice directamente la calificación para aprobar la parte de ` +
      `${part.name.toLowerCase()} de su examen de conocimientos: ${part.passMark} de ` +
      `${part.questions} se desprende de lo que sí dice${cite}.`,
    notePartsOwn: (stateName: string, parts: readonly Floor[]) =>
      `La parte de ${parts
        .map((part) => `${part.name.toLowerCase()}, ${part.passMark} de ${part.questions},`)
        .join(' y la parte de ')} ${parts.length === 1 ? 'es la que fija' : 'son las que fija'} ${stateName}.`,
    hintFirst: (requires: number, timed: boolean, name: string) =>
      requires === 1
        ? `Apruebe 1 examen${timed ? ' con tiempo' : ''} para ganar ${name}.`
        : `Apruebe ${requires} exámenes${timed ? ' con tiempo' : ''} seguidos para ganar ${name}.`,
    hintMore: (need: number, timed: boolean, name: string) =>
      need === 1
        ? `Apruebe 1 examen más${timed ? ' con tiempo' : ''} para ganar ${name}.`
        : `Apruebe ${need} más${timed ? ' con tiempo' : ''} seguidos para ganar ${name}.`,
  },
  readiness: {
    verdicts: { 'Getting started': 'Empezando', 'Closing in': 'Ya casi', Ready: 'Listo' },
    odds: 'Un examen aprobado predice más o menos tres probabilidades en cuatro el día del examen; tres seguidos, más o menos nueve en diez.',
    ready: (streak: number) =>
      `${streak} exámenes aprobados seguidos — esa es la meta, y usted la alcanzó. Vaya y haga su cita para el examen de verdad.`,
    restarted: (odds: string) =>
      `La racha vuelve a cero — los aprobados tienen que ser seguidos. Haga el siguiente. ${odds}`,
    begin: (odds: string) => `Apruebe un examen y empieza la racha. ${odds}`,
    oneDown: (need: number, odds: string) => `Uno menos. ${need} más seguidos y lo logra. ${odds}`,
    inARow: (streak: number, need: number) =>
      `${streak} seguidos. ${need === 1 ? 'Uno más' : `${need} más`} y está listo.`,
  },
  pitch: {
    freeSections: (free: number) => (free === 1 ? 'sección' : `${free} secciones`),
    yourState: 'su estado',
    why: (whose: string, free: number, top: string) => [
      {
        title: `Escrito a partir del manual de ${whose}`,
        text:
          `Cada regla aquí sale del manual del conductor que publica ${whose}, una regla a la ` +
          'vez con la razón que la explica, y una pregunta sobre ella mientras la tiene fresca. Si ' +
          'se equivoca, encuentra lo que le falta ahora, no la mañana del examen.',
      },
      {
        title: 'Un solo pago, sin suscripción',
        text:
          'Un solo pago, una vez. Nada se renueva, no hay nada que cancelar y nada que ' +
          'recordar. ' +
          `La prueba de 10 preguntas y la primera ${
            free === 1 ? 'sección' : `${free} secciones`
          } de tarjetas son gratis; el pago es por el resto de las tarjetas y los exámenes completos ` +
          `que lo llevan hasta ${top}.`,
      },
      {
        title: 'Sin cuenta, sin nombre',
        text:
          'Su progreso se guarda en este dispositivo. No hay nada donde iniciar sesión ni nada que ' +
          'borrar después, aquí nada sabe quién es usted, y la corta lista de lo que se ' +
          'cuenta está en la',
        link: { text: 'página de privacidad', href: '#privacy' },
      },
    ],
    refundPromise: '',
    freeToStart: (free: number) =>
      `Gratis para empezar: una prueba de 10 preguntas y la primera ${
        free === 1 ? 'sección' : `${free} secciones`
      } de tarjetas. Sin registrarse, sin cuenta.`,
    difference: {
      title: 'No es un montón de preguntas al azar',
      text:
        'La mayoría de los sitios de práctica le dan un montón de preguntas y dejan que encuentre ' +
        'lo que le falta reprobando. Aquí cada pregunta va unida a la regla que evalúa y a la razón ' +
        'de esa regla, así que una respuesta equivocada lo lleva a algo que puede leer, ' +
        'no a una calificación con la que no puede hacer nada.',
    },
    coverage:
      'Los exámenes de práctica siguen la forma del examen real de su estado — la misma calificación para aprobar, y ' +
      'el mismo número de preguntas dondequiera que el estado lo publica.',
  },
  method: {
    method:
      'lee una ley y la razón que la explica, y luego contesta una pregunta sobre esa ley mientras la tiene fresca',
    prose: (method: string) => [
      'La mayoría de los exámenes de práctica le dan un montón de preguntas y dejan el manual en otra parte. Este los pone juntos.',
      `Usted ${method}. Si acierta, sigue adelante; si se equivoca, encontró lo que le falta cuando es fácil arreglarlo, no la mañana del examen.`,
      'Aprender una regla a la vez, y demostrarlo enseguida, es lo que convierte un manual que leyó por encima en algo que de verdad sabe — y hace que estudiar se sienta como avanzar y no como esperar a ver qué pasa.',
    ],
    headline: (stateName: string) => `Apruebe su examen escrito de ${stateName}`,
    benefit: 'Conozca cada regla del examen antes de presentarlo.',
  },
  picker: {
    title: 'Apruebe el examen',
    tagline: (manifest: string) =>
      manifest === "Your state's permit test, one law at a time"
        ? 'El examen del permiso de su estado, una ley a la vez'
        : manifest,
    choose: 'Elija su estado',
    search: 'Busque su estado',
    states: 'Estados',
    noMatch: (query: string) => `Ningún estado coincide con “${query}”`,
    diagnostic: 'Haga una prueba de 10 preguntas',
    study: 'o empiece a estudiar',
    licenseAlt: (name: string) =>
      `Una ilustración de una licencia de manejar de muestra de ${name} con la foto de Howard.`,
    howItWorks: 'Cómo funciona',
    stepLearn: 'Aprenda los conceptos clave, una tarjeta a la vez',
    stepTest: 'Haga exámenes de práctica con la forma del examen real de su estado',
    stepLevels: (levels: readonly { name: string; requires: number }[]) =>
      `Apruebe 1 examen para ${levels[0].name}, ${levels[1].requires} seguidos para ${levels[1].name}, ${levels[2].requires} seguidos para ${levels[2].name}`,
    whyThisOne: 'Por qué este',
    whatThisIs: 'Qué es esto',
    whatItCovers: 'Qué cubre',
    youtube: 'Véanos en YouTube',
  },
  landing: {
    sentBy: (partner: string): Rich => [
      'De parte de ',
      { b: partner },
      '. Su descuento se aplica cuando compre.',
    ],
    diagnostic: 'Haga una prueba de 10 preguntas',
    study: 'o empiece a estudiar',
    licenseAlt: (name: string) =>
      `Una ilustración de una licencia de manejar de ${name} con la foto de Howard.`,
    intro: (laws: number, stateName: string, exactly: boolean) =>
      `${laws} reglas del permiso de ${stateName}, una a la vez: lea la regla y la razón que la explica, y luego ` +
      `conteste una pregunta sobre ella enseguida. Después, exámenes de práctica ${
        exactly ? 'exactamente como el examen real' : 'como el examen real'
      }.`,
    theExam: 'El examen',
    questions: 'preguntas',
    toPassParts: 'para aprobar, parte por parte',
    toPass: 'para aprobar',
    passMark: 'para aprobar',
    timeLimit: (minutes: number) => ` Tiene ${minutes} minutos para hacerlo.`,
    comesOutOf: (manual: string, agency: string | null) =>
      ` Todo lo que trae sale del ${manual}` +
      (agency !== null ? `, publicado por la ${agency}.` : '.'),
    howThisWorks: 'Cómo funciona esto',
    fromTheManual: 'Directo del manual',
    whatTests: (stateName: string) => `Lo que evalúa ${stateName}`,
    conceptsCount: (concepts: number, laws: number) => `${concepts} conceptos, ${laws} reglas distintas.`,
    courses: (short: number, full: number) =>
      `Cada tema en ${short} tarjetas, o cada ley en ${full} — usted elige en la primera tarjeta, y puede cambiar de opinión cuando quiera.`,
    gettingPermit: (stateName: string) => `Cómo sacar su permiso de ${stateName}`,
    whyThisOne: 'Por qué este',
    whereFrom: 'De dónde sale esto',
    sources: (manual: string, agency: string | null, updated: string | null) =>
      `Cada regla aquí está escrita a partir del ${manual}` +
      (agency !== null ? `, publicado por la ${agency}` : '') +
      (updated !== null ? `, revisado por última vez el ${updated}` : '') +
      '. Donde no coincidan, el manual tiene la razón.',
  },
  study: {
    quizMe: 'Pregúnteme',
    takeTest: 'Hacer el examen',
    tryTen: 'Pruebe 10 preguntas de muestra',
    fromWhole: (stateName: string) => `de todo el examen de ${stateName}`,
  },
  question: {
    signLabels: ['Señal 1', 'Señal 2', 'Señal 3', 'Señal 4'],
    correct: 'Correcta',
    wrong: 'Equivocada',
    backToCard: 'Volver a la tarjeta',
    right: '¡Muy bien! Es correcto.',
    notQuite: 'No exactamente.',
    inTheManual: (page: string) => `En el manual en español, ${page}`,
    inTheEnglishManual: (page: string) => `En el manual en inglés, ${page}`,
    nextLaw: 'Siguiente ley',
    reviewLaw: 'Repasar la ley',
    nextQuestion: 'Siguiente pregunta',
    translation: 'Traducción de Howard’s Lantern — avísenos si algo ',
    translationLink: 'no está claro',
  },
  prescreen: {
    position: (position: number, length: number) => `Pregunta ${position} de ${length}`,
    explainer:
      'Va a fallar la mayoría de estas. Está bien — una respuesta equivocada con la correcta justo detrás se recuerda mejor que leer. Lo que falle, se lo enseñamos después.',
    skip: 'Ir a las tarjetas',
  },
  checkpoint: {
    done: (concept: string) => `${concept} — listo`,
    topics: (topics: number) =>
      topics === 1
        ? 'Un tema más'
        : `${['Ningún', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'][topics] ?? topics} temas más`,
    testedOut: (count: number) => `${count} que ya sabía`,
    freePart: 'Esa fue la parte gratis.',
    wall: (sections: number) =>
      `Un solo pago abre todo desde aquí hasta el examen: las ${sections} secciones, cada ley que le pueden preguntar, y exámenes completos sin límite. El precio viene a continuación.`,
  },
  test: {
    timeRemaining: (left: string) => `Tiempo restante: ${left}`,
    left: (left: string) => `quedan ${left}`,
    stopClock: 'Parar el reloj',
  },
  setup: {
    heading: '¿Listo para el examen?',
    missed: (count: number) =>
      `La última vez falló ${count} pregunta${count === 1 ? '' : 's'}. ¿Quiere intentar otra vez solo esas?`,
    everyLevel: 'Ya ganó todos los niveles.',
    retest: 'Repetir las que falló',
    fresh: 'Examen completo nuevo',
  },
  passComplete: {
    headingShort: 'Todos los temas cubiertos',
    headingFull: 'Todas las leyes cubiertas',
    taughtShort: (stateName: string | null) =>
      stateName === null
        ? 'Ya aprendió una o dos leyes de cada tema que el examen puede preguntar.'
        : `Ya aprendió una o dos leyes de cada tema que ${stateName} le puede preguntar.`,
    taughtFull: (stateName: string | null) =>
      stateName === null
        ? 'Ya aprendió cada ley que el examen puede preguntar.'
        : `Ya aprendió cada ley que ${stateName} le puede preguntar.`,
    lawsTaught: 'leyes aprendidas',
    topics: 'temas',
    testsShort:
      'Ahora los exámenes. Sacan preguntas de todas las leyes del estado, no solo de las que vio, así que algunas serán nuevas.',
    testsFull:
      'Ahora los exámenes. Sacan preguntas de las mismas leyes que acaba de repasar, así que nada será nuevo.',
    start: 'Empezar los exámenes',
  },
  walkDone: {
    heading: (cards: number) =>
      cards === 1 ? 'La tarjeta que falló — lista' : `Las ${cards} tarjetas que falló — listas`,
    nextHub: 'Lo siguiente: volver al inicio.',
    nextStart: 'Lo siguiente: empezar a estudiar, desde la tarjeta 1.',
    nextResume: (card: number) => `Lo siguiente: volver a estudiar, desde la tarjeta ${card}.`,
  },
  hub: {
    covered: (concepts: number) => `Los ${concepts} conceptos cubiertos`,
    level: (level: number, earnedBy: string) => `Nivel ${level} · ${earnedBy}`,
    everyLevel: 'Todos los niveles ganados.',
    earned: (date: string) => `Ganado el ${date}.`,
    timedOn: (minutes: number) => `Con tiempo: ${minutes} min`,
    timedOff: 'Con tiempo: no',
    worthAnother: 'Vale la pena repasar',
    restudy: (count: number) =>
      count === 1 ? 'Repasar este concepto' : `Repasar estos ${count} conceptos`,
    lastTest: (score: number, total: number, passed: boolean) =>
      `Último examen: ${score} / ${total}${passed ? ' — aprobado' : ''}`,
    mastered: (count: number) => `${count} pregunta${count === 1 ? '' : 's'} dominada${count === 1 ? '' : 's'}`,
    takeTest: 'Hacer el examen',
    studyAgain: 'Estudiar las leyes otra vez',
    dateLocale: 'es-US',
  },
  results: {
    tellSomeone: 'Cuénteselo a alguien',
    copied: 'Copiado',
    share: 'Compartir',
    copiedNote: 'Copiado. Péguelo donde quiera.',
    unlocked: (name: string) => `${name} desbloqueado`,
    expired:
      'Se acabó el tiempo. Lo que no alcanzó a contestar cuenta como fallado, igual que en el examen real.',
    whereYouStand: 'Dónde está usted',
    retestComplete: 'Repaso terminado',
    passed: 'Aprobado',
    fellShort: (names: readonly string[]) => `No alcanzó en ${names.join(' y ')}`,
    oneShort: 'Le faltó una pregunta',
    short: (short: number) => `Le faltaron ${short} para aprobar`,
    covered: (covered: number, total: number) => `Ha cubierto ${covered} de ${total} leyes`,
    gainedNone: ' — ninguna nueva desde la última vez.',
    gained: (gained: number) => ` — ${gained} más que la última vez.`,
    yourRuns: 'Sus intentos: ',
    outOf: (total: number) => ` de ${total}`,
    drawFresh: (total: number) =>
      `Estas diez preguntas salieron de las ${total} leyes — un punto de partida, no una calificación.`,
    drawRetake: (total: number) =>
      'Estas diez empezaron con las leyes que falló y las tarjetas que ha estudiado desde entonces — una revisión de lo que acaba de corregir, no una muestra nueva de las ' +
      `${total}.`,
    partScore: (name: string, score: number, total: number, passMark: number, cleared: boolean) =>
      `${name}: ${score} de ${total}` +
      (passMark === 0
        ? ''
        : cleared
          ? `, se necesitan ${passMark} — aprobado`
          : `, se necesitan ${passMark}`),
    certified: 'Preparado.',
    streakReset: 'Los exámenes se tienen que aprobar seguidos, así que este reinicia la cuenta.',
    newlyMastered: (count: number) => `+${count} dominadas`,
    improvedCards: (gained: number) =>
      `Son ${gained} tarjeta${gained === 1 ? '' : 's'} de estudio, y se nota en la calificación.`,
    improvedPlain: 'El estudio se nota en la calificación.',
    fullNext: (questions: number) =>
      `Lo siguiente es el examen completo de ${questions} preguntas — con la forma real, calificado como el real.`,
    takeFull: (questions: number) => `Hacer el examen completo de ${questions} preguntas`,
    worthAnother: 'Vale la pena repasar',
    restudyBefore: 'Repase antes de su próximo intento',
    oneConcept: 'Todas las fallas fueron en este concepto.',
    concepts: 'Los conceptos que señalan sus fallas, primero los más fallados.',
    restudyStart: 'Repasar lo que falló',
    missed: 'Preguntas que falló',
    feedback: 'Cuéntenos cómo le va',
  },
  paywall: {
    heading: (price: string) => `Siga adelante por ${price}`,
    offWith: (percent: number) => `${percent}% de descuento con`,
    from: 'de',
    scoredShort: (score: number, total: number) => `Sacó ${score} de ${total} en la prueba corta.`,
    realExam: (questions: number, passMark: number) =>
      `El examen real tiene ${questions} preguntas y necesita ${passMark}.`,
    passHere: (passMark: number, questions: number) => `Aquí se aprueba con ${passMark} de ${questions}.`,
    scored: (score: number, total: number) => `Sacó ${score} de ${total}.`,
    realNeeds: (passMark: number) => `El examen real necesita ${passMark}.`,
    passHereMark: (passMark: number) => `Aquí se aprueba con ${passMark}.`,
    threeTimes: 'Hágalo tres veces seguidas y está listo.',
    whatYouGet: 'Lo que recibe',
    sections: (sections: number) =>
      `Las ${sections} secciones de tarjetas de estudio — cada ley que el examen puede preguntar, y por qué`,
    shortCourse: 'O el curso corto — cada tema, una o dos leyes por tema',
    onCourse: (course: 'full' | 'short') =>
      course === 'full' ? 'Usted está en el curso completo' : 'Usted está en el curso corto',
    unlimited: (questions: number, chosen: boolean) =>
      `Exámenes de ${questions} preguntas sin límite, ${
        chosen ? 'sacados del manual de su estado' : 'sacados como el examen real'
      }`,
    retests: 'Repasos hechos exactamente con lo que falló',
    levels: 'Todos los niveles hasta Preparado — tres aprobados seguidos',
    oneTime: 'Un solo pago. No es una suscripción. Nada que cancelar.',
    discountCode: 'Código de descuento',
    enterCode: 'Escriba su código',
    apply: 'Aplicar',
    deadNone: 'Ese código no funciona. Todavía puede comprar al precio normal.',
    dead: (code: string) => `No reconocemos ${code}. Todavía puede comprar al precio normal.`,
    recoveryCode: 'Código de recuperación',
    checking: 'Revisando…',
    restore: 'Recuperar mi compra',
    opening: 'Abriendo el pago…',
    unlock: (price: string) => `Desbloquear por ${price}`,
    backToPayment: 'Volver al pago',
    alreadyPaid: 'Ya pagué',
    contact: (email: string) => `Preguntas: ${email}`,
  },
  purchased: {
    heading: '¡Ya está adentro!',
    unlocked: 'Todos los exámenes hasta Preparado ya están desbloqueados.',
    writeDown: 'Anote esto',
    onlyWay:
      'Es la única manera de volver a entrar en otro teléfono o navegador, o si borra este. No se lo enviamos por correo.',
    start: 'Empezar un examen',
    lost: (email: string) => `¿Lo perdió? ${email}`,
  },
  menu: {
    title: 'Apruebe el examen',
    thisTest: 'Este examen',
    settings: 'Ajustes',
    contact: 'Comuníquese',
    about: 'Acerca de esta aplicación',
    home: 'Inicio',
    stateTest: (name: string) => `El examen de ${name}`,
    sendFeedback: 'Enviar comentarios',
    restartTest: 'Empezar este examen otra vez',
    startOver: 'Empezar de nuevo',
    close: 'Cerrar',
    aboutState: (name: string) => `Acerca del examen de ${name}`,
    keyNumbers: 'Números clave',
    timed: (on: boolean, minutes: number) =>
      `Exámenes con tiempo: ${on ? `sí · ${minutes} min` : 'no'}`,
    course: (name: 'full' | 'short', cards: number) =>
      `Curso: ${name === 'full' ? 'completo' : 'corto'} · ${cards} tarjetas`,
    motion: (off: boolean) => `Movimiento: ${off ? 'no' : 'sí'}`,
    refund: 'Pedir un reembolso',
    contactUs: 'Contáctenos',
    faq: 'Preguntas frecuentes',
    aboutUs: 'Quiénes somos',
    partner: 'Hágase socio',
    privacy: 'Privacidad',
    terms: 'Términos de uso',
  },
  restart: {
    heading: '¿Empezar de nuevo?',
    forgets:
      'Esto borra todo lo que este dispositivo ha aprendido: cuánto ha avanzado en las tarjetas, qué leyes domina, cada examen de práctica que ha hecho y la racha que llevaban. Va a empezar otra vez en la primera tarjeta.',
    cannotUndo:
      'No se puede deshacer. Su progreso se guarda en este dispositivo y en ningún otro lugar, así que no tenemos una copia para devolverle.',
    keepsPurchase: 'Si ya pagó, su compra no cambia. Conserva los exámenes que compró.',
    confirm: 'Sí, empezar de nuevo',
    cancel: 'Conservar mi progreso',
  },
  course: {
    toShort: '¿Cambiar al curso corto?',
    toFull: '¿Cambiar al curso completo?',
    sizesShort: (short: number, full: number): Rich => [
      'Cada tema, una o dos leyes por tema — ',
      { b: `${short} tarjetas en vez de ${full}` },
      '.',
    ],
    testsUnchanged: (full: number) =>
      `Los exámenes siguen cubriendo las ${full}, así que su calificación mostrará lo que se saltó.`,
    backShort:
      'Puede regresar cuando quiera; no pierde nada de lo que ha hecho. Cualquier tema del que quiera más está a un toque en el mapa de secciones — una pastilla verde recorre todas sus tarjetas.',
    sizesFull: (full: number, short: number): Rich => [
      'Cada ley, tarjeta por tarjeta — ',
      { b: `${full} tarjetas en vez de ${short}` },
      '.',
    ],
    backFull:
      'Puede regresar cuando quiera; no pierde nada de lo que ha hecho. Las tarjetas que ya estudió se quedan estudiadas.',
    confirmShort: 'Cambiar al curso corto',
    confirmFull: 'Cambiar al curso completo',
    keepFull: 'Seguir en el curso completo',
    keepShort: 'Seguir en el curso corto',
  },
  map: {
    heading: (stateName: string | null) =>
      stateName === null ? 'Todas las leyes' : `Todas las leyes de ${stateName}`,
    summary: (done: number, total: number) =>
      `${done} de ${total} temas ya los hizo. Toque uno verde para repasarlo, o uno gris para que le hagan la prueba.`,
  },
  feedback: {
    thanks: 'Gracias',
    duplicate: 'Ya nos envió comentarios hace poco, así que guardamos el primero. Sí se lee.',
    read: 'Lo lee la persona que hace esto, y es la única manera de saber si algo de esto funcionó.',
    heading: '¿Cómo le va?',
    rate: '¿Qué calificación le da a la aplicación?',
    ratingOf: (value: number) => `${value} de 5`,
    taken: '¿Ya presentó el examen del estado?',
    outcomes: { passed: 'Lo aprobé', failed: 'No lo aprobé', not_yet: 'Todavía no lo presento' },
    anything: '¿Algo más? (opcional)',
    placeholder: 'Qué funcionó, qué no, qué estaba mal.',
    email:
      'Deje su correo si quiere respuesta — se guarda. Su código de recuperación se quita antes de enviarlo.',
    failed: (email: string) =>
      `No se envió. Inténtelo otra vez, o mándelo a ${email} — lo que escribió sigue aquí.`,
    sending: 'Enviando…',
    tryAgain: 'Intentar otra vez',
    send: 'Enviar',
  },
  refund: {
    heading: 'Pedir un reembolso',
    intro:
      'Si llegó a Preparado aquí y aun así no aprobó el examen real, le devolvemos su dinero.',
    email: (address: string) => `Escriba a ${address}`,
    photo: [
      'Adjunte una foto de su resultado oficial de la oficina de licencias — el papel impreso o la pantalla — donde se vea ',
      { b: 'su nombre' },
      ' y ',
      { b: 'la fecha' },
      '. Una foto con el teléfono está bien. No tiene que ser escaneada.',
    ],
    code: [
      'Incluya el ',
      { b: 'código de recuperación' },
      ' de su recibo. Es lo único que identifica su compra — aquí no hay cuentas — así que sin él no lo podemos encontrar.',
    ],
    conditions: 'Tres condiciones',
    certified: ['Llegó a ', { b: 'Preparado' }, ' — tres exámenes completos aprobados seguidos.'],
    within: ['Está dentro de los ', { b: '21 días' }, ' después de pagar.'],
    photoSent: 'Envía la foto descrita arriba.',
    back: 'Lo que se devuelve',
    paid: [
      'Lo que pagó, ',
      { b: 'menos la comisión por el pago con tarjeta' },
      ' — la compañía de la tarjeta se queda con eso aunque se devuelva el pago, así que no nos toca devolverlo. Su acceso aquí termina cuando se hace el reembolso.',
    ],
    tokensHeading: 'Créditos de preguntas',
    tokens: [
      'Un paquete de créditos de preguntas del que no se ha usado ninguno se reembolsa, ',
      { b: 'menos la comisión por el pago con tarjeta' },
      ': escriba con su ',
      { b: 'código de preguntas' },
      '. Los créditos no caducan, así que no hay plazo. Un crédito es una pregunta sobre un estado; una pregunta para todo el país cuesta cinco.',
    ],
  },
  footer: {
    nav: 'Acerca de este sitio',
    terms: 'Términos',
    privacy: 'Privacidad',
    faq: 'Preguntas',
    ask: 'Haga una pregunta',
    about: 'Quiénes somos',
    contact: 'Contacto',
    // The page is in English only, as the ask notice's link also says.
    method: 'Cómo funciona (en inglés)',
    line: (year: number) => `© ${year} Howard’s Lantern · No es un sitio oficial del estado`,
  },
  contact: {
    title: 'Contáctenos',
    intro:
      'Una persona lee esto y responde por correo. Para un reembolso, use la página Pedir un reembolso — necesita una foto que este formulario no recibe.',
    email: 'Su correo, para poder responderle',
    message: 'Su mensaje',
    placeholder: 'Lo que quiere decirnos o preguntarnos.',
    send: 'Enviar',
    sending: 'Enviando…',
    waiting: 'Un momento — comprobando que es una persona.',
    sentHeading: 'Enviado',
    sent: (address: string) =>
      `Una persona lo lee y responde a la dirección que dio. Si no recibe nada en unos días, escriba a ${address}.`,
    notAPerson: (address: string) =>
      `Al verificador no le pareció una persona. Inténtelo de nuevo, o escriba a ${address}.`,
    failed: (address: string) => `Eso no se envió. Inténtelo de nuevo, o escriba a ${address}.`,
    page: 'Página de contacto',
  },
  ask: {
    title: 'Haga una pregunta',
    short: 'Pregunte',
    rest: ' algo',
    cantFind: '¿No lo encuentra? Pregunte.',
    feedback: '¿Algo mal en una tarjeta, o algo que decirnos? Envíe comentarios.',
    entry: (stateName: string | null) =>
      `Haga cualquier pregunta sobre las leyes de tránsito de ${stateName === null ? 'su estado' : stateName}`,
    answeringFor: (stateName: string) => `Respondiendo para ${stateName}.`,
    noState: 'Todavía no ha elegido un estado.',
    change: 'Cambiar',
    cancel: 'Cancelar',
    nationwide: 'Todo el país — comparar todos los estados',
    answeringNationwide: 'Respondiendo para los 50 estados y DC.',
    limitTitle: 'Ese es el límite de esta semana',
    limitNationwide: (count: number) =>
      `Esta semana ya hizo ${count} preguntas para todo el país, que es el límite semanal. Esas respuestas leen la ley de cada estado, así que se racionan; el conteo empieza de nuevo el lunes.`,
    limitState: (count: number) => `Esta semana ya hizo ${count} preguntas, que es el límite semanal. El conteo empieza de nuevo el lunes.`,
    questionsLeft: (left: number, limit: number, days: number, tokens: number | null) =>
      tokens === null
        ? `${left}/${limit} preguntas gratis esta semana · ${limit} más en ${days} ${days === 1 ? 'día' : 'días'}, o compre créditos`
        : `${left}/${limit} preguntas gratis esta semana · ${tokens} ${tokens === 1 ? 'crédito' : 'créditos'} · ${limit} más gratis en ${days} ${days === 1 ? 'día' : 'días'}`,
    buyTitle: 'Más preguntas',
    tokenIs: 'Un crédito es una pregunta sobre un estado; una pregunta para todo el país cuesta cinco.',
    pack: (tokens: number, price: string) => `${tokens} créditos — ${price}`,
    buyPack: (tokens: number, price: string) => `Comprar ${tokens} créditos por ${price}`,
    dollarPack: 'El paquete de un dólar da menos créditos por dólar, porque la comisión de la tarjeta es un tercio de él.',
    classroom: 'Un maestro o una escuela puede compartir un mismo código entre los dispositivos de una clase.',
    notNow: 'Ahora no',
    haveCode: 'Tengo un código',
    codeLabel: 'Código de preguntas',
    codeSubmit: 'Usar este código',
    codeUnknown: 'No se reconoció ese código.',
    codeTrouble: 'No se pudo comprobar en este momento. Inténtelo de nuevo en un momento.',
    codeRestored: (code: string, count: number) => `El código ${code} ya está en este dispositivo, con ${count} ${count === 1 ? 'crédito' : 'créditos'}.`,
    notForSale: 'Los créditos todavía no están a la venta. Inténtelo pronto.',
    checkoutTrouble: 'No se pudo abrir la página de pago. Inténtelo de nuevo en un momento.',
    tokensReady: 'Los créditos están listos — toque Preguntar para enviar esa pregunta.',
    tokensReadyNoQuestion: 'Los créditos están listos.',
    questionCode: (code: string) => `El código de preguntas es ${code}. Guárdelo: lleva estos créditos a otro dispositivo. Se envía una copia al correo dado al pagar.`,
    tokensPending: 'El pago todavía se está confirmando. Vuelva a cargar esta página en un minuto; si los créditos no llegan, escríbanos.',
    spendTitle: '¿Usar un crédito?',
    spendBody: (cost: number, left: number) =>
      `Las preguntas gratis de esta semana ya se usaron. Esta pregunta cuesta ${cost} ${cost === 1 ? 'crédito' : 'créditos'}, y el código tiene ${left}. Se pregunta una vez por visita.`,
    spendYes: 'Usar',
    labels: {
      label: 'Haga una pregunta',
      placeholder: 'Escriba su pregunta aquí',
      button: 'Preguntar',
      asking: 'Preguntando…',
      waiting: 'Un momento — comprobando que es una persona.',
      trouble: 'Eso no se envió. Inténtelo de nuevo en un momento.',
      noMatch: 'No tengo una respuesta para esa.',
      handOff: 'Van dos que no pude responder, así que esta es mejor preguntársela a una persona.',
      writeTo: 'Escriba a',
      reads: 'y una persona lo lee.',
      readMore: 'Leer más',
      statePage: 'La página de su estado',
      chooseState: 'Elija su estado',
      inTheLaw: (reference: string) => `No está en su manual — ${reference}`,
      card: 'Ver la tarjeta',
      comparePage: 'Lo que se puede comparar',
      absent: (names: string) => `No se encontró una regla en el manual ni en el código de: ${names}`,
      moreStates: (count: number) => `Mostrar ${count} ${count === 1 ? 'estado' : 'estados'} más`,
      asOf: (date: string) => `vigente al ${shortDate(date, 'es')}`,
      sourcesLine: (documents: string) => `Fuentes: ${documents}`,
      // The corpus cites the English manual, and the citations under the
      // tap say so ("En el manual en inglés"); the line says it first.
      manualSource: (state: string | null, pages: string) =>
        `${state === null ? 'Manual en inglés' : `Manual de ${state} en inglés`}${pages === '' ? '' : `, ${pages}`}`,
      statesSources: (states: readonly string[]) =>
        states.length === 1
          ? `ley de ${states[0]}`
          : states.length <= 3
            ? `leyes de ${states.slice(0, -1).join(', ')} y ${states[states.length - 1]}`
            : `leyes de ${states[0]}, ${states[1]} y ${states.length - 2} estados más`,
      showLaw: 'Ver la ley',
      hideLaw: 'Ocultar la ley',
      showAnswer: 'Ver la respuesta',
      hideAnswer: 'Ocultar la respuesta',
      deleteQuestion: 'Borrar esta pregunta',
      showEarlier: (count: number) => `Ver ${count} más`,
      showLess: 'Ver menos',
    },
    subscribeOffer: 'Cada mes: lo que cambió en las leyes de tránsito estatales.',
    subscribeLink: 'Recíbelo por correo (en inglés)',
    chipsLabel: 'Datos gratis de todos los estados — toque todos los que quiera',
    stateChipsLabel: (state: string) => `Respuestas gratis para ${state} — toque todas las que quiera`,
    chipFree: 'gratis',
    ownQuestion: 'Haga su propia pregunta',
  },
  faq: {
    heading: 'Preguntas frecuentes',
    groups: {
      test: 'El examen aquí',
      paying: 'El pago',
      data: 'Sus datos',
      us: 'Quiénes somos',
    },
  },
  about: {
    heading: 'Quiénes somos',
    people: 'Las personas que hacen esto.',
    roles: {
      'President/CEO': 'Presidenta y directora general',
      'Project Manager': 'Gerente de proyecto',
      Host: 'Presentador',
    },
  },
  aboutState: {
    heading: (stateName: string) => `Acerca del examen de ${stateName}`,
    theTest: 'El examen',
    passMark: 'Para aprobar',
    timeLimit: 'Tiempo límite',
    howGiven: 'Cómo se presenta',
    languages: 'Idiomas',
    gettingPermit: 'Cómo sacar su permiso',
    whereFrom: 'De dónde sale esto',
    source: (manual: string | null, agency: string | null, updated: string | null) =>
      (manual !== null ? `Escrito a partir del ${manual}` : '') +
      (manual !== null && agency !== null ? ', publicado por la ' : '') +
      (agency !== null ? (manual === null ? 'Publicado por la ' : '') + agency : '') +
      (updated !== null ? `, y revisado por última vez el ${updated}` : '') +
      '. Donde esta aplicación y el manual no coincidan, el manual tiene la razón.',
  },
  numbers: {
    heading: (stateName: string | null) => `Números clave${stateName !== null ? ` — ${stateName}` : ''}`,
    choose: 'Elija un estado para ver sus números clave.',
    intro: (stateName: string) =>
      `Cada regla del manual de ${stateName} que se reduce a un número — límites de velocidad, alcohol en la sangre, distancias, multas, puntos, edades y horas — tal como se enseña aquí. Imprima esta página, o guárdela como PDF.`,
    print: 'Imprimir o guardar como PDF',
  },
  speech: {
    numbers: ['Uno.', 'Dos.', 'Tres.', 'Cuatro.'],
  },
  legal: {
    termsSummary: [
      'Esta traducción es para su comodidad; la versión en inglés es la que rige.',
      'La garantía de aprobar o recibir un reembolso cubre solo el curso en inglés. El idioma en que usted paga es el que cuenta: si paga con la aplicación en español, la garantía no aplica.',
      'Lo que compra es acceso a esta aplicación en este dispositivo y en los que abra con su código de recuperación. No hay suscripción ni pagos que se renueven.',
      'Los créditos de preguntas se venden aparte, en paquetes: un crédito es una pregunta sobre un estado y una pregunta para todo el país cuesta cinco. No caducan, se guardan con un código que se puede compartir, y un paquete sin usar se reembolsa menos la comisión de la tarjeta.',
    ],
    privacySummary: [
      'Esta traducción es para su comodidad; la versión en inglés es la que rige.',
      'No tiene cuenta y no le pedimos su nombre. Su progreso se guarda en este dispositivo.',
      'Contamos lo que se usa, sin saber quién es usted. Cuando elige un estado, cuando nos envía comentarios y cuando paga, se guarda el idioma en que lo hizo.',
      'Cada pregunta pagada con un crédito se guarda con el código de preguntas que la pagó, a propósito, para poder leer lo que preguntan quienes compran. Una pregunta gratis no lleva código.',
    ],
  },
  partnerPage: {
    back: '← Volver',
    backButton: 'Volver',
    title: 'Hágase socio',
    lead:
      'Un estudiante llama para pedir clases y todavía no tiene el permiso. La respuesta de siempre es “vuelva cuando lo tenga”, y para cuando llega el permiso, puede que llame a otra escuela. En su lugar, envíele su propio enlace: se prepara para el examen del permiso con su nombre desde esa primera llamada, usted ve cómo avanza y sabe el día en que está listo para reservar. Usted conserva al estudiante. El código y la comisión vienen después.',
    without: 'Sin esto',
    withoutSays: '“Vuelva cuando tenga su permiso.”',
    withoutThen:
      'Cuelgan y estudian por su cuenta. Semanas después, con el permiso en la mano, reservan con quien encuentren en ese momento, y usted no vuelve a saber de ellos.',
    with: 'Con esto',
    withSays: '“Aquí tiene nuestro enlace: empiece a estudiar hoy.”',
    withThen:
      'Estudian con su nombre desde la primera llamada, usted ve cómo avanzan y le enviamos un correo cuando están listos. La primera clase se reserva con usted.',
    atAGlance: 'De un vistazo',
    howItWorks: 'Cómo funciona',
    how: [
      {
        title: 'Usted invita a un estudiante',
        body: 'Desde su portal, con un nombre o unas iniciales para saber quién es quién. Recibe un enlace para enviárselo al estudiante. También hay un código y un enlace generales para todos los demás.',
      },
      {
        title: 'Estudian con su nombre',
        body: 'El nombre de su negocio aparece arriba en cada pantalla que ven, y pagan menos de lo que pagarían sin usted.',
      },
      {
        title: 'Usted ve cómo avanza cada uno',
        body: 'Si ya empezaron, qué tarjetas responden mal y si aprobaron un examen de práctica.',
      },
      {
        title: 'Le avisamos cuando están listos',
        body: 'Cuando un estudiante que usted invitó aprueba su primer examen de práctica completo, le enviamos un correo: es el momento de reservar su cita para el examen de conocimientos. Cuando aprueba tres seguidos, le escribimos de nuevo: está listo, y es el día de reservar su primera clase.',
      },
      {
        title: 'Cada venta además le da una comisión',
        body: 'Queda pendiente 30 días después de la venta, más que cualquier reembolso que hayamos visto, y después se paga. Sus condiciones se fijan cuando se aprueba su solicitud y están escritas con palabras en la página de su portal, no en una tabla que tenga que pedirnos.',
      },
      {
        title: 'Su código se renueva solo',
        body: 'Cada doce meses, mientras lo esté usando. No tiene que pedirlo, y el portal le muestra la próxima fecha de renovación.',
      },
      {
        title: 'Cualquiera de los dos puede terminar',
        body: 'El acuerdo termina en cualquier momento, por cualquier motivo, de cualquiera de las dos partes. Lo que ya ganó se liquida y se paga igual.',
      },
    ],
    askHeading: 'Pregúntenos lo que quiera',
    askLanguage: 'Puede preguntar en español; por ahora las respuestas están en inglés.',
    examples: ['¿Cuánto cuesta unirse?', '¿Quién puede ser socio?', '¿Cómo pagan?'],
    beforeHeading: 'Antes de solicitar',
    before:
      'El acuerdo completo está publicado y puede leerlo palabra por palabra antes de darnos un correo electrónico. Está en inglés, y la versión en inglés es la que rige; la solicitud y el portal también están en inglés.',
    agreementLink: 'Leer el acuerdo de socios (en inglés)',
    apply: 'Solicitar ser socio',
    flow: {
      label: 'Cómo un estudiante que usted invita llega a sus clases',
      to: 'a',
      you: 'Usted',
      student: 'Su estudiante',
      us: 'Howard’s Lantern',
      emailTo: 'Correo para usted',
      youEarn: 'Usted gana',
      link: 'Usted envía su enlace',
      linkDetail: 'Los invita desde su portal, con un nombre o unas iniciales.',
      study: 'Estudian con su nombre',
      studyDetail: 'Su nombre está en cada pantalla. Usted ve su progreso en su portal.',
      buy: 'Compran el curso',
      buyDetail: 'La primera sección es gratis; para seguir, compran con su descuento.',
      buyReward: 'Una comisión por cada venta. Queda pendiente 30 días y después es suya.',
      first: 'Aprueban un primer examen de práctica completo',
      firstDetail: 'Le enviamos un correo.',
      firstEmail: 'Es hora de reservar su cita para el examen de conocimientos.',
      three: 'Aprueban tres seguidos',
      threeDetail: 'Le escribimos de nuevo.',
      threeEmail: 'Están listos. Reserve su primera clase.',
    },
  },
}

export const STRINGS: Record<Lang, Strings> = { en, es }
