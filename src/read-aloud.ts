import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { clipName } from './audio-clip'

/**
 * Reading the app out loud: the mode, and the voice that serves it.
 *
 * Ambient the same way `StatusContext` and `MenuContext` are. The toggle is
 * drawn by the shell on every screen that has something to read, and the replay
 * button is drawn beside the words it repeats -- so neither the shell nor a
 * screen has to be handed a prop for the other's half.
 *
 * Null means this screen does not speak, which is what the shell provides for
 * the overlays and the state list. There is nothing to read on a privacy page
 * that a screen reader is not already better at.
 */
export interface ReadAloud {
  /** Whether every new card and question reads itself. */
  on: boolean
  toggle: () => void
  /** Say these now, in order, canceling anything already speaking. */
  say: (parts: readonly string[] | null) => void
  /** Say these only because the mode is on. Silent when it is off. */
  sayIfOn: (parts: readonly string[] | null) => void
  /** Whether this browser can speak at all; false hides every control. */
  available: boolean
  /**
   * Whether the control is drawn but cannot be used: Spanish, on a device with
   * no Spanish voice (docs/plans/spanish-app.md, §9). Disabled rather than
   * hidden, with a line saying why -- a control that vanishes when the language
   * changes looks like a bug, and an English voice reading Spanish is worse
   * than silence.
   */
  blocked: boolean
}

export const ReadAloudContext = createContext<ReadAloud | null>(null)

export function useReadAloud(): ReadAloud | null {
  return useContext(ReadAloudContext)
}

/** The browser's own voice, or null where there is none -- an old browser, or a test. */
function synth(): SpeechSynthesis | null {
  return typeof window === 'undefined' ? null : (window.speechSynthesis ?? null)
}

/**
 * Forty-five bytes of silence: one sample, and a real file.
 *
 * Its only job is to be played from inside a gesture handler. See rule 2 below:
 * an element that has never begun playback during a gesture is an element iOS
 * will not play from an effect, and every later play() comes from an effect. A
 * data URI rather than a file because the unlock must not be one round trip
 * away from the press -- on the slow connection this whole trick exists for, a
 * fetch would turn the first press into a no-op.
 *
 * **A WAV, and one that actually decodes.** The first attempt was a scrap of
 * base64 claimed to be an MP3 and was not a valid file at all. It still
 * unlocked, because calling play() is what the browser counts -- but the
 * element then raised `error` on the undecodable source a moment later, and
 * that error arrived while the first real clip was loading. The clip was
 * reported as failed, the fallback voice read the line over the top of the
 * recording, and the whole thing looked like a race because it was one. A WAV
 * header is short enough to write out by hand and check, which an MP3 frame is
 * not.
 */
const SILENCE =
  'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA'

/**
 * How long to wait on a clip of known length before giving up on it.
 *
 * Proportional rather than a flat margin, because a flat one is wrong at both
 * ends: three seconds is most of a two-word answer's patience and almost none
 * of a twenty-second law's. Half again plus a second scales with what is
 * actually being waited for.
 *
 * Erring long on purpose. Cutting a clip short talks over the learner; waiting
 * a moment too long is a pause nobody notices.
 */
const patienceFor = (seconds: number): number => seconds * 1500 + 1000

/** How long to wait on a clip that never even reports how long it is. */
const UNKNOWN_LENGTH_CEILING = 10000

/**
 * Begin playback on the shared element, from inside a gesture handler.
 *
 * Only the first call does anything. Everything after it is a no-op, because
 * the element stays unlocked for the life of the page once playback has begun
 * during a gesture -- which is exactly the property being bought here.
 */
function unlock(audio: HTMLAudioElement | null, done: { current: boolean }): void {
  if (audio === null || done.current) return
  // Tracked by a flag rather than by inspecting `src`, because the player
  // may clear `src` between clips, so an empty `src` would mean
  // "between clips" rather than "never unlocked", and reading it that way would
  // replay the silent clip before every utterance.
  done.current = true
  audio.src = SILENCE
  void audio.play().catch(() => {})
}

/** Where a recorded clip lives: one directory per state, numbers included. */
async function clipUrl(state: string, text: string): Promise<string | null> {
  const name = await clipName(text)
  return name === null ? null : `/audio/${state}/${name}.mp3`
}

/**
 * Whether this state has recorded audio at all.
 *
 * One HEAD request for the state's manifest, fired on mount and long resolved
 * before anybody presses the speaker. Asked once rather than discovered per
 * clip, because discovering it per clip means every utterance in a state we
 * never recorded waits for a failed load first -- nine of them on a question,
 * each one a silence the learner sits through before the fallback speaks.
 *
 * **The status code is not the answer.** Cloudflare Pages serves index.html for
 * anything it has no file for, which is the whole reason `/drivers/MD` reaches
 * the app with no edge routing -- so a state we never recorded answers `200` for
 * its manifest, and answers it with a web page. Believing that is how every
 * unrecorded state would claim to have a voice. The content type is what tells
 * a real manifest from the app being served in its place.
 */
