/**
 * The messages this system sends, and the one binding that sends them.
 *
 * This app had never sent an email before the partner network, and the choice
 * of how was made for one reason above the others: a `send_email` binding on
 * the Worker means no API key in the secret store, no vendor account, and
 * SPF/DKIM/DMARC as records in the dashboard the domain is already served from.
 *
 * Injected rather than reached for, the way `newCode` is in `recordPurchase`.
 * That is what lets the whole login flow be driven by the suite without a
 * mailbox: the tests pass a sender that keeps what it was given, and every
 * assertion about tokens, expiry and single use runs against the real code
 * path. It is also what lets the worker be deployed before the sending domain
 * is onboarded -- an unconfigured binding refuses to send and says so, rather
 * than pretending.
 */

export interface Message {
  to: string
  subject: string
  /**
   * Plain text, always. A login link that renders as a bare URL survives every
   * mail client there is, and a wrapped link in a sign-in email is
   * indistinguishable from a phishing attempt -- it teaches partners to click
   * wrapped links, which is the opposite of what a security email should do.
   */
  text: string
  /**
   * Who a reply goes to, when it is not us: the contact form's learner. Set on
   * the wire for both senders, or the operator answers into the void from
   * whichever one is live.
   */
  replyTo?: string
}

export type MailSender = (message: Message) => Promise<boolean>

/**
 * Cloudflare Email Service, as the binding presents it.
 *
 * Typed structurally rather than imported: the binding's own types come from a
 * package this worker does not otherwise need, and what is actually used is one
 * method taking a raw RFC 822 message.
 */
export interface SendEmailBinding {
  send(message: { from: string; to: string; raw: string }): Promise<unknown>
}

export interface MailConfig {
  binding?: SendEmailBinding
  /**
   * A Resend API key, and the whole reason this module has two senders.
   *
   * The `send_email` binding delivers only to addresses somebody has verified
   * inside our own Cloudflare account. For a pilot of people we add by hand that
   * is a feature -- the blast radius of a bug is the handful who agreed to be
   * here. For self-registration it is a contradiction: the mail we cannot send
   * to a stranger is the very mail that would let them confirm the address.
   *
   * So when a key is present it wins, and the binding is what remains when it is
   * not. Set it and strangers can be mailed; unset it and behavior is exactly
   * what it was.
   */
  apiKey?: string
  from: string
  /**
   * Injected the way `createCoupon` is in `couponFor`, so the suite drives the
   * real request-building code without a network or an account. A mailer whose
   * only test is "we called a library" has tested nothing about the body.
   */
  fetcher?: typeof fetch
}

/**
 * A header value a mail server will accept, whatever is in it.
 *
 * RFC 5322 headers are ASCII; our subject lines are not, because they are
 * written in English with a typographic apostrophe in "Howard's". Sent raw,
 * an eight-bit byte in a header is rendered as mojibake by any MTA that does
 * not tolerate it -- so a subject that needs it goes out RFC 2047 encoded and
 * one that does not goes out unchanged, which keeps the common case readable
 * in a raw message.
 */
function headerValue(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `=?UTF-8?B?${btoa(binary)}?=`
}

/**
 * One message, as bytes a mail server will accept.
 *
 * Hand-built rather than pulled from a library, because what is being built is
 * three headers and a body. What a library would also have done, and what has
 * to be done here instead:
 *
 * - **CRLF throughout.** The bodies are written as ordinary TypeScript strings
 *   with `\n` in them, and RFC 5322 §2.3 wants `\r\n`. Mixing the two matters
 *   more than it looks: a hop that normalises the bare newlines alters exactly
 *   the bytes Cloudflare's DKIM signature covers, so the signature fails at the
 *   recipient and the sign-in link -- the only way into the portal -- lands in
 *   spam.
 * - **Encoded headers.** See `headerValue`.
 */
function raw(from: string, message: Message): string {
  return [
    `From: ${from}`,
    `To: ${headerValue(message.to)}`,
    `Subject: ${headerValue(message.subject)}`,
    ...(message.replyTo === undefined ? [] : [`Reply-To: ${headerValue(message.replyTo)}`]),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.text.replace(/\r\n|\n/g, '\r\n'),
    '',
  ].join('\r\n')
}

/**
 * The sender the deployed worker uses.
 *
 * `false` rather than a throw when the binding is missing, and the caller
 * treats that the way it treats a bounce: the partner cannot get in, which is a
 * visible total failure rather than a subtle one, and is the right shape for
 * something whose whole job is to deliver. `npm run partners -- login-link`
 * prints a token instead of mailing one, and is what gets somebody in on the
 * day the mail is the thing that is broken.
 */
