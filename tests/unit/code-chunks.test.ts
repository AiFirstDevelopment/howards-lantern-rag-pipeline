import { describe, expect, it } from 'vitest'
import { CHUNK_CHARS, bodyLines, chunkSection } from '../../worker/src/code-chunks'

/**
 * The chunker on a section shaped like Maryland's: a heading-only first line,
 * lettered subsections, an "(i)" that is a roman numeral under "(h)(1)", and
 * one subsection long enough to be cut again. What it must never do is lose a
 * word: a subsection it swallowed is a rule the box can no longer reach, and
 * nothing on screen would say so.
 */
const LONG = Array.from({ length: 14 }, (_, n) => `(${n + 1}) A person may not do thing number ${n + 1} on a highway in this State at any time.`)
const SECTION = [
  '§21–1003.',
  '(a) The provisions of this section apply except as necessary to avoid conflict with other traffic.',
  '(b) A person may not stop, stand, or park a vehicle in front of a public driveway.',
  '(c) A person may not stop, stand, or park a vehicle on a sidewalk.',
  '(d) A person may not stop, stand, or park a vehicle in an intersection.',
  '(e) A person may not stop, stand, or park a vehicle on a crosswalk.',
  '(f) Subsection f.',
  '(g) Subsection g.',
  '(h) (1) A person may not park within 20 feet of a thing, unless:',
  '(i) The thing is marked; or',
  '(ii) The thing is not marked.',
  '(2) This paragraph applies at night.',
  '(i) A person may not stand or park a vehicle within 15 feet of a fire hydrant.',
  '(j) A long subsection follows.',
  ...LONG,
  '(k) The last subsection.',
].join('\n') + '\n'

const chunks = chunkSection({
  code: 'MD',
  file: 'gtr-21-1003',
  section: '21-1003',
  cite: 'Md. Code, Transp. § 21-1003',
  heading: 'Stopping, standing, and parking',
  text: SECTION,
})
const squeezed = (text: string) => text.replace(/\s+/g, '')

