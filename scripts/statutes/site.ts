/**
 * What a state's site module declares (docs/plans/vehicle-code.md, decision 5):
 * where its code is published, which titles of it are the vehicle code and why,
 * how to list their sections, and how to keep only the law out of a page.
 *
 * One module per state under `sites/`, so fifty states written one after
 * another by fifty different sessions never edit the same file.
 */

/** A title of the code, and why a licence-holder is or is not bound by it. */
export interface Title {
  /** A prefix of the file names of its sections ("gtr-21" for gtr-21-1003), so a title fetched as nothing is visible. */
  id: string
  name: string
  why: string
}

/** One section the fetch writes to `resource/statutes/sources/<CODE>/<file>.txt`. */
export interface Listing {
  /** The committed file's name, without `.txt`. */
  file: string
  url: string
  /** The section number as the state writes it: "21-1003", "316.1945". */
  section: string
  /** The whole reference without a subsection: "Md. Code, Transp. § 21-1003". */
  cite: string
  /** The section's catchline, where the site publishes one; '' where it does not. */
  heading: string
}

export interface Site {
  /** The legislature's site, or the publisher it designates. Every source URL starts with it. */
  official: string
  /** The code's name as a reader would say it: "Maryland Transportation Article". */
  name: string
  titles: Title[]
  enumerate(): Promise<Listing[]>
  /** The text in effect, deterministically, from what `listing.url` served. */
  extract(body: string, listing: Listing): string
  /**
   * What a section's body is, where a page fetch cannot say: California
   * publishes its codes as one 1.2 GB archive behind a site that answers every
   * page with a JavaScript challenge, and a section is a few kilobytes read
   * from that archive by byte range. Absent, the fetch reads `listing.url` as
   * a page, as every other state does. `extract` still decides what is law.
   */
  read?(listing: Listing): Promise<string>
}

/** Per state, beside the sources: what the fetch recorded for each file. */
export interface StateSources {
  official: string
  name: string
  titles: Title[]
  files: Record<string, SourceFile>
}

export interface SourceFile {
  url: string
  retrieved: string
  sha256: string
  section: string
  cite: string
  heading: string
  /** Where the text came out of a PDF: the PDF's own hash, so a reader can find the file it was read from. */
  pdfSha256?: string
  /** A section the code keeps only as "Repealed" or "Reserved": short on purpose, and never chunked. */
  repealed?: boolean
}

/**
 * Thrown by `extract` for a section the site lists but does not serve -- a
 * "File Not Found" in place of the law. The fetch reports it and commits
 * nothing for it, rather than hashing the error page as though it were law.
 */
export class Unavailable extends Error {}