export function mailerFor(config: MailConfig): MailSender {
  return async (message) => {
    if (config.apiKey !== undefined && config.apiKey.length > 0) {
      return await sendViaResend(config, message)
    }
    if (config.binding === undefined) {
      console.error('no mail sender configured: mail not sent')
      return false
    }
    try {
      await config.binding.send({
        from: config.from,
        to: message.to,
        raw: raw(config.from, message),
      })
      return true
    } catch (error) {
      // A hard bounce puts an address on a suppression list, and a new account
      // starts on a conservative daily quota. Both are worth seeing in the logs
      // rather than discovering from a partner who cannot sign in.
      console.error('mail not sent', error)
      return false
    }
  }
}

/**
 * One message, over Resend's HTTP API.
 *
 * Hand-rolled `fetch` rather than their SDK, for the reason every other outside
 * call in this worker is hand-rolled: a dependency in a worker is bundle size
 * and a supply chain, and what is actually needed here is one POST with four
 * fields.
 *
 * `text` only, no `html`, which keeps this identical to what the binding sends.
 * A login link that renders as a bare URL survives every mail client there is,
 * and a wrapped link in a sign-in email is indistinguishable from a phishing
 * attempt.
 *
 * Returns false rather than throwing, exactly as the binding path does. Every
 * caller treats a failed send as "no link went out" and carries on; a throw here
 * would instead surface as a 500 on an endpoint whose answer is deliberately
 * identical whether or not an address exists -- which would turn the mailer into
 * the oracle that endpoint is built to avoid being.
 */
async function sendViaResend(config: MailConfig, message: Message): Promise<boolean> {
  const send = config.fetcher ?? fetch
  try {
    const response = await send('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
      }),
    })
    if (!response.ok) {
      // The body carries the reason -- an unverified domain, a suppressed
      // address, a spent quota -- and without it the log says only that mail
      // stopped working, which is the same sentence for every cause.
      console.error('resend refused the message', response.status, await response.text())
      return false
    }
    return true
  } catch (error) {
    console.error('mail not sent', error)
    return false
  }
}

/**
 * The copy, from docs/work/partners/emails.md.
 *
 * Every one of these is transactional -- it exists because the recipient did
 * something or because money moved -- which is what keeps them out of CAN-SPAM's
 * marketing rules and, more to the point, keeps a login link from arriving next
 * to an advert. Each says what the link does and when it dies in the sentence
 * before it.
 */
/**
 * No outbound message interpolates anything a stranger supplied.
 *
 * Worth stating, because it stopped being true for a while and had to be
 * defended with a sanitiser. When an application could name the partner who
 * recruited it, that name went into a DKIM-signed message sent to an address
 * the applicant also chose -- so "Support — restore access at
 * https://look-alike.example" arrived as a phishing page with our signature on
 * it. Removing the second tier removed the only such field, and with it the
 * sanitiser that had to keep guessing at what reads as a destination.
 */
/**
 * Short on purpose.
 *
 * This was five sentences, and it arrived alongside a second message carrying
 * the whole partner agreement inline. The first partner to receive the pair
 * called it annoyingly pedantic, and she was right: somebody who has just
 * filled in a form wants the next step, not a briefing. Everything that was in
 * here except the link was either obvious from the form they had just
 * submitted, or a disclaimer written for a reader who does not exist.
 *
 * The agreement is a link rather than an attachment for the same reason, and
 * for one more: pasted in full it carried the certification domain into the
 * inbox of somebody who had never heard of it. The acceptance is still recorded
 * where it counts -- `partners.agreement_version`, `agreement_sha256` and
 * `agreement_accepted_at` -- so the record stands up without the wall of text.
 */
export function verifyEmail(
  link: string,
  agreementLink?: string,
  /**
   * A one-off, for the people who received the long version before it was cut
   * down. Off for everybody else, because an apology for an email somebody
   * never got is worse than no apology.
   */
  apologize = false,
): Message {
  return {
    to: '',
    subject: 'Confirm your email — Howard’s Lantern partners',
    text:
      (apologize
        ? 'Sorry about the cluttered email we sent you earlier — here is the short version.\n\n'
        : '') +
      'Click here to get started:\n\n' +
      `${link}\n\n` +
      'The link works once and expires in 4 hours.\n' +
      (agreementLink === undefined
        ? ''
        : `\nThe agreement you accepted: ${agreementLink}\n`),
  }
}