describe('cutting a section of the code into subsections', () => {
  it('loses no word of the section: the chunks, in order, are its text', () => {
    expect(squeezed(chunks.map((chunk) => chunk.law).join(''))).toBe(squeezed(bodyLines({ text: SECTION, section: '21-1003' }).join('')))
  })

  it('drops the heading-only first line, whose section number would otherwise ground "21 feet"', () => {
    expect(chunks.some((chunk) => chunk.law.includes('§21'))).toBe(false)
  })

  it('splits at the lettered subsections and reads an "(i)" followed by "(ii)" as a roman numeral, not the ninth', () => {
    expect(chunks.find((chunk) => chunk.id === 'MD-C-21-1003-h')?.law).toContain('(ii) The thing is not marked.')
    const hydrant = chunks.find((chunk) => chunk.id === 'MD-C-21-1003-i')
    expect(hydrant?.law).toBe('(i) A person may not stand or park a vehicle within 15 feet of a fire hydrant.')
    expect(hydrant?.citation).toBe(
      "Md. Code, Transp. § 21-1003(i) — '(i) A person may not stand or park a vehicle within 15 feet of a fire hydrant.'",
    )
    expect(hydrant?.concept).toBe('Stopping, standing, and parking')
  })

  it(`cuts a subsection over ${CHUNK_CHARS} characters at every paragraph, and cites each piece by its own`, () => {
    const pieces = chunks.filter((chunk) => chunk.id.startsWith('MD-C-21-1003-j'))
    expect(pieces.length).toBe(15)
    for (const piece of pieces.slice(1)) {
      const paragraph = /^\((\d+)\)/.exec(piece.law)![1]
      expect(piece.citation.split(' — ')[0]).toBe(`Md. Code, Transp. § 21-1003(j)(${paragraph})`)
    }
  })

  // Arizona numbers "A.", "B.", then "1.", "2.", and brackets only its third
  // level. Read as brackets alone, § 28-873(A)(5) -- the hydrant -- was cited
  // as § 28-873(b).
  it('reads Arizona’s "A." and "1." as its subsections and paragraphs, and cites the hydrant within its paragraphs', () => {
    const items = Array.from({ length: 16 }, (_, n) => `${n + 1}. Within ${n === 4 ? 'fifteen feet of a fire hydrant' : `a place numbered ${n + 1} that a person may not stop in`}, a rule long enough to matter.`)
    const arizona = chunkSection({
      code: 'AZ',
      file: 'az-28-3-873',
      section: '28-873',
      cite: 'A.R.S. § 28-873',
      heading: 'Stopping, standing or parking prohibitions',
      text: ['28-873. Stopping, standing or parking prohibitions', 'A. A person shall not stop, stand or park a vehicle in any of the following places:', ...items, '(a) For emergency reasons.', 'B. A local authority may allow a transit vehicle to stop.'].join('\n'),
    })
    expect(arizona.filter((chunk) => /^AZ-C-28-873-[A-Z]$/.test(chunk.id)).map((chunk) => chunk.id)).toEqual(['AZ-C-28-873-A', 'AZ-C-28-873-B'])
    const hydrant = arizona.find((chunk) => chunk.law.includes('fifteen feet of a fire hydrant'))!
    const [, from, to] = /§ 28-873\(A\)(?:\((\d+)\)(?:–\((\d+)\))?)? — /.exec(hydrant.citation) ?? []
    if (from !== undefined) expect(Number(from) <= 5 && 5 <= Number(to ?? from)).toBe(true)
    expect(arizona.some((chunk) => /\(b\)|\(a\) —/.test(chunk.citation.split(' — ')[0]))).toBe(false)
  })

  // Maine inserts "1-A." between "1." and "2.". Read as no label, the rule
  // about bicyclists in § 2060(1-A) rode inside (1) and was cited as (1).
  it('reads Maine’s inserted "1-A." as its own subsection, cited by its own label, without skipping the "2." after it', () => {
    const maine = chunkSection({
      code: 'ME',
      file: 'c19-2060',
      section: '29-A-2060',
      cite: '29-A M.R.S. § 2060',
      heading: 'Turning at intersections',
      text: [
        'An operator intending to turn at an intersection may do so as follows.',
        '1. Right turns. The operator shall turn as close as practicable to the right-hand curb.',
        '1-A. Right turns near bicyclists. A person may not make a right turn unless it can be made with reasonable safety.',
        '2. Left turns on 2-way roadways. The operator shall approach in the lane nearest the center line.',
        'A. An operator may turn left from the lane farthest left.',
        'A-1. An operator may turn left from a designated lane.',
      ].join('\n'),
    })
    const bicyclists = maine.find((chunk) => chunk.law.startsWith('1-A.'))!
    expect(bicyclists.id).toBe('ME-C-29-A-2060-1-A')
    expect(bicyclists.citation.split(' — ')[0]).toBe('29-A M.R.S. § 2060(1-A)')
    expect(maine.find((chunk) => chunk.law.startsWith('1. Right turns.'))!.law).not.toContain('bicyclists')
    expect(maine.find((chunk) => chunk.id === 'ME-C-29-A-2060-2')?.law).toContain('A-1. An operator may turn left from a designated lane.')
  })

  // North Carolina inserts "(a1)" after (a) and "(6a)" after (6), with no mark
  // between letter and number. Read as no label, § 20-11(a1) was cited as (a).
  it('reads North Carolina’s inserted "(a1)" and "(6a)" as labels of their own, without skipping the label after', () => {
    const carolina = chunkSection({
      code: 'NC',
      file: 'art2-20-11',
      section: '20-11',
      cite: 'N.C. Gen. Stat. § 20-11',
      heading: 'Issuance of limited learner permit and provisional license to person who is less than 18 years old',
      text: [
        '(a) Purpose. This section establishes a three-stage system for drivers under 18.',
        '(a1) Applicability. This section applies to a person who has not been licensed in another state.',
        '(b) Level 1. A person who is at least 15 years old may obtain a limited learner permit.',
        '(c) Restrictions. A permit holder may drive only with a supervising driver:',
        '(6) Between 5:00 A.M. and 9:00 P.M. for the first six months.',
        '(6a) After the first six months, at any time.',
        '(7) The supervising driver must be seated beside the permit holder.',
      ].join('\n'),
    })
    expect(carolina.map((chunk) => chunk.id)).toEqual(['NC-C-20-11-a', 'NC-C-20-11-a1', 'NC-C-20-11-b', 'NC-C-20-11-c'])
    expect(carolina[1].citation.split(' — ')[0]).toBe('N.C. Gen. Stat. § 20-11(a1)')
    expect(carolina[3].law).toContain('(6a) After the first six months, at any time. (7) The supervising driver')
  })

  // § 20-18's whole body is one line citing "G.S. 20-181"; matched as a
  // substring, the section's own number made that line its heading, and the
  // section was left with no law.
  it('keeps a line that cites a longer number than the section’s own, and never drops a section’s only line', () => {
    const penalty = chunkSection({ code: 'NC', file: 'art2-20-18', section: '20-18', cite: 'N.C. Gen. Stat. § 20-18', heading: 'Penalty', text: 'Any person who violates G.S. 20-181 shall be guilty of a Class 2 misdemeanor.' })
    expect(penalty.map((chunk) => chunk.law)).toEqual(['Any person who violates G.S. 20-181 shall be guilty of a Class 2 misdemeanor.'])
    // California's § 22100 opens on "Section 22100.5", and lost that sentence the same way.
    const turns = chunkSection({ code: 'CA', file: 'veh-11-22100', section: '22100', cite: 'Cal. Veh. Code § 22100', heading: '', text: ['Except as provided in Section 22100.5 or 22101, the driver of any vehicle intending to turn upon a highway shall do so as follows:', '(a) Right Turns. As close as practicable to the right-hand curb.'].join('\n') })
    expect(turns[0].law).toMatch(/^Except as provided in Section 22100\.5/)
    const alone = chunkSection({ code: 'MT', file: '61-8-385', section: '61-8-385', cite: 'Mont. Code Ann. § 61-8-385', heading: 'Short title', text: 'Sections 61-8-385 through 61-8-388 may be cited as the Safe Streets Act.' })
    expect(alone.length).toBe(1)
  })

  // New Hampshire numbers its paragraphs in roman. Read as the letter I, then
  // as no label, everything after I was filed under it: RSA 265:69, II(b) --
  // the hydrant -- was cited as (I)(m).
  it('reads New Hampshire’s "I.", "II.", "II-a." and "V." as roman paragraphs, each cited by its own numeral', () => {
    const hampshire = chunkSection({
      code: 'NH',
      file: '265-69',
      section: '265:69',
      cite: 'N.H. Rev. Stat. Ann. § 265:69',
      heading: 'Stopping, standing, or parking prohibited in specified places',
      text: [
        'No person shall:',
        'I. Stop, stand, or park a vehicle: (a) On a sidewalk; (b) Within an intersection.',
        'II. Stand or park a vehicle: (a) In front of a driveway; (b) Within 15 feet of a fire hydrant.',
        'II-a. Park a vehicle in a space reserved for a person with a walking disability.',
        'III. Park a vehicle within 50 feet of a railroad crossing.',
        'IV. Park on a bridge.',
        'V. Park in a fire lane.',
      ].join('\n'),
    })
    expect(hampshire.map((chunk) => chunk.citation.split(' — ')[0].replace('N.H. Rev. Stat. Ann. § 265:69', ''))).toEqual(['', '(I)', '(II)', '(II-a)', '(III)', '(IV)', '(V)'])
    expect(hampshire.find((chunk) => chunk.law.includes('fire hydrant'))!.citation.split(' — ')[0]).toBe('N.H. Rev. Stat. Ann. § 265:69(II)')
  })

  // New Jersey letters its subsections "a.", "b.". Read as no label, the
  // hydrant rule, § 39:4-138(i), rode in another paragraph and was cited by it.
  it('reads New Jersey’s "a.", "b." as the subsections of a section that opens on one, its "(1)" kept beneath', () => {
    const jersey = chunkSection({
      code: 'NJ',
      file: '39-4-138',
      section: '39:4-138',
      cite: 'N.J. Stat. Ann. § 39:4-138',
      heading: '',
      text: ['No operator of a vehicle shall stand or park the vehicle in any of the following places:', ...'abcdefgh'.split('').map((letter) => `${letter}. Place ${letter};`), 'i. Within 10 feet of a fire hydrant;', 'j. (1) Within 50 feet of a stop sign; or', '(2) Within 50 feet of a railroad crossing.'].join('\n'),
    })
    expect(jersey.find((chunk) => chunk.law.includes('fire hydrant'))!.citation.split(' — ')[0]).toBe('N.J. Stat. Ann. § 39:4-138(i)')
    expect(jersey.find((chunk) => chunk.id === 'NJ-C-39-4-138-j')?.law).toBe('j. (1) Within 50 feet of a stop sign; or (2) Within 50 feet of a railroad crossing.')
  })

  // North Dakota, North Carolina and Missouri write "a." beneath a numbered
  // paragraph. Read there too, the change re-cut ten states' chunks and cited
  // Florida's § 316.0083(1)(a) as (1)(b); it is read only where a section opens on it.
  it('leaves an "a." beneath a numbered paragraph as that paragraph’s text, cut and cited as before', () => {
    const long = (what: string) => `${what} ${'that is defined at length for the purposes of this title '.repeat(9).trim()}.`
    const dakota = chunkSection({ code: 'ND', file: 'ndcc-39-01-01', section: '39-01-01', cite: 'N.D.C.C. § 39-01-01', heading: '', text: ['1. "Bicycle" means a device propelled by human power.', '2. "Motor vehicle" means:', long('a. A vehicle'), long('b. A trailer'), '3. "Way" means a public road.'].join('\n') })
    expect(dakota.map((chunk) => chunk.citation.split(' — ')[0])).toEqual(['N.D.C.C. § 39-01-01(1)', 'N.D.C.C. § 39-01-01(2)', 'N.D.C.C. § 39-01-01(2)', 'N.D.C.C. § 39-01-01(3)'])
  })

  // New York inserts "2-a." after "2.", in lower case. Read as no label,
  // § 510(4-a) rode inside (4) and was cited as (4).
  it('reads New York’s inserted "4-a." as its own subdivision, without skipping the "5." after it', () => {
    const york = chunkSection({ code: 'NY', file: 'vat-t5-510', section: '510', cite: 'N.Y. Veh. & Traf. Law § 510', heading: '', text: ['4. Suspension for failure to answer.', '4-a. Suspension for failure to pay a fine.', '5. Revocation for a third offence.'].join('\n') })
    expect(york.map((chunk) => chunk.citation.split(' — ')[0].replace('N.Y. Veh. & Traf. Law § 510', ''))).toEqual(['(4)', '(4-a)', '(5)'])
  })

  // Ohio's § 4511.01 runs its definitions past (ZZZ) to (MMMM). Capped at three
  // capitals, the thirteen after (ZZZ) were filed inside it and cited as (ZZZ).
  it('reads Ohio’s "(AAAA)" after "(ZZZ)" as the next definition', () => {
    const ohio = chunkSection({ code: 'OH', file: '4511-4511.01', section: '4511.01', cite: 'Ohio Rev. Code § 4511.01', heading: '', text: ['(ZZZ) "Bicycle lane" means a lane reserved for bicycles.', '(AAAA) "Bicycle box" means an area at a signal for bicycles.', '(BBBB) "Bikeway" means a way for bicycles.'].join('\n') })
    expect(ohio.map((chunk) => chunk.citation.split(' — ')[0])).toEqual(['Ohio Rev. Code § 4511.01(ZZZ)', 'Ohio Rev. Code § 4511.01(AAAA)', 'Ohio Rev. Code § 4511.01(BBBB)'])
  })

  // Pennsylvania inserts "(2.1)" after "(2)" a level down. Cited as (2), the
  // junior licence's passenger limit, § 1503(c)(2.1), read as the rule before it.
  it('cites a piece opening on an inserted "(2.1)" by its own label, not the paragraph before', () => {
    const long = (what: string) => `${what} ${'a provision long enough to need its own piece of the subsection '.repeat(5).trim()}.`
    const penn = chunkSection({ code: 'PA', file: '75c15-1503', section: '1503', cite: '75 Pa.C.S. § 1503', heading: '', text: ['(c) Junior driver\'s license.--', long('(1) A junior driver may not drive between 11 p.m. and 5 a.m.'), long('(2) A junior driver must hold the license six months.'), long('(2.1) A junior driver may not carry more than one passenger under 18.'), long('(3) A junior driver must carry the license.')].join('\n') })
    expect(penn.find((chunk) => chunk.law.startsWith('(2.1)'))!.citation.split(' — ')[0]).toBe('75 Pa.C.S. § 1503(c)(2.1)')
    expect(penn.find((chunk) => chunk.law.startsWith('(3)'))!.citation.split(' — ')[0]).toBe('75 Pa.C.S. § 1503(c)(3)')
  })

  // South Dakota inserts "(9A)" after "(9)", in capitals. Read as no label,
  // "Electric bicycle" rode inside (9) and was cited as § 32-14-1(9).
  it('reads South Dakota’s capital "(9A)" as its own definition, without skipping the "(10)" after it', () => {
    const dakota = chunkSection({ code: 'SD', file: 'sdcl-32-14-1', section: '32-14-1', cite: 'SDCL § 32-14-1', heading: '', text: ['(9) "Bicycle," a device propelled by human power.', '(9A) "Electric bicycle," a bicycle with a motor of less than 750 watts.', '(10) "Bus," a motor vehicle carrying more than ten passengers.'].join('\n') })
    expect(dakota.map((chunk) => chunk.citation.split(' — ')[0])).toEqual(['SDCL § 32-14-1(9)', 'SDCL § 32-14-1(9A)', 'SDCL § 32-14-1(10)'])
  })

  // Texas inserts "(13-a)" after "(13)". Read as no label, its police-vehicle
  // definition rode inside the pole-trailer one and was cited § 541.201(13).
  it('reads Texas’s "(13-a)" as its own definition, without skipping the "(14)" after it', () => {
    const texas = chunkSection({ code: 'TX', file: 'tn541-541.201', section: '541.201', cite: 'Tex. Transp. Code § 541.201', heading: '', text: ['(13) "Pole trailer" means a trailer attached by a reach or pole.', '(13-a) "Police vehicle" means a vehicle used by a peace officer.', '(14) "Recreational vehicle" means a motor home or travel trailer.'].join('\n') })
    expect(texas.map((chunk) => chunk.citation.split(' — ')[0])).toEqual(['Tex. Transp. Code § 541.201(13)', 'Tex. Transp. Code § 541.201(13-a)', 'Tex. Transp. Code § 541.201(14)'])
  })

  // A repealed number is left out of the text: Wisconsin's § 346.89 runs (1),
  // (3), (4); Maine's § 101 runs 38, 40. Holding out for the missing number
  // filed every later subsection under the one before it -- the texting ban,
  // § 346.89(3)(a), was cited as (1).
  it('takes a subsection after a repealed number as its own, the run going on from it', () => {
    const wisconsin = chunkSection({ code: 'WI', file: 'ch346-346.89', section: '346.89', cite: 'Wis. Stat. § 346.89', heading: '', text: ['(1) No person while driving may be occupied with an activity that interferes.', '(3) (a) No person may drive while composing or sending an electronic text message.', '(b) This subsection does not apply to an emergency vehicle.', '(4) No person who holds a probationary license may use a cellular telephone.'].join('\n') })
    expect(wisconsin.map((chunk) => chunk.citation.split(' — ')[0])).toEqual(['Wis. Stat. § 346.89(1)', 'Wis. Stat. § 346.89(3)', 'Wis. Stat. § 346.89(4)'])
  })

  // The jump is refused onto what reads as a roman numeral: Maryland's "(ii)"
  // under a lettered subsection, taken for a jump, re-cut 770 of its chunks.
  it('never takes a roman "(ii)" under a subsection for a jump in the letters', () => {
    const maryland = chunkSection({ code: 'MD', file: 'gtr-21-1003', section: '21-1003', cite: 'Md. Code, Transp. § 21-1003', heading: '', text: ['(a) A person may not park on a sidewalk.', '(b) (1) A person who violates this section is subject to:', '(i) For a first offense, a fine of $50;', '(ii) For a second offense, a fine of $100; and', '(iii) For a third offense, a fine of $500.', '(c) The last subsection.'].join('\n') })
    expect(maryland.map((chunk) => chunk.citation.split(' — ')[0])).toEqual(['Md. Code, Transp. § 21-1003(a)', 'Md. Code, Transp. § 21-1003(b)', 'Md. Code, Transp. § 21-1003(c)'])
  })

  // Inside a long subsection the same holds: Pennsylvania's § 102(1) lists
  // "(i)", "(ii)" with no "(a)" before them, and a piece opening on "(ii)" was
  // cited (1)(i) when the "(i)" was taken for a jump to the ninth letter.
  it('never cites a piece of a long subsection by a roman "(i)" taken for a letter', () => {
    const long = (what: string) => `${what} ${'a definition long enough to need a piece of its own in this title '.repeat(6).trim()}.`
    const penn = chunkSection({ code: 'PA', file: '75c1-102', section: '102', cite: '75 Pa.C.S. § 102', heading: '', text: ['(1) "Vehicle." Every device in, upon or by which any person or property is transported, except:', long('(i) A device used exclusively upon rails.'), long('(ii) A device moved by human power.')].join('\n') })
    expect(penn.find((chunk) => chunk.law.startsWith('(ii)'))!.citation.split(' — ')[0]).not.toBe('75 Pa.C.S. § 102(1)(i)')
  })

  // Wisconsin inserts "(am)" after (a), "(15ph)" after (15p), and prints
  // paragraph l as "(L)". Read as no label, 346.57(4)(gm), the 70 mph freeway
  // limit, was cited (4)(g); 340.01(15ps), "Electric scooter", (15p)(c).
  it('reads Wisconsin’s "(am)", "(15ph)" and "(L)" as labels of their own', () => {
    const cite = (text: string) => chunkSection({ code: 'WI', file: 'ch340-340.01', section: '340.01', cite: 'Wis. Stat. § 340.01', heading: '', text }).map((chunk) => chunk.citation.split(' — ')[0].replace('Wis. Stat. § 340.01', ''))
    expect(cite(['(a) Rule a.', '(am) Rule am.', '(b) Rule b.'].join('\n'))).toEqual(['(a)', '(am)', '(b)'])
    expect(cite(['(15p) "Electric bicycle" means a bicycle with a motor.', '(15ph) "Electric personal assistive mobility device" means a device.', '(15pm) "Electric scooter" means a device with a deck.', '(16) "Explosives" means any chemical compound.'].join('\n'))).toEqual(['(15p)', '(15ph)', '(15pm)', '(16)'])
    expect(cite(['(k) Rule k.', '(L) Rule l.', '(m) Rule m.'].join('\n'))).toEqual(['(k)', '(L)', '(m)'])
  })

  // Wyoming nests (a), (i), (A). Read as letters, the roman paragraphs were
  // skipped and its hydrant rule, § 31-5-504(a)(ii)(B), was cited (a)(M).
  it('cites a piece of a lettered subsection by its roman paragraph, "(a)(ii)", not a capital letter', () => {
    const long = (what: string) => `${what} ${'a place where no person shall stop, stand or park a vehicle '.repeat(4).trim()}.`
    const wyoming = chunkSection({ code: 'WY', file: '31-5-504', section: '31-5-504', cite: 'Wyo. Stat. Ann. § 31-5-504', heading: '', text: ['(a) No person shall:', '(i) Stop, stand or park a vehicle:', long('(A) On a sidewalk;'), long('(B) Within an intersection;'), '(ii) Stand or park a vehicle:', long('(A) In front of a public driveway;'), long('(B) Within fifteen (15) feet of a fire hydrant;')].join('\n') })
    expect(wyoming.find((chunk) => chunk.law.includes('fire hydrant'))!.citation.split(' — ')[0]).toBe('Wyo. Stat. Ann. § 31-5-504(a)(ii)')
  })

  // A compact is one section holding Articles I to IX, each restarting at
  // (1). Read as one run, Utah's Driver License Compact cited Article III(2)(a)
  // as § 53-3-604(3)(a); Delaware prints "ARTICLE IIIReports", no space.
  it('cites each article of a compact by its own article and paragraph', () => {
    const compact = chunkSection({ code: 'UT', file: '53-3-p6-53-3-604', section: '53-3-604', cite: 'Utah Code § 53-3-604', heading: '', text: ['ARTICLE I Findings', '(1) The party states find that safety depends on drivers.', 'ARTICLE II Definitions', '(1) "State" means a state of the United States.', '(2) "Home state" means the state that issued the license.', 'ARTICLE IIIReports of Conviction', '(1) The licensing authority shall report each conviction.', '(2) The report shall identify the person convicted.'].join('\n') })
    const cited = (start: string) => compact.find((chunk) => chunk.law.startsWith(start))!.citation.split(' — ')[0]
    expect(cited('(2) The report')).toBe('Utah Code § 53-3-604, Art. III(2)')
    expect(cited('(2) "Home state"')).toBe('Utah Code § 53-3-604, Art. II(2)')
    expect(new Set(compact.map((chunk) => chunk.id)).size).toBe(compact.length)
  })

  it('still reads "I." as the ninth letter after "H."', () => {
    const lettered = chunkSection({ code: 'AZ', file: 'az-28-1', section: '28-1', cite: 'A.R.S. § 28-1', heading: '', text: 'ABCDEFGHI'.split('').map((letter) => `${letter}. Rule ${letter} of the section.`).join('\n') })
    expect(lettered.map((chunk) => chunk.citation.split(' — ')[0])).toEqual('ABCDEFGHI'.split('').map((letter) => `A.R.S. § 28-1(${letter})`))
  })

  it('reads "(i) (1)" after "(h)" as the ninth subsection, even when a roman "(i)" follows under it', () => {
    const littering = chunkSection({
      code: 'MD',
      file: 'gcr-10-110',
      section: '10-110',
      cite: 'Md. Code, Crim. Law § 10-110',
      heading: '',
      text: [
        '(h) A unit that supervises State property shall:',
        '(1) establish receptacles;',
        '(i) (1) Fines collected for violations of this section shall be disbursed:',
        '(i) to the county; or',
        '(ii) to the unit.',
        '(j) (1) The legislative body of a municipal corporation may prohibit littering.',
      ].join('\n'),
    })
    expect(littering.map((chunk) => chunk.id)).toEqual(['MD-C-10-110-h', 'MD-C-10-110-i', 'MD-C-10-110-j'])
  })

  // Arizona's "5. Within fifteen feet of a fire hydrant." sat in an
  // 836-character piece with seven other places, and neither word nor meaning
  // search reached it for the hydrant question. Its own piece, cited (A)(5),
  // ranks second; the "(a)" and "(b)" under paragraph 3 stay with paragraph 3.
  it('gives each paragraph of an oversized subsection its own piece, deeper labels staying with theirs', () => {
    const lead = `A. A person shall not stop a vehicle ${'in any of these places '.repeat(34).trim()}:`
    const arizona = chunkSection({
      code: 'AZ',
      file: 'az-28-3-873',
      section: '28-873',
      cite: 'A.R.S. § 28-873',
      heading: '',
      text: [lead, '1. On a sidewalk.', '2. In a driveway.', '3. Unless:', '(a) The driver stays with the vehicle.', '(b) The stop is momentary.', '4. Within an intersection.', '5. Within fifteen feet of a fire hydrant.'].join('\n'),
    })
    const hydrant = arizona.find((chunk) => chunk.law.includes('fire hydrant'))!
    expect(hydrant.law).toBe('5. Within fifteen feet of a fire hydrant.')
    expect(hydrant.citation.split(' — ')[0]).toBe('A.R.S. § 28-873(A)(5)')
    const three = arizona.find((chunk) => chunk.law.startsWith('3. Unless:'))!
    expect(three.law).toBe('3. Unless: (a) The driver stays with the vehicle. (b) The stop is momentary.')
    expect(three.citation.split(' — ')[0]).toBe('A.R.S. § 28-873(A)(3)')
  })

  // The District's § 50-2206.55 has a subsection (a) long enough to cut, whose
  // paragraph (1) is filed a-1, and a subsection "(a-1)" with its own (2): the
  // duplicate a-1 was renamed a-1-2, the id of "(a-1)(2)".
  it('never renames a duplicate onto an id another chunk already has', () => {
    const long = Array.from({ length: 12 }, (_, n) => `(${n + 1}) A rule long enough to make the subsection split, number ${n + 1}, applies here.`)
    const dc = chunkSection({
      code: 'DC',
      file: 'dc-50-2206.55',
      section: '50-2206.55',
      cite: 'D.C. Code § 50-2206.55',
      heading: '',
      text: ['(a) The lead of a subsection that is far too long to stay whole once its paragraphs are added.', ...long, '(a-1)(1) A first rule of the inserted subsection that is itself long enough to be split from the next. '.repeat(8).trim(), '(2) A second rule of the inserted subsection that is also long enough to stand alone as a piece. '.repeat(8).trim()].join('\n'),
    })
    const ids = dc.map((chunk) => chunk.id)
    expect(ids.length - new Set(ids).size, ids.join(' ')).toBe(0)
  })

  it('gives every chunk its own id', () => {
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length)
  })

  it('keeps a section with no labels as paragraphs, cited by the section alone', () => {
    const plain = chunkSection({ code: 'MD', file: 'x', section: '11-101', cite: 'Md. Code, Transp. § 11-101', heading: '', text: '§11–101.\nIn this title the following words have the meanings indicated.\n' })
    expect(plain.map((chunk) => chunk.id)).toEqual(['MD-C-11-101-p1'])
    expect(plain[0].citation).toBe("Md. Code, Transp. § 11-101 — 'In this title the following words have the meanings indicated.'")
  })
})