async function hasRecording(state: string): Promise<boolean> {
  try {
    const response = await fetch(`/audio/${state}/index.json`, { method: 'HEAD' })
    return response.ok && (response.headers.get('content-type') ?? '').includes('json')
  } catch {
    return false
  }
}

/**
 * The mode and the speaking, owned in one place.
 *
 * Four rules live here, and each one is a bug that has bitten somebody:
 *
 * 1. **Cancel before every utterance.** Speech queues. A learner tapping
 *    through four cards would otherwise hear all four, the last of them long
 *    after they had moved on. With a queue this also has to empty the queue: a
 *    remainder left behind resumes into the next question, which is the same
 *    bug wearing a different hat.
 *
 * 2. **Nothing is spoken until the learner has pressed the speaker.** Safari
 *    will not play an audio element that has not begun playback inside a
 *    gesture handler, and every play() here comes from an effect, which is not
 *    one. So the mode is not restored from storage: it starts off on every
 *    load, and the press that turns it on is the gesture that unlocks the
 *    element. That press also reads the card already on screen, so it produces
 *    sound rather than merely arming something.
 *
 *    The mode used to be remembered, and remembering it is what made this
 *    unsafe: a returning learner never taps anything -- App.tsx restores the
 *    stored state and boots straight onto a study card -- so the toggle would
 *    have rendered as ON over a card the browser refuses to speak. A control
 *    that says on and produces silence is the worst of the options, and is the
 *    "reported as broken" failure this comment used to describe.
 *
 * 3. **Turning the mode off stops the sentence in progress.** An off switch
 *    that only applies to the next question is not an off switch, and the
 *    reason somebody reaches for it is usually that a person just walked in.
 *
 * 4. **Silence when the page is hidden.** Behavior on tab-away varies by
 *    browser; canceling means it never resumes into a room that has moved on.
 */
/**
 * The Spanish voice to read with, best first: `es-US`, then `es-MX`, then any
 * other Spanish, and Spain's last -- the learner is sitting an American exam,
 * and the handbooks it quotes are written for Spanish speakers here.
 */
export function spanishVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const rank = (voice: SpeechSynthesisVoice) => {
    const tag = voice.lang.replace('_', '-').toLowerCase()
    if (!tag.startsWith('es-')) return -1
    return tag === 'es-us' ? 0 : tag === 'es-mx' ? 1 : tag === 'es-es' ? 3 : 2
  }
  return (
    [...voices]
      .filter((voice) => rank(voice) >= 0)
      .sort((a, b) => rank(a) - rank(b))[0] ?? null
  )
}