/**
 * The one message that goes to us rather than to a partner.
 *
 * A queue nobody opens fails exactly the way a script nobody runs does, and
 * until this existed there was no notification of any kind when somebody
 * applied: the five other messages are all addressed to the applicant, and
 * `SUPPORT_EMAIL` was only ever returned in an API response. Meanwhile the
 * applicant's own screen promises "we will email you when somebody has" looked
 * at it -- a promise that depended on remembering to run `partners -- list`.
 *
 * **It names nobody.** The applicant supplied their own name and address, and
 * this file's rule is that no outbound message interpolates anything a stranger
 * typed -- a rule that exists because a sponsor name once carried a phishing
 * URL out over our own DKIM signature. The queue is one click away and shows
 * who applied; the message only has to say that it is not empty.
 */
export function newApplicationEmail(
  queueLink: string,
  /** Which form it came from, so the subject says which queue to open. */
  kind: 'partner' | 'rep' = 'partner',
): Message {
  const rep = kind === 'rep'
  return {
    to: '',
    subject: rep
      ? 'Somebody has applied to be a sales rep'
      : 'Somebody has applied to the partner program',
    text:
      (rep
        ? 'A new sales rep application is waiting for a decision.\n\n'
        : 'A new partner application is waiting for a decision.\n\n') +
      `${queueLink}\n\n` +
      'Nothing is visible to them until somebody approves it, and their screen says we will ' +
      'write when we have looked.\n',
  }
}

/**
 * The message the pending screen promises.
 *
 * "We will email you when somebody has" looked was on every pending partner's
 * screen, and approving sent nothing -- so a school approved on Monday found out
 * whenever it next happened to sign in, holding a live code nobody had told it
 * about. It carries everything they need to start without signing in: the code
 * to hand out and the link to share. The sign-in link is the page, not a token,
 * because a token dies in four hours and this is read whenever they read it.
 *
 * The code is ours, minted by `codeFor` from the name they gave, and it can
 * only be letters and digits -- `CODE` in partner-admin.ts refuses anything
 * else -- so this keeps the rule that nothing a stranger typed goes out.
 */
export function approvalEmail(code: string, shareLink: string, signInLink: string): Message {
  return {
    to: '',
    subject: 'You’re approved — your Howard’s Lantern partner code',
    text:
      'Your partner account is active. Your code is:\n\n' +
      `${code}\n\n` +
      'Your buyers type it at checkout, or you can share this link, which carries it:\n\n' +
      `${shareLink}\n\n` +
      'Your rates, sales and commissions are in the portal. Sign in there with this ' +
      'address and we will email you a link:\n\n' +
      `${signInLink}\n\n` +
      'Wherever you recommend us, say that you earn a commission. "I get a commission if ' +
      'you buy through my link" is enough, and the FTC requires it.\n',
  }
}

/**
 * The rep's confirmation link: `verifyEmail`'s job, in words about the job
 * they applied for. A rep told to confirm their "partners" address wonders
 * whether they filled in the wrong form.
 */
export function repVerifyEmail(link: string, agreementLink: string): Message {
  return {
    to: '',
    subject: 'Confirm your email — Howard’s Lantern sales reps',
    text:
      'Click here to confirm your application:\n\n' +
      `${link}\n\n` +
      'The link works once and expires in 4 hours.\n' +
      `\nThe agreement you accepted: ${agreementLink}\n`,
  }
}

/**
 * The message a rep's pending screen promises, naming the states they now
 * hold. The names come from STATE_NAMES and the link is ours, so nothing a
 * stranger typed goes out -- the rule `newApplicationEmail` explains.
 */
export function repApprovalEmail(signInLink: string, stateNames: readonly string[]): Message {
  return {
    to: '',
    subject: 'You’re approved — Howard’s Lantern sales rep',
    text:
      'Your sales rep account is active.\n\n' +
      (stateNames.length === 0
        ? 'No state is assigned to you yet; we will email you when one is.\n\n'
        : `Your ${stateNames.length === 1 ? 'state is' : 'states are'}: ${stateNames.join(', ')}. ` +
          'You earn 15% of what every buyer of those states’ tests pays, after any discount.\n\n') +
      'Your sales, commissions and the link to share with driving schools are in the portal. ' +
      'Sign in there with this address and we will email you a link:\n\n' +
      `${signInLink}\n`,
  }
}

export function loginEmail(link: string): Message {
  return {
    to: '',
    subject: 'Your Howard’s Lantern partner sign-in link',
    text:
      'Here is your link:\n\n' +
      `${link}\n\n` +
      'It works once and expires in 4 hours. If you did not ask to sign in, you can ignore ' +
      'this — somebody typed your address and got no further.\n',
  }
}

