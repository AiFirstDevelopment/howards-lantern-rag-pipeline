import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BROWSER_HEADERS, fetchState, liveReader, readRegistry, readState, type PageReader } from '../../scripts/penalties/fetch'
import { htmlTable } from '../../scripts/penalties/formats/html-table'
import { pdfRows } from '../../scripts/penalties/formats/pdf-rows'
import { paragraphOf, pdfTable } from '../../scripts/penalties/formats/pdf-table'
import { statuteList } from '../../scripts/penalties/formats/statute-list'
import { normalized, penaltyId, type PenaltySource } from '../../scripts/penalties/source'
import { refreshPenalties } from '../../scripts/statutes/refresh'
import { STATE_NAMES } from '../../worker/src/states'

/**
 * `npm run penalties:fetch` (docs/plans/what-happens-if.md, phase 2, decision
 * 11): the figure a learner pays, read from the court's own schedule and
 * written only where the schedule says it. Each adapter is driven on a page
 * of the shape it reads -- Maryland's DC-CR-090 as `pdftotext -layout` gives
 * it, a statute's prose, an HTML table -- and the fetch and the monthly
 * refresh against a reader that stands in for the court's site.
 */
const DCCR090 = readFileSync(path.join(__dirname, 'penalties/dccr090.txt'), 'utf8')
const MD_URL = 'https://www.mdcourts.gov/sites/default/files/court-forms/dccr090.pdf'
const MARYLAND: PenaltySource = {
  kind: 'schedule',
  url: MD_URL,
  title: 'District Court of Maryland, DC-CR-090 (Rev. 10/2026)',
  agency: 'District Court of Maryland',
  retrieved: '2026-10-10',
  format: 'pdf-table',
  cite: 'Md. Code, Transp. § {section}',
  looked: 'the schedule',
}

const STATUTE_URL = 'https://zz.example.test/code/1-101'
const STATUTE = `§ 1-101. License to be carried.
(a) A person shall have the license in possession while driving.
(c) A person who violates this section commits an offense punishable by a fine of not less than $25 or more than $200.
`
const ZZ_LOCAL: PenaltySource = {
  kind: 'local',
  url: STATUTE_URL,
  title: 'ZZ Code § 1-101',
  agency: 'ZZ Legislature',
  retrieved: '2026-10-10',
  format: 'statute-list',
  looked: 'no statewide schedule',
  rows: [
    {
      section: 'ZZ Code § 1-101',
      code: '1-101(c)',
      offence: 'Not carrying a license',
      fine: '$25 to $200',
      min: 2500,
      max: 20000,
      appear: 'court-sets',
      quote: 'punishable by a fine of not less than $25 or more than $200',
    },
    {
      section: 'ZZ Code § 1-101',
      code: '1-101(a)',
      offence: 'Not carrying a license, a second time',
      fine: '$500',
      min: 50000,
      max: 50000,
      appear: 'court-sets',
      quote: 'a fine of $500 for a second offense',
    },
  ],
}

function root(registry: Record<string, PenaltySource>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'penalties-'))
  mkdirSync(path.join(dir, 'resource/penalties'), { recursive: true })
  writeFileSync(path.join(dir, 'resource/penalties/SOURCES.json'), JSON.stringify(registry, null, 2))
  return dir
}

/** The court's site today: each URL's text, or an error where it could not be had. */
function reader(pages: Record<string, string | Error>): PageReader {
  return async (url) => {
    const page = pages[url]
    if (page instanceof Error) throw page
    if (page === undefined) throw new Error(`the stub has no page for ${url}`)
    return page
  }
}

const quiet = () => {}

