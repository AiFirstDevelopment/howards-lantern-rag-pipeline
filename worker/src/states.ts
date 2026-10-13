/**
 * The fifty states and the District, by the code a link carries.
 *
 * The worker has no corpus and no manifest: which states are published is a
 * fact about the app's build, not about this service, and importing it here
 * would couple two bundles that may not import each other. What the worker
 * does need is the one thing a school reads in the ready alert -- "the New
 * Jersey test" rather than "the NJ test" -- and the names of the states are
 * not something a manifest decides.
 *
 * tests/unit/ready-level.test.ts holds every state the manifest publishes to
 * the name written here, so a state whose name the app spells one way and the
 * mail spells another fails there rather than in a school's inbox.
 */
export const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
}

/**
 * The shape a state code takes on a link, a checkout or a territory: two
 * capital letters, and nothing is looked up. Shape rather than membership of
 * the table above, because the suite's synthetic state `TS` has to travel the
 * same road a real one does.
 */
export const STATE_SHAPE = /^[A-Z]{2}$/

/**
 * A state's name, or the code itself for one this table does not carry.
 *
 * The code rather than nothing: a test fixture's synthetic state, or a state
 * added to the manifest before anybody edits this file, still produces a
 * sentence a reader can act on -- "the TS test" names the right paper, and
 * "the  test" names none.
 */
export function stateNameFor(code: string | null): string | null {
  if (code === null) return null
  return STATE_NAMES[code.toUpperCase()] ?? code.toUpperCase()
}
