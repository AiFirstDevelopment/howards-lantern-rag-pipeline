import { describe, expect, it } from 'vitest'
import { decoded, fetchedPage, pdfText, sectionPage } from '../../scripts/statutes/fetch'

/**
 * A committed source is the legislature's text, byte for byte as it meant it.
 * Alaska's reader sends ISO-8859-1; read as UTF-8, its quotes, section signs
 * and dashes arrived as U+FFFD and had to be guessed back by context -- a
 * source that was not what the site served, under a hash that said it was.
 */
describe('reading a page in the charset it was sent in', () => {
  // “Driver” § 28.35 — in windows-1252, the bytes Alaska's reader sends.
  const LATIN = Uint8Array.from([0x93, 0x44, 0x72, 0x69, 0x76, 0x65, 0x72, 0x94, 0x20, 0xa7, 0x20, 0x32, 0x38, 0x2e, 0x33, 0x35, 0x20, 0x97])

  it('decodes by the charset the header names, so curly quotes and the section sign survive', () => {
    expect(decoded(LATIN, 'text/html; charset=ISO-8859-1')).toBe('“Driver” § 28.35 —')
  })

  it('falls back to the page’s own meta charset when the header names none', () => {
    const page = Uint8Array.from([...new TextEncoder().encode('<meta charset="windows-1252">'), ...LATIN])
    expect(decoded(page, 'text/html')).toBe('<meta charset="windows-1252">“Driver” § 28.35 —')
  })

  it('reads UTF-8 when nothing says otherwise, as every site before Alaska was read', () => {
    expect(decoded(new TextEncoder().encode('“Driver” § 21–1003'), null)).toBe('“Driver” § 21–1003')
  })
})

/**
 * Colorado publishes each title as one file of 6 to 10 MB and names a section
 * by its anchor in it. Read section by section without a cache, its 413
 * sections were 413 downloads of the same few files -- about 3 GB from the
 * legislature's drafting office. A page is read once per run, by its URL
 * without the fragment the server never sees.
 */
describe('reading a page once however many sections name it', () => {
  it('asks the network once for every section anchored in the same file', async () => {
    const asked: string[] = []
    const network = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return new Response('<html>the whole title</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }) as typeof fetch
    try {
      const first = fetchedPage('https://example.test/title-42.htm#42-4-1204')
      const second = fetchedPage('https://example.test/title-42.htm#42-4-1403')
      expect([first.cached, second.cached]).toEqual([false, true])
      expect((await second.page).body).toBe('<html>the whole title</html>')
      expect(asked).toEqual(['https://example.test/title-42.htm'])
    } finally {
      globalThis.fetch = network
    }
  })
})

/**
 * California answers every page with a JavaScript challenge and publishes its
 * codes as one 1.2 GB archive; a section is read from it by byte range in the
 * site's own module. Where a site supplies that reader, the fetch uses it and
 * asks the page for nothing.
 */
describe('a site that reads its own sections', () => {
  it('is read through its reader, not by fetching the section’s address', async () => {
    const asked: string[] = []
    const network = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return new Response('a challenge page')
    }) as typeof fetch
    try {
      const listing = { file: 'veh-22514', url: 'https://leginfo.example.test/22514', section: '22514', cite: 'Cal. Veh. Code § 22514', heading: '' }
      const { page, cached } = sectionPage({ read: async (each) => `the text of ${each.section}` }, listing)
      expect(cached).toBe(false)
      expect((await page).body).toBe('the text of 22514')
      expect(asked).toEqual([])
    } finally {
      globalThis.fetch = network
    }
  })
})

/**
 * Piped to `pdftotext -` on stdin, a section PDF hung forever about once in
 * 10-20 of Iowa's -- pdftotext waiting in fread for an EOF that never came.
 * The text is now read from a temp file, which is the path this holds.
 */
describe('reading a section PDF', () => {
  /** The smallest PDF that draws a line of text, with its cross-reference offsets computed. */
  function pdf(text: string): Uint8Array {
    const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let body = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((object, index) => {
      offsets.push(body.length)
      body += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = body.length
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return new TextEncoder().encode(body)
  }

  it('turns a section PDF into its text, from a file and not a pipe', () => {
    expect(pdfText(pdf('No person shall park within five feet of a fire hydrant.'))).toContain(
      'No person shall park within five feet of a fire hydrant.',
    )
  })
})