// Criterion 9: every state has a truthful entry, so a state missing from
// the registry is a red test and not a state quietly answered without one.
describe('resource/penalties/SOURCES.json', () => {
  const registry = readRegistry(process.cwd())

  it('has an entry for every state and DC, each a kind, an adapter, a dated source and what was looked at', () => {
    expect(Object.keys(registry).sort()).toEqual(Object.keys(STATE_NAMES).sort())
    for (const [code, source] of Object.entries(registry)) {
      expect(['schedule', 'code', 'local'], code).toContain(source.kind)
      expect(['pdf-table', 'pdf-rows', 'statute-list', 'html-table', 'none'], code).toContain(source.format)
      if (source.format === 'pdf-rows') expect(source.layout?.start, code).toBeDefined()
      expect(source.url, code).toMatch(/^https?:\/\//)
      expect(source.retrieved, code).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(source.title.length, code).toBeGreaterThan(0)
      expect(source.looked.length, code).toBeGreaterThan(0)
    }
  })

  it('has a committed file for every state given rows, taken from the source it names', () => {
    for (const [code, source] of Object.entries(registry)) {
      const committed = readState(process.cwd(), code)
      if (source.format === 'none') {
        expect(committed, code).toBeNull()
        continue
      }
      expect(committed?.source.url, code).toBe(source.url)
      expect(committed!.rows.length, code).toBeGreaterThan(0)
      for (const row of committed!.rows) expect(row.state, `${code} ${row.id}`).toBe(code)
    }
  })
})

describe('the PDF-table adapter reads Maryland’s schedule', () => {
  const rows = pdfTable.rows(new Map([[MD_URL, DCCR090]]), MARYLAND)

  it('keys a row by the section as the laws table writes it, and its code by the schedule’s paragraph', () => {
    const display = rows.find((row) => row.code === '16-112(c)')
    expect(display).toMatchObject({
      section: 'Md. Code, Transp. § 16-112',
      offence: 'Failure of individual driving on hwy. to display lic. to uniformed police on demand',
      fine_text: '$50.00',
      fine_min_cents: 5000,
      fine_max_cents: 5000,
      points: 0,
      appear: 'payable',
    })
    expect(paragraphOf('a2iii')).toBe('(a)(2)(iii)')
    expect(penaltyId('MD', '21-801.1(b)(2)')).toBe('MD-P-21-801-1-b-2')
  })

  it('reads an offence that wraps onto a second line, and "MA" as must appear with the points still read', () => {
    expect(rows.find((row) => row.code === '16-101(a)(1)')).toMatchObject({
      section: 'Md. Code, Transp. § 16-101',
      offence: '(Driving, Attempting to drive) motor veh. on hwy. without req. license and authorization',
      fine_text: 'must appear',
      fine_min_cents: null,
      appear: 'must-appear',
      points: 5,
    })
    expect(rows.find((row) => row.code === '16-104.1(a)')?.fine_min_cents).toBe(29000)
  })

  it('reads no federal regulation as a section of the state’s code, and proposes a row whose fine was never printed only to be named', () => {
    expect(rows.some((row) => row.code.startsWith('393'))).toBe(false)
    expect(rows.find((row) => row.code === '21-206(a)')?.unread).toBe('no fine is printed within 30 lines of its start')
    expect(rows.filter((row) => row.unread === undefined && /^(16-|21-205)/.test(row.code)).map((row) => row.code)).toEqual([
      '16-101(a)(1)', '16-101(a)(2)', '16-101(b)', '16-104.1(a)', '16-104.1(b)', '16-104.1(c)', '16-104.1(d)',
      '16-105(b)(1)', '16-105(b)(2)', '16-105(c)', '16-111.1(f)', '16-112(b)', '16-112(c)',
      '21-205(a)', '21-205(b)', '21-205(c)', '21-205(d)', '21-205(e)',
    ])
  })

  // Read as one row, § 21-801.1 was "1 to 9 mph $80" alone, and a learner
  // asking about fifteen over was given the wrong band.
  it('reads each fine a section prints under one heading as a row of its own, the heading’s words with it', () => {
    const speeding = rows.filter((row) => row.code === '21-801.1')
    expect(speeding.map((row) => [row.offence, row.fine_text, row.points])).toEqual([
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: 1 to 9 mph', '$80.00', 1],
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: 10 to 19 mph', '$90.00', 2],
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: 20 to 29 mph', '$160.00', 2],
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: Exceeding posted maximum speed limit of (65, 70) mph by 10 to 19 mph', '$160.00', 2],
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: Exceeding posted maximum speed limit of (65, 70) mph by 20 to 29 mph', '$290.00', 5],
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: 30 to 39 mph', '$290.00', 6],
      ['Driving veh. on hwy. at speed exceeding limit Exceeding posted speed limit by: 40 mph and over', '$530.00', 6],
    ])
    expect(rows.filter((row) => row.code === '21-401').map((row) => [row.fine_text, row.points])).toEqual([['$110.00', 1], ['$750.00', 3]])
    expect(rows.find((row) => row.fine_text === '$750.00')?.offence).toBe(
      'Failure of veh. to yield intersection right-of-way to another veh. If violation contributes to an accident that results in (Death (Code 5), Serious Bodily Injury (Code 4))',
    )
  })

  it('reads a paragraph printed as a bare number, as § 21-1125 prints them', () => {
    expect(rows.filter((row) => row.section === 'Md. Code, Transp. § 21-1125').map((row) => row.code)).toEqual(['21-1125(1)', '21-1125(2)', '21-1125(3)'])
    expect(rows.find((row) => row.code === '21-1125(2)')?.offence).toBe('Driving low speed vehicle on (expressway, controlled access highway)')
  })

  it('quotes each row in words the schedule’s text contains, leaders and line breaks aside', () => {
    const text = normalized(DCCR090)
    for (const row of rows) expect(text, row.code).toContain(normalized(row.quote))
    expect(normalized(rows.find((row) => row.code === '16-112(c)')!.quote)).toBe(
      '16 112 c Failure of individual driving on hwy. to display lic. to uniformed police on demand $ 50.00 00',
    )
  })
})

describe('the statute-list and HTML-table adapters', () => {
  it('proposes the registry’s rows against the page each quotes', () => {
    const rows = statuteList.rows(new Map(), ZZ_LOCAL)
    expect(statuteList.urls(ZZ_LOCAL)).toEqual([STATUTE_URL])
    expect(rows[0]).toMatchObject({ section: 'ZZ Code § 1-101', fine_min_cents: 2500, fine_max_cents: 20000, appear: 'court-sets', url: STATUTE_URL })
  })

  it('reads a table’s rows by the columns the registry names, after the text that marks the table', () => {
    const page = `<html><body><table><tr><td>46.2-999</td><td>Not this table</td><td>$1.00</td></tr></table>
      <h2>Uniform Fine Schedule</h2><table>
      <tr><th>Code</th><th>Offense</th><th>Fine</th></tr>
      <tr><td>46.2-1078.1(A)</td><td>Handheld&nbsp;personal communications device</td><td>$125.00</td></tr>
      <tr><td>46.2-104</td><td>Fail to carry license</td><td>$20.00</td></tr>
      </table></body></html>`
    const source: PenaltySource = {
      ...MARYLAND,
      url: 'https://vv.example.test/fines',
      format: 'html-table',
      table: { after: 'Uniform Fine Schedule', columns: { code: 0, offence: 1, fine: 2 }, cite: 'Va. Code Ann. § {section}' },
    }
    const rows = htmlTable.rows(new Map([[source.url, page]]), source)
    expect(rows.map((row) => [row.section, row.code, row.offence, row.fine_min_cents])).toEqual([
      ['Va. Code Ann. § 46.2-1078.1', '46.2-1078.1(A)', 'Handheld personal communications device', 12500],
      ['Va. Code Ann. § 46.2-104', '46.2-104', 'Fail to carry license', 2000],
    ])
    for (const row of rows) expect(normalized(page)).toContain(row.quote)
  })
})

/**
 * The court schedules most states print one offence to a row (#798), each
 * read by `pdf-rows` with the pattern its registry entry gives -- so these
 * drive the committed entry itself on lines cut from the state's own
 * document as `pdftotext -layout` gives them: a pattern edited in the
 * registry that stops reading a schedule is red here, not a state whose rows
 * quietly thinned on the next fetch.
 */
describe('the pdf-rows adapter reads a schedule printed one offence to a row', () => {
  const registry = readRegistry(process.cwd())
  const fixture = (name: string) => readFileSync(path.join(__dirname, 'penalties', name), 'utf8')
  const read = (code: string, name: string, text = fixture(name)) => pdfRows.rows(new Map([[registry[code].url, text]]), registry[code])
  const FIXTURES: [string, string][] = [['CA', 'ca-ubps.txt'], ['CT', 'ct-chart-a.txt'], ['VT', 'vt-waiver.txt'], ['NH', 'nh-dsmv428.txt'], ['WY', 'wy-bond.txt'], ['ME', 'me-amounts.txt'], ['MT', 'mt-bond.txt']]

  it('reads California’s total bail as the fine, and the corrected-violation fee as its own row', () => {
    const rows = read('CA', 'ca-ubps.txt').filter((row) => row.section === 'Cal. Veh. Code § 12951')
    expect(rows.map((row) => [row.code, row.offence, row.fine_min_cents])).toEqual([
      ['12951 (a) A', 'No Valid License in Possession', 24700],
      ['12951 (a) B', 'No Valid License in Possession (corrected, with proof of correction)', 2500],
    ])
    expect(rows[0].fine_text).toBe('$247 total bail, a $35 base fine plus penalty assessments and fees')
  })

  // Connecticut prints a long offence over two lines and its figures on the
  // second: read as the first line alone, the row had no figure at all.
  it('reads a row whose figures wait for its offence to wrap, and names a row that prints no figure', () => {
    const rows = read('CT', 'ct-chart-a.txt')
    expect(rows.find((row) => row.code === '14-296aab1A')).toMatchObject({
      section: 'Conn. Gen. Stat. § 14-296aa',
      offence: 'Operation of a motor vehicle while holding or supporting a mobile electronic device with any part of such person’s body (1st offense)',
      fine_min_cents: 20000,
    })
    expect(rows.find((row) => row.code === '14-213')?.fine_text).toBe('$117.00 total due, a $50.00 fine plus fees and costs')
    expect(rows.find((row) => row.code === '14-218a')?.unread).toBe('no figure is printed within 3 lines of its start')
  })

  // Vermont centres a reference in its cell, so half an offence prints above
  // it: read as following lines only, "Use of Portable Electronic Device
  // Outside Work or School" went to the row before.
  it('gives a centred cell’s words above its reference to that row, not the one before', () => {
    const rows = read('VT', 'vt-waiver.txt')
    expect(rows.filter((row) => row.code === '1095b(c)(1)').map((row) => [row.offence, row.fine_min_cents, row.points])).toEqual([
      ['Use of Portable Electronic Device Outside Work or School Zone - 1st Violation', 16200, 2],
      ['Use of Portable Electronic Device Outside Work or School Zone - Subsequent Violation', 39200, 2],
    ])
    expect(rows.find((row) => row.code === '511' && row.fine_min_cents === 10500)?.offence).toBe('Failed to display rear registration plate or failed to display both registration plates')
    expect(rows.find((row) => row.code === '601')).toMatchObject({ section: '23 V.S.A. § 601', offence: 'Operating without a license', fine_min_cents: 16200 })
  })

  // Read as the fine, Vermont's "1-10 MPH over speed limit … 5.00" told a
  // learner fifteen over that the ticket was $6.
  it('names a row whose printed figure is a rate, never writing it as the fine', () => {
    // § 1003, the ordinary highway limit, prints its rate under codes that
    // are not § 1007's: the rows are told by their own words.
    const speeding = read('VT', 'vt-waiver.txt').filter((row) => row.section === '23 V.S.A. § 1007' || row.section === '23 V.S.A. § 1003')
    expect(speeding.filter((row) => row.section === '23 V.S.A. § 1003')).toHaveLength(3)
    for (const row of speeding) expect(row.unread, row.quote).toBe('the waiver printed is dollars for each mile an hour over the limit, not a fine')
  })

  it('puts a heading’s words before the run of rows under it, so three bands of one section read apart', () => {
    const bands = read('NH', 'nh-dsmv428.txt').filter((row) => row.offence.endsWith('Speeding 11-15 over limit'))
    expect(bands.map((row) => [row.offence, row.fine_min_cents])).toEqual([
      ['SPEED (55 mph or under limit) Speeding 11-15 over limit', 9300],
      ['SPEED (65 mph limit) Speeding 11-15 over limit', 18600],
      ['SPEED (70 mph limit) Speeding 11-15 over limit', 24800],
    ])
    expect(read('NH', 'nh-dsmv428.txt').find((row) => row.code === '263:2')).toMatchObject({ offence: 'Failure to Produce a License', fine_text: '$62.00 for a first offense' })
    expect(read('NH', 'nh-dsmv428.txt').find((row) => row.code === '265:66 (I-III)')?.offence).toBe('Special Speed Limitations')
  })

  // Wyoming prints a letter for most fines and the letter's amount once at
  // the top: a letter whose amount the page no longer prints is a figure
  // nobody published, and is named rather than written at last year's rate.
  it('reads a class letter as the amount the page prints for it, and names the row when the page no longer prints it', () => {
    expect(read('WY', 'wy-bond.txt').find((row) => row.code === '31-7-116')).toMatchObject({ section: 'Wyo. Stat. Ann. § 31-7-116', offence: 'Carry and display driver’s license on demand', fine_text: '$100.00 (class B)', fine_min_cents: 10000 })
    expect(read('WY', 'wy-bond.txt').find((row) => row.code === '31-5-237')?.fine_min_cents).toBe(10500)
    const raised = fixture('wy-bond.txt').replace('B = $100.00', 'B = $120.00')
    expect(read('WY', 'wy-bond.txt', raised).find((row) => row.code === '31-7-116')?.unread).toBe('class "B" has no amount the page prints')
  })

  it('names a row whose figure is a formula, and reads the rows beside it', () => {
    const rows = read('ME', 'me-amounts.txt')
    expect(rows.find((row) => row.code === '505 3')?.unread).toBe('no figure is printed within 4 lines of its start')
    expect(rows.find((row) => row.code === '1251 1C')).toMatchObject({ section: '29-A M.R.S. § 1251', fine_min_cents: 15200 })
  })

  // Montana prints "$0" for a first violation that draws a warning: told to
  // a learner as the fine, it is a ticket that does not exist.
  it('names a row whose figure is $0 rather than writing it as a fine', () => {
    const rows = read('MT', 'mt-bond.txt')
    expect(rows.find((row) => row.code === '61-4-143')?.unread).toBe('the figure printed is $0')
    expect(rows.find((row) => row.code === '61-5-102(1)')).toMatchObject({ section: 'Mont. Code Ann. § 61-5-102', offence: 'Driving Without a Valid Drivers License', fine_text: '$235 recommended bond' })
  })

  // Verifier, #798: the red-light row began with a quotation mark and its
  // subsections with a comma, so the base $475 dropped unsaid and the
  // construction-zone appendix's $617 stood in for it.
  it('reads California’s red-light row and leaves the construction-zone appendix out', () => {
    const red = read('CA', 'ca-ubps.txt').filter((row) => row.section === 'Cal. Veh. Code § 21453')
    expect(red.map((row) => [row.code, row.fine_min_cents])).toEqual([['21453 (a),(c)', 47500], ['21453 (b)', 24700], ['21453 (d)', 21000]])
    expect(red[0].offence).toBe('"Red" Signal–Vehicular Responsibilities')
  })

  // Verifier, #798: a code with a closing parenthesis never matched, so
  // Connecticut had no row for driving without a license, and a "See Appx"
  // row searching for its figure ran on through the unread line after it and
  // took "14-220(a) Slow Speed"'s $117.
  it('reads a Connecticut code with parentheses, so a "See Appx" row stops at the next row with no figure', () => {
    const rows = read('CT', 'ct-chart-a.txt')
    expect(rows.find((row) => row.code === '14-36(a)')).toMatchObject({ section: 'Conn. Gen. Stat. § 14-36', fine_min_cents: 15800 })
    expect(rows.find((row) => row.code === '14-219(c1*SZZ')?.unread).toBe('no figure is printed within 3 lines of its start')
    expect(rows.find((row) => row.code === '14-220(a)')).toMatchObject({ offence: 'Slow Speed', fine_min_cents: 11700 })
  })

  // Verifier, #798: Montana prints every line between two rows for the row
  // below; split in half, "Operating a Commercial MV Without Proper" went to
  // the second-offence row above it.
  it('gives every line between two Montana rows to the row below', () => {
    const rows = read('MT', 'mt-bond.txt').filter((row) => row.code === '61-5-102(2)(b)')
    expect(rows.map((row) => row.offence)).toEqual([
      'Operating a Commercial Motor Vehicle Without a Commercial Drivers License - 1st Offense',
      'Operating a Commercial Motor Vehicle Without a Commercial Drivers License - 2nd Offense',
      'Operating a Commercial MV Without Proper Endorsement For Vehicle Type, Passengers, Or Cargo Type',
    ])
  })

  it('quotes every row it reads in words its schedule contains, so the check finds them', () => {
    for (const [code, name] of FIXTURES) {
      const text = normalized(fixture(name))
      const rows = read(code, name).filter((row) => row.unread === undefined)
      expect(rows.length, code).toBeGreaterThan(0)
      for (const row of rows) expect(text, `${code} ${row.code}`).toContain(normalized(row.quote))
    }
  })
})
describe('a source a script cannot fetch the way it used to (#798)', () => {
  // Rhode Island's schedule prints "100.00": read only with a dollar sign,
  // the table gave no rows at all.
  it('reads a table figure printed without a dollar sign', () => {
    const page = `<html><body><table><tr><td>31-10-30</td><td>Driving on expired license</td><td align="right">100.00</td></tr></table></body></html>`
    const source: PenaltySource = { ...MARYLAND, url: 'https://ri.example.test/31-41.1-4', format: 'html-table', table: { columns: { code: 0, offence: 1, fine: 2 }, cite: 'R.I. Gen. Laws § {section}' } }
    expect(htmlTable.rows(new Map([[source.url, page]]), source)).toMatchObject([{ section: 'R.I. Gen. Laws § 31-10-30', fine_text: '$100.00', fine_min_cents: 10000 }])
  })

  // Verifier, #798: "Not less than $100.00 or more than $500.00" was written
  // as a $100 fine.
  it('names a table row whose fine cell prints more than one figure', () => {
    const page = `<html><body><table><tr><td>31-23-1(b)(2)</td><td>Defective equipment</td><td>Not less than $100.00 or more than $500.00</td></tr></table></body></html>`
    const source: PenaltySource = { ...MARYLAND, url: 'https://ri.example.test/31-41.1-4', format: 'html-table', table: { columns: { code: 0, offence: 1, fine: 2 }, cite: 'R.I. Gen. Laws § {section}' } }
    expect(htmlTable.rows(new Map([[source.url, page]]), source)[0].unread).toBe('the fine cell prints more than one figure: "Not less than $100.00 or more than $500.00"')
  })

  // New Hampshire's DMV answered 403 to a user agent alone and 200 to a
  // browser's header set: asked once, the schedule was "unreachable".
  it('asks again as a browser when a site refuses the fetch, and reads what it then serves', async () => {
    const asked: Record<string, string>[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      asked.push(init?.headers ?? {})
      return asked.length === 1 ? new Response('forbidden', { status: 403 }) : new Response('<html><body><p>263:2 Failure to Produce a License $62.00</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }) as typeof fetch
    try {
      expect(await liveReader()('https://dmv.example.test/dsmv428')).toContain('Failure to Produce a License')
    } finally {
      globalThis.fetch = real
    }
    expect(asked).toHaveLength(2)
    expect(asked[1]).toEqual(BROWSER_HEADERS)
  })

  // Missouri's court site answers every script with a bot challenge: the
  // schedule is saved by a person, and the fetch reads the saved copy,
  // checked and cited as the court's.
  it('reads a schedule a person saved in place of its URL, and says where to save it when the URL refuses', async () => {
    const saved: PenaltySource = { ...ZZ_LOCAL, file: 'resource/penalties/sources/ZZ/1-101.txt' }
    const dir = root({ ZZ: saved })
    const refused = reader({ [STATUTE_URL]: new Error(`${STATUTE_URL} answered 403`) })
    await expect(fetchState(dir, 'ZZ', { read: refused, today: '2026-10-11', log: quiet })).rejects.toThrow(
      `${STATUTE_URL} answered 403; save the schedule from a browser to resource/penalties/sources/ZZ/1-101.txt and run again`,
    )
    mkdirSync(path.join(dir, 'resource/penalties/sources/ZZ'), { recursive: true })
    writeFileSync(path.join(dir, saved.file!), STATUTE)
    await fetchState(dir, 'ZZ', { read: refused, today: '2026-10-11', log: quiet })
    expect(readState(dir, 'ZZ')!.rows).toMatchObject([{ code: '1-101(c)', source_url: STATUTE_URL }])
  })
})

describe('npm run penalties:fetch -- XX', () => {
  // Criterion 10: Maryland's § 16-112 row, from the fetched schedule, dated
  // the day it was fetched -- and a second run on another day is the same
  // file, said so, not a diff of dates.
  it('writes Maryland’s § 16-112 row from the schedule, and a second run changes nothing and says so', async () => {
    const dir = root({ MD: MARYLAND })
    const lines: string[] = []
    await fetchState(dir, 'MD', { read: reader({ [MD_URL]: DCCR090 }), today: '2026-10-10', log: (line) => lines.push(line) })
    const written = readState(dir, 'MD')!
    const row = written.rows.find((each) => each.id === 'MD-P-16-112-c')!
    expect(row).toMatchObject({ section: 'Md. Code, Transp. § 16-112', fine_text: '$50.00', appear: 'payable', points: 0, as_of: '2026-10-10' })
    expect(normalized(DCCR090)).toContain(row.quote)
    const file = path.join(dir, 'resource/penalties/MD.json')
    const before = readFileSync(file, 'utf8')
    const modified = statSync(file).mtimeMs

    const again: string[] = []
    const second = await fetchState(dir, 'MD', { read: reader({ [MD_URL]: DCCR090 }), today: '2026-11-01', log: (line) => again.push(line) })
    expect(second.written).toBe(false)
    expect(again.join('\n')).toContain('unchanged since 2026-10-10; nothing written')
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(statSync(file).mtimeMs).toBe(modified)
  })

  // Guard 7 and criterion 11: a row the page does not say is not written,
  // and the output names it with the words it claimed.
  it('does not write a row whose quote is not in the fetched text, and names it', async () => {
    const dir = root({ ZZ: ZZ_LOCAL })
    const lines: string[] = []
    await fetchState(dir, 'ZZ', { read: reader({ [STATUTE_URL]: STATUTE }), today: '2026-10-10', log: (line) => lines.push(line) })
    expect(readState(dir, 'ZZ')!.rows.map((row) => row.code)).toEqual(['1-101(c)'])
    expect(lines).toContain('NOT WRITTEN ZZ 1-101(a) (ZZ Code § 1-101): its quote is not in the fetched text: "a fine of $500 for a second offense"')
  })

  // A layout change the adapter reads as nothing must not empty the file a
  // push would then delete the state's rows from.
  it('refuses to write no rows over a state that has rows committed', async () => {
    const dir = root({ MD: MARYLAND })
    await fetchState(dir, 'MD', { read: reader({ [MD_URL]: DCCR090 }), today: '2026-10-10', log: quiet })
    const before = readFileSync(path.join(dir, 'resource/penalties/MD.json'), 'utf8')
    await expect(fetchState(dir, 'MD', { read: reader({ [MD_URL]: 'a page in a new layout' }), today: '2026-11-01', log: quiet })).rejects.toThrow(
      /the source gave no rows where \d+ are committed; nothing written/,
    )
    expect(readFileSync(path.join(dir, 'resource/penalties/MD.json'), 'utf8')).toBe(before)
  })

  // A registry typed in October quoting "$250" where the statute now says
  // "$200": one digit, and the row is not written rather than written wrong.
  it('does not write a range whose top figure the statute no longer says, though every other word matches', async () => {
    const dir = root({ ZZ: { ...ZZ_LOCAL, rows: [{ ...ZZ_LOCAL.rows![0], quote: 'punishable by a fine of not less than $25 or more than $250' }] } })
    const lines: string[] = []
    await fetchState(dir, 'ZZ', { read: reader({ [STATUTE_URL]: STATUTE }), today: '2026-10-10', log: (line) => lines.push(line) })
    expect(readState(dir, 'ZZ')!.rows).toEqual([])
    expect(lines.some((line) => line.startsWith('NOT WRITTEN ZZ 1-101(c)'))).toBe(true)
  })
})

/**
 * The penalties pass of `npm run statutes:refresh` (decision 11, criterion
 * 14, guard 10). Its silent failures are the statutes': a schedule that moved
 * and was not seen, and a court site that was down reported as a schedule
 * that stayed the same.
 */
describe('the monthly refresh of the fine schedules', () => {
  async function committed(): Promise<string> {
    const dir = root({ MD: MARYLAND })
    await fetchState(dir, 'MD', { read: reader({ [MD_URL]: DCCR090 }), today: '2026-10-10', log: quiet })
    return dir
  }

  it('reports the row whose fine moved, and only that row', async () => {
    const dir = await committed()
    const raised = DCCR090.replace('to have lic. with them ..........................                                                     $ 50.00 00', 'to have lic. with them ..........................                                                     $ 70.00 00')
    expect(raised).not.toBe(DCCR090)
    const report = await refreshPenalties(dir, ['MD'], { read: reader({ [MD_URL]: raised }), today: '2026-11-01', log: quiet })
    expect(report.states.MD.status).toBe('changed')
    expect(report.states.MD.changed.map((each) => each.id)).toEqual(['MD-P-16-112-b'])
    expect(report.states.MD.changed[0].before).toMatch(/^\$50\.00, 0 points, payable/)
    expect(report.states.MD.changed[0].after).toMatch(/^\$70\.00, 0 points, payable/)
    expect(JSON.parse(readFileSync(path.join(dir, 'resource/penalties/changes/2026-11-01.json'), 'utf8')).states.MD.status).toBe('changed')
    // Reports only: the committed rows are what they were.
    expect(readState(dir, 'MD')!.rows.find((row) => row.id === 'MD-P-16-112-b')?.fine_text).toBe('$50.00')
  })

  it('reports nothing changed when the schedule says what is committed', async () => {
    const dir = await committed()
    const report = await refreshPenalties(dir, ['MD'], { read: reader({ [MD_URL]: DCCR090 }), today: '2026-11-01', log: quiet })
    expect(report.states.MD).toMatchObject({ status: 'unchanged', changed: [], added: [], removed: [] })
    expect(report.states.MD.checked).toBeGreaterThan(0)
  })

  it('reports a source that could not be fetched as unreachable, never as unchanged', async () => {
    const dir = await committed()
    const report = await refreshPenalties(dir, ['MD'], { read: reader({ [MD_URL]: new Error('mdcourts.gov answered 503') }), today: '2026-11-01', log: quiet })
    expect(report.states.MD.status).toBe('unreachable')
    expect(report.states.MD.error).toBe('mdcourts.gov answered 503')
  })
})