export function useReadAloudEngine(state: string | null, lang: 'en' | 'es' = 'en'): ReadAloud {
  const [on, setOn] = useState(false)
  const engine = synth()
  /**
   * The voice a Spanish utterance is given, or null while there is none.
   *
   * Asked again on `voiceschanged`, because Chrome returns an empty list from
   * `getVoices()` until the voices have loaded, and a choice made on the first
   * call would disable the control on every device that has a Spanish voice.
   */
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)
  useEffect(() => {
    if (engine === null || lang !== 'es') return
    const pick = () => setVoice(spanishVoice(engine.getVoices()))
    pick()
    engine.addEventListener?.('voiceschanged', pick)
    return () => engine.removeEventListener?.('voiceschanged', pick)
  }, [engine, lang])
  const blocked = lang === 'es' && voice === null
  const available = !blocked && (engine !== null || typeof Audio !== 'undefined')

  /**
   * One element for every clip, for the life of the session. Unlocking is per
   * element on iOS, so a fresh `new Audio()` per utterance would be a fresh
   * locked element every time and the toggle's unlock would buy nothing.
   */
  const player = useRef<HTMLAudioElement | null>(null)
  /** Bumped by every cancel. An utterance whose generation is stale gives up. */
  const generation = useRef(0)
  const recorded = useRef<Promise<boolean>>(Promise.resolve(false))
  /** Whether the shared element has begun playback inside a gesture yet. */
  const unlocked = useRef(false)

  useEffect(() => {
    // Never in Spanish, and not even asked: the recordings are English, and a
    // Spanish course that fetched one would be reading English in a Spanish
    // voice's place.
    recorded.current =
      state === null || lang === 'es' ? Promise.resolve(false) : hasRecording(state)
  }, [state, lang])

  /**
   * The element exists from mount; only its *unlocking* waits for a gesture.
   *
   * Creating it inside the toggle was wrong, and the Replay button is what
   * proves it: Replay works with the mode off and is the whole reason somebody
   * who missed one line does not have to switch a mode on to hear it. With no
   * element until the toggle was pressed, pressing Replay first fell through to
   * the browser voice -- so the one control aimed at "I did not catch that"
   * answered in the voice they were struggling with.
   *
   * The unlock itself is *not* hung on a window-wide first-tap listener, which
   * was the first attempt and was too broad by half: it fired on the Start
   * press that opens the first law, so a page whose learner never asked for
   * speech was still playing a silent clip -- enough to register as playback to
   * anything watching, and enough to be wrong. It belongs to the two controls
   * that start speech, and `say` and `toggle` are both reached from a press of
   * one of them.
   */
  useEffect(() => {
    if (typeof Audio === 'undefined') return
    player.current ??= new Audio()
    player.current.preload = 'auto'
  }, [])

  const stop = useCallback(() => {
    generation.current += 1
    engine?.cancel()
    const audio = player.current
    if (audio !== null) {
      audio.pause()
      audio.currentTime = 0
    }
  }, [engine])

  useEffect(() => {
    const hush = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    document.addEventListener('visibilitychange', hush)
    return () => {
      document.removeEventListener('visibilitychange', hush)
      stop()
    }
  }, [stop])

  /**
   * One clip, resolved when it has finished, failed, or given up.
   *
   * The third case is the one worth explaining. `ended` and `error` are the two
   * signals a media element is supposed to give, and a clip that gives neither
   * -- a stalled connection, a byte range the server answers oddly, a file that
   * decodes to nothing -- would otherwise leave this promise pending forever.
   * That does not silence one clip, it silences the rest of the question: the
   * queue is sequential, so whatever came after it never plays and the learner
   * is left with half a question and no way to ask for the rest.
   *
   * So the clip is given its own length plus a margin, once its length is
   * known, and a flat ceiling until then. Giving up returns false, which is the
   * same answer as failing -- and false means the browser's own voice says this
   * part instead, so the learner hears all of it either way.
   */
  const playClip = useCallback((url: string): Promise<boolean> => {
    const audio = player.current
    if (audio === null) return Promise.resolve(false)
    audio.pause()
    return new Promise((resolve) => {
      let watchdog = 0
      // An arrow declared after the null check rather than a hoisted function,
      // which TypeScript has to assume could run before it and so widens the
      // element back to nullable.
      const done = (ok: boolean) => {
        window.clearTimeout(watchdog)
        audio.onended = null
        audio.onerror = null
        audio.onloadedmetadata = null
        resolve(ok)
      }
      watchdog = window.setTimeout(() => done(false), UNKNOWN_LENGTH_CEILING)
      audio.onended = () => done(true)
      audio.onerror = () => done(false)
      audio.onloadedmetadata = () => {
        if (!Number.isFinite(audio.duration)) return
        window.clearTimeout(watchdog)
        watchdog = window.setTimeout(() => done(false), patienceFor(audio.duration))
      }
      audio.src = url
      void audio.play().catch(() => done(false))
    })
  }, [])

  const say = useCallback(
    (parts: readonly string[] | null) => {
      if (parts === null || parts.length === 0 || blocked) return
      // Rule 2, and it has to be the first thing here: reached from the Replay
      // button's own click, this runs inside that gesture, which is the only
      // place iOS accepts a first play() from. Everything below is async and
      // has left the gesture behind by the time it plays anything.
      unlock(player.current, unlocked)
      // Rule 1, before anything is decided about how to say it.
      stop()
      const mine = generation.current
      void (async () => {
        const useClips = state !== null && player.current !== null && (await recorded.current)
        if (generation.current !== mine) return
        for (const part of parts) {
          if (generation.current !== mine) return
          // A clip that 404s or fails to decode falls through to the browser's
          // own voice for that part rather than dropping it. Because the clip
          // was rendered from `speakable(text)` and the fallback is handed the
          // same string, the two are guaranteed to say the same words.
          const url = useClips ? await clipUrl(state, part) : null
          const spoke = url !== null && (await playClip(url))
          if (generation.current !== mine) return
          if (spoke || engine === null) continue
          const utterance = new SpeechSynthesisUtterance(part)
          if (lang === 'es') {
            utterance.lang = 'es-US'
            if (voice !== null) utterance.voice = voice
          }
          engine.speak(utterance)
        }
      })()
    },
    [engine, playClip, state, stop, lang, voice, blocked],
  )

  const sayIfOn = useCallback(
    (parts: readonly string[] | null) => {
      if (!on || blocked) return
      say(parts)
    },
    [on, say, blocked],
  )

  const toggle = useCallback(() => {
    // Rule 2. This runs inside the click, which is the only place iOS will
    // accept a first play() from, and before the state update so nothing can
    // reorder it out of the gesture. The pointerdown listener above usually
    // gets here first; this is the documented path and must not depend on that.
    unlock(player.current, unlocked)
    setOn((was) => {
      // Rule 3.
      if (was) stop()
      return !was
    })
  }, [stop])

  // A change of language silences whatever was being said in the other one.
  useEffect(() => stop, [lang, stop])

  return { on: on && !blocked, toggle, say, sayIfOn, available, blocked }
}