export function payoutStepUpEmail(link: string): Message {
  return {
    to: '',
    subject: 'Confirm the change to where your Howard’s Lantern payments go',
    text:
      'Somebody asked to change the payout details on your partner account. Confirm it here:\n\n' +
      `${link}\n\n` +
      'It works once and expires in 4 hours. If this was not you, do not click it — your ' +
      'details have not changed, and replying to this message reaches a person.\n',
  }
}

/**
 * Sent to the address the money used to go to, whether or not it was them.
 *
 * Account takeover in an affiliate program has one payoff: repointing the
 * payout details, staying quiet, and collecting somebody else's next cheque.
 * This is the message that makes quiet impossible.
 */
export function payoutChangedEmail(): Message {
  return {
    to: '',
    subject: 'Where your Howard’s Lantern payments go has changed',
    text:
      'The payout details on your partner account were changed just now.\n\n' +
      'If that was you, there is nothing to do — the next payment goes to the new details, and ' +
      'no payout is made for seven days after a change.\n\n' +
      'If it was not you, reply to this message immediately.\n',
  }
}

/**
 * No longer sent, and kept only so the decision is findable.
 *
 * It pasted the entire agreement into a second message that arrived at the same
 * moment as the confirmation link. Two emails for one form is already one too
 * many, and the second was several screens of legal text nobody reads on a
 * phone. `verifyEmail` links to the same document instead.
 *
 * Nothing about the record changed: the version, the SHA-256 of the exact bytes
 * shown, and the moment of acceptance are all columns on `partners`, which is
 * what makes the acceptance provable. This message was a courtesy copy.
 */
export function agreementCopyEmail(version: string, agreement: string): Message {
  return {
    to: '',
    subject: `Your copy of the Howard’s Lantern Partner Agreement (v${version})`,
    text:
      'This is the agreement you accepted when you applied, exactly as it was shown to you. ' +
      'Keep it.\n\n' +
      `${agreement}\n`,
  }
}

/**
 * The one message about a learner, and the only word in it a person chose.
 *
 * Sent to the school that made an invite, on the day the student on it reaches
 * Prepared. Label, state and date; the reason it says nothing else is that a
 * school can act on exactly these three and nothing more would be theirs to
 * hold. No score, because the roster shows the score to the school already and
 * an inbox is a worse place for a child's mark than a portal behind a login.
 * No session id, because an id in an email outlives the feature. No link,
 * because a link in a notification teaches people to click links in
 * notifications, which is what every phishing email since 1996 has counted on
 * -- and the portal is one bookmark away.
 *
 * `label` is the first thing this file has ever interpolated that a person
 * typed, and the rule above about strangers still holds: the person who typed
 * it is the person who receives it, and `normalizeLabel` in
 * worker/src/invites.ts refuses anything shaped like an address or a number
 * before it is stored. What it cannot refuse is a school naming a student
 * badly, and that is the school's to justify -- which agreement §12 is to say,
 * in its own versioned change (docs/plans/ready-to-book.md, open question 5).
 */
export function readyEmail(label: string, stateName: string, date: string): Message {
  return {
    to: '',
    subject: `${label} is ready — Howard’s Lantern`,
    text:
      `${label} is ready.\n\n` +
      `On ${date} they passed three full practice tests in a row on the ${stateName} test, ` +
      'which is the app’s readiness mark. This is the moment to book their knowledge test ' +
      'and their first lesson.\n\n' +
      'Everything else about how they studied is in your portal, under Learners. This ' +
      'email is sent once per student and is best-effort: some phones block the counter ' +
      'that triggers it, so the portal is the record.\n',
  }
}

/**
 * The earlier heads-up: the student on an invite passed their first full
 * practice test.
 *
 * Sent because a knowledge-test appointment is booked weeks ahead in most
 * states, so the day a student is ready is too late to start looking for one.
 * Green Light is the moment the booking should be made, so that the date lands
 * around when they reach Prepared. It is not a readiness claim -- Prepared
 * is, and the pass-or-refund guarantee rests on Prepared alone -- which is why
 * this says "book the appointment" and never "they are ready".
 *
 * The same three facts as `readyEmail` and the same reasons for nothing else.
 */
export function greenLightEmail(label: string, stateName: string, date: string): Message {
  return {
    to: '',
    subject: `${label} passed their first practice test — Howard’s Lantern`,
    text:
      `${label} passed their first full practice test on the ${stateName} test. ` +
      'Now is a good time to book their DMV knowledge test appointment, so the date lands ' +
      'around when they’re ready.\n\n' +
      `They passed it on ${date}.\n\n` +
      'We will email you again when they are ready: three full practice tests passed in a ' +
      'row. Everything else about how they are studying is in your portal, under Learners. ' +
      'This email is best-effort — some phones block the counter that triggers it — so the ' +
      'portal is the record.\n',
  }
}
