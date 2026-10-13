import { useStrings } from '../language'
import { METHOD_PAGE } from '../method-page'

/**
 * The row of small links at the foot of the screens where somebody is
 * choosing or reading (docs/plans/trust-signals.md).
 *
 * Every page it names already existed, three taps deep behind the menu, and a
 * visitor deciding whether to trust the site with a card number does not open
 * menus looking for reasons to; they glance at the bottom of the page, and the
 * bottom of every page here was two buttons.
 *
 * Anchors, never buttons. The hub's and the study screen's footers are held to
 * exactly two buttons -- the two paths -- and a sixth control dressed as a
 * button would be a third path on every screen this is drawn on. The hrefs are
 * the hashes the overlays already answer to, so a tap opens the page the way
 * the menu does and Back closes it.
 *
 * The year is read, never typed: a copyright line a year stale is the kind of
 * detail that makes a site look abandoned, which is the opposite of the job.
 */
export default function SiteFooter() {
  const t = useStrings()
  const links = [
    { id: 'terms', href: '#terms', label: t.footer.terms },
    { id: 'privacy', href: '#privacy', label: t.footer.privacy },
    { id: 'faq', href: '#faq', label: t.footer.faq },
    { id: 'ask', href: '#ask', label: t.footer.ask },
    { id: 'about', href: '#about', label: t.footer.about },
    // A page, not a `mailto:`: on a phone a mailto opens whatever mail app is
    // set up, or nothing (docs/plans/contact-page.md).
    { id: 'contact', href: '#contact', label: t.footer.contact },
    // A real page rather than a hash: it is prerendered from the corpus's
    // own counts and the committed measurements, and the app never mounts
    // over it (docs/plans/trusted-by-date.md, decision 8).
    { id: 'method', href: METHOD_PAGE, label: t.footer.method },
  ]
  return (
    <footer data-testid="site-footer" className="mt-auto pt-8 text-xs font-bold text-muted">
      {/* Wraps rather than scrolls: at 320px the five links are a row and a
          half, and a footer that pushed the page sideways would break the one
          screen it is meant to make look trustworthy. */}
      <nav aria-label={t.footer.nav} className="flex flex-wrap items-center gap-x-1.5">
        {links.map((link, index) => (
          <span key={link.id} className="flex items-center gap-x-1.5">
            {index > 0 && <span aria-hidden>·</span>}
            <a href={link.href} data-testid={`site-footer-${link.id}`} className="py-1 underline">
              {link.label}
            </a>
          </span>
        ))}
      </nav>
      <p data-testid="site-footer-line" className="mt-1">
        {t.footer.line(new Date().getFullYear())}
      </p>
    </footer>
  )
}
