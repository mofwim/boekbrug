'use client'

// src/app/dashboard/logboek/LogboekClient.tsx
// [LOGBOEK] What happened in this administration, and who did it.
//
// ── THE THREE STATES, AND WHY THEY MAY NEVER BE TWO ──
//
// This screen can be in exactly three situations and it must say which one, every time:
//
//   1. there are rows            → the list
//   2. we read the log, it is empty → log.leeg  "Er is nog niets gebeurd om te tonen."
//   3. we could NOT read the log   → log.mislukt "We konden je logboek niet lezen.
//                                                 Dit is geen 'er is niets gebeurd'."
//
// Two and three look identical on screen if you let them: both end in a page with no rows on it.
// That collapse is the failure this whole feature exists to prevent. A logbook is only worth
// something if its SILENCE means something — the owner opens this screen precisely to establish
// that nothing was done behind their back, and an empty page that actually means "the database
// hiccupped" answers that question with a lie. Which is why /api/logboek answers 503 rather than
// [] (see the [NO-SILENT-EMPTY] note in its header), and why every failure path below lands on
// log.mislukt and never on log.leeg.
//
// The same rule applies to the SECOND page. A "Meer laden" that fails and quietly leaves the list
// as it was tells the owner "that was everything" — the same lie, in a smaller size. So a failed
// page-two keeps the rows it has, keeps the button, and says out loud that it failed.
//
// And log.leeg is only rendered when it is literally true: nothing is loaded AND there is no next
// page. While a cursor is still outstanding, "nothing here" is a statement about what has been
// FETCHED, not about what has happened, so the screen simply offers the button and claims nothing.
//
// ── THIS COMPONENT HOLDS NO LANGUAGE OF ITS OWN ──
//
// Every word comes from the catalogue through `t`. That includes the sentence for a row: for the
// 89 actions someone wrote a sentence for it is t(entry.messageKey); for anything else — a row
// written by an older version of the app, or an action added since — it is log.onbekend plus the
// raw action name in mono. The row is never dropped and never rendered as a bare key: "we cannot
// phrase this" and "this never happened" are different answers and the screen has to be able to
// give the first one. See hasSentence() in src/lib/logboek.ts.
//
// The only character typed here that a person reads is an em dash, for a timestamp we do not have.
// Punctuation is the same in all four languages; a word is not.
//
// ── WHAT THIS SCREEN DELIBERATELY DOES NOT DO ──
//
//   · No counts on the filter chips. What is loaded is a PAGE, not the trail, so "Geld (50)" would
//     be a number about our paging presented as a number about the administration.
//   · No re-sorting in the browser. The order is the route's ORDER BY (created_at DESC, id DESC) —
//     total, so no row can swap places between two requests. A sort here would be a second, weaker
//     opinion, and it would have to invent an answer for a row whose created_at is null.
//   · No names. byOther says "door iemand anders" because that is all a row supports: since
//     [ACTING-FOR] an invited medewerker also acts under the same BTW number, so "je boekhouder"
//     would be a claim about a person that the audit row cannot back up.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import { COLUMN, FONT, FONT_NUM, M3 } from '@/lib/design/tokens'
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
import { LOCALE_META } from '@/lib/i18n/locale'
import type { MessageKey } from '@/lib/i18n/messages'
import { hasSentence, LOGBOEK_KINDS, type LogboekEntry, type LogboekKind } from '@/lib/logboek'

/** What /api/logboek answers. Mirrors the route's LogboekResponse; validated on arrival below. */
interface LogboekAnswer {
  entries: LogboekEntry[]
  nextCursor: string | null
  spoorOnvolledig?: true
}

/**
 * Which chip each kind gets, or none.
 *
 * 'system' has no chip on purpose and this map is where that decision is visible. It is the bucket
 * an action lands in when nobody has classified its domain yet, so a chip for it would either need
 * a word for "we do not know what this is" or, worse, be folded into Geld because most actions are
 * money — the app claiming to understand a row it has never seen. A system row is reachable under
 * Alles, which is the filter the screen opens on.
 */
const KIND_CHIP: Readonly<Record<LogboekKind, MessageKey | null>> = {
  money: 'log.filter.geld',
  document: 'log.filter.document',
  access: 'log.filter.toegang',
  system: null,
}

/**
 * The filter row: Alles first, then every kind that has a chip, in LOGBOEK_KINDS order.
 *
 * Built FROM LOGBOEK_KINDS rather than written out, so a kind added to the shared module cannot
 * silently go unfilterable here — it arrives with a null chip and this file is the one place that
 * has to answer for it.
 */
const CHIPS: ReadonlyArray<{ kind: LogboekKind | null; key: MessageKey }> = [
  { kind: null, key: 'log.filter.alles' },
  ...LOGBOEK_KINDS.flatMap((k) => {
    const key = KIND_CHIP[k]
    return key ? [{ kind: k, key }] : []
  }),
]

/**
 * One formatter for every timestamp on the screen, built once.
 *
 * 'nl-NL' in ALL four languages, and that is a decision rather than an oversight. It is the format
 * every other date in this app is printed in (formatDateNL), so a line here can be held next to an
 * invoice date, a bank statement or an aangifte without conversion — the same argument locale.ts
 * makes for forcing Latin digits in Arabic: correct as language, wrong as a record.
 *
 * Europe/Amsterdam because that is the day the owner's administration runs on. created_at is stored
 * with a zone, and rendering it in the browser's zone would put a Sunday-evening booking on Monday
 * for anyone travelling.
 *
 * Built at module scope: constructing an Intl.DateTimeFormat is expensive, and inside the row map
 * it would be built fifty times per page.
 */
const STAMP = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Amsterdam',
})

/**
 * The moment, or an em dash.
 *
 * A dash and not a word: the row is real, the moment is not known, and the one thing that may never
 * happen on an audit trail is a time that was made up to fill a gap. Nothing writes a null
 * created_at today (the database defaults it), but the column is nullable and the route hands the
 * value through untouched, so the screen has to be able to say "no timestamp" without inventing one.
 */
function stamp(at: string | null): string {
  if (!at) return '—'
  const d = new Date(at)
  if (isNaN(d.getTime())) return '—'
  return STAMP.format(d)
}

/**
 * Merge a freshly loaded page into what is already on screen, keeping the first sighting of an id.
 *
 * This is not "drop rows we do not like" — the id is audit_logs' primary key, so a repeat is the
 * SAME event, and painting it twice would claim the bookkeeper did something twice. The cursor is
 * built to make overlap impossible (see the boundary-tie note in the route), so this should never
 * fire; it is here because a double-fetch under React strict mode would otherwise be visible to the
 * owner as duplicated history, which is exactly the kind of thing that costs a trail its authority.
 */
function mergeById(existing: LogboekEntry[], page: LogboekEntry[]): LogboekEntry[] {
  const seen = new Set(existing.map((e) => e.id))
  return [...existing, ...page.filter((e) => !seen.has(e.id))]
}

/** Which of the three situations the screen is in. Never inferred from entries.length — see header. */
type Status = 'loading' | 'ok' | 'failed'

/**
 * What one read of /api/logboek produced. A discriminated union rather than a page plus a nullable
 * error, so there is no third shape where both are set and the caller has to pick — the two answers
 * this screen must never blur are the two members of this type.
 */
type Outcome =
  | { ok: true; page: LogboekEntry[]; nextCursor: string | null; spoorOnvolledig: boolean }
  | { ok: false }

/**
 * Read one page. Touches no state, which is why it lives outside the component: the mount effect can
 * then call it and apply the answer in the callback, instead of setting state synchronously in the
 * effect body — the shape eslint's react-hooks/set-state-in-effect asks for, and the same one
 * use-locale.ts had to be rewritten into.
 */
async function readPage(cursor: string | null): Promise<Outcome> {
  try {
    const res = await fetch(
      cursor === null ? '/api/logboek' : `/api/logboek?before=${encodeURIComponent(cursor)}`,
      // The route already sends no-store; asked for here as well because a cached audit trail is a
      // stale answer to "what happened just now", which is the question this screen is for.
      { cache: 'no-store' },
    )
    // Every non-2xx is a failure of the SAME kind for this screen: 503 (the read broke), 401 (the
    // session died under us), 400 (a cursor we built ourselves was rejected). What they have in
    // common is the only thing the owner needs to know — we did not read the log, so nothing on
    // this screen may be taken as "nothing happened".
    if (!res.ok) throw new Error(`logboek answered ${res.status}`)

    const data: unknown = await res.json()
    const rows = (data as { entries?: unknown }).entries
    // An answer we cannot recognise is a failed read, not an empty one. Coercing it with `?? []` is
    // the single line that would turn this feature back into the thing it was built against.
    if (!Array.isArray(rows)) throw new Error('logboek answer has no entries array')
    const answer = data as Partial<LogboekAnswer>

    return {
      ok: true,
      // No per-row validation, and that is deliberate: a row this screen cannot make sense of still
      // gets rendered (log.onbekend + the raw action), because dropping it here would recreate the
      // silent gap in the middle of the trail that toLogboekEntry refuses to create.
      page: rows as LogboekEntry[],
      nextCursor: typeof answer.nextCursor === 'string' ? answer.nextCursor : null,
      spoorOnvolledig: answer.spoorOnvolledig === true,
    }
  } catch (e) {
    // Logged, because this is the branch that hides real breakage: on screen the owner learns that
    // the read failed, and here the developer learns what failed.
    console.error('[LOGBOEK] could not read the trail — refusing to render it as empty', {
      cursor,
      error: e instanceof Error ? e.message : String(e),
    })
    return { ok: false }
  }
}

export default function LogboekClient() {
  const locale = useLocale()
  const t = translator(locale)

  // The screen's name goes into the ONE shared sub-page bar, which also carries the way back.
  //
  // DashboardChrome has a static "Logboek" for this path, and that entry is what stops the bar from
  // rendering an empty strip on first paint; a title registered here WINS over it (see the
  // resolution order in that file). So the map keeps the bar from ever being nameless, and this
  // call is what makes the name follow the owner's language — the map is a plain-Dutch registry and
  // is not translated. Depending on `t` is exact: translator() caches one function per language, so
  // this re-registers when the language changes and never in between.
  useSubPageHeader({ title: t('log.titel') }, [t])

  const [status, setStatus] = useState<Status>('loading')
  const [entries, setEntries] = useState<LogboekEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [spoorOnvolledig, setSpoorOnvolledig] = useState(false)
  // Starts true because the mount effect below always reads: a first frame that says "not busy"
  // while a request is in the air is a frame the owner can act on before anything is known.
  const [busy, setBusy] = useState(true)
  // A SECOND failure state, separate from `status` on purpose: a page-two that fails must not wipe
  // the rows already read, and rows already read must not make a failure look like a success.
  const [moreFailed, setMoreFailed] = useState(false)
  const [kind, setKind] = useState<LogboekKind | null>(null)

  /** Turn one answer into the screen's state. The only place a read result becomes a claim. */
  const apply = useCallback((cursor: string | null, outcome: Outcome) => {
    if (outcome.ok) {
      setEntries((prev) => (cursor === null ? outcome.page : mergeById(prev, outcome.page)))
      setNextCursor(outcome.nextCursor)
      // Only the first page carries the completeness probe (the route only raises it there — on
      // page four "no rows by anyone else" says nothing at all), so only the first page sets it.
      if (cursor === null) setSpoorOnvolledig(outcome.spoorOnvolledig)
      setStatus('ok')
    } else if (cursor === null) {
      setStatus('failed')
    } else {
      setMoreFailed(true)
    }
    setBusy(false)
  }, [])

  /** The button path: say we are working, drop the previous alarm, read, apply. */
  const load = useCallback(async (cursor: string | null) => {
    setBusy(true)
    setMoreFailed(false)
    // A retry of the FIRST page goes back to loading, so the failure notice disappears while we are
    // actually trying again — otherwise a retry that succeeds would leave the old alarm standing.
    if (cursor === null) setStatus('loading')
    apply(cursor, await readPage(cursor))
  }, [apply])

  useEffect(() => {
    // `cancelled` and not an AbortController: the request is cheap and already in flight, and what
    // must not happen is applying its answer to a screen that has gone away.
    let cancelled = false
    void readPage(null).then((outcome) => {
      if (!cancelled) apply(null, outcome)
    })
    return () => {
      cancelled = true
    }
  }, [apply])

  // Filtering is over what is LOADED, which is why the empty sentence below is gated on nextCursor:
  // a kind with no rows on page one is not a kind with no rows.
  const visible = useMemo(
    () => (kind === null ? entries : entries.filter((e) => e.kind === kind)),
    [entries, kind],
  )

  // Text direction travels with the words. The root layout renders dir="ltr" on <html> and only a
  // language SWITCH updates it (see writeLocaleCookie), so a fresh load with an Arabic cookie would
  // otherwise lay this screen out left-to-right. Everything inside uses logical properties, so this
  // one attribute flips the whole column.
  const dir = LOCALE_META[locale].dir

  return (
    <div
      dir={dir}
      style={{
        maxWidth: COLUMN.work,
        margin: '0 auto',
        padding: '24px 16px 64px',
        fontFamily: FONT,
      }}
    >
      {/* No h1 here: the name of the screen and the way back live in the shared sub-page bar, which
          this component fills in above. Drawing it a second time would put "Logboek" on the screen
          twice — see the registration and its note near the top of this component. */}
      <header style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 14.5, color: M3.onSurfaceVariant, margin: 0, textAlign: 'start' }}>
          {t('log.uitleg')}
        </p>
      </header>

      {/* [LOGBOEK] The completeness probe. audit_logs_about_me is a migration that has to have been
          RUN; without it the owner sees only their OWN actions under a heading promising their
          bookkeeper's as well — a half trail presented as a whole one, which is the most convincing
          way this feature could fail. The route establishes it and this notice says it out loud. */}
      {spoorOnvolledig && (
        <div
          role="status"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            background: M3.warningContainer,
            border: `1px solid ${M3.warning}`,
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 16,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1.3 }}>⚠️</span>
          <span style={{ fontSize: 14, lineHeight: 1.45, color: M3.warning, textAlign: 'start' }}>
            {t('log.spoorOnvolledig')}
          </span>
        </div>
      )}

      {/* Chips only once there is something to filter. A filter row above an unread or empty log
          invites the owner to narrow a set that has no rows in it, and then to read the result. */}
      {entries.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
            marginBottom: 16,
          }}
        >
          {CHIPS.map((chip) => {
            const active = chip.kind === kind
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(chip.kind)}
                style={{
                  flexShrink: 0,
                  padding: '8px 14px',
                  borderRadius: 9999,
                  border: `1px solid ${active ? M3.primaryContainer : M3.outlineVariant}`,
                  background: active ? M3.primaryContainer : M3.surface,
                  color: active ? M3.onPrimaryContainer : M3.neutral,
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(chip.key)}
              </button>
            )
          })}
        </div>
      )}

      {/* ── State 3: the read failed. Never a list, never the empty sentence. ── */}
      {status === 'failed' && (
        <div
          role="alert"
          style={{
            background: M3.errorContainer,
            border: `1px solid ${M3.error}`,
            borderRadius: 16,
            padding: '24px 20px',
            textAlign: 'center',
          }}
        >
          <div aria-hidden="true" style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: M3.onSurface, margin: '0 0 16px' }}>
            {t('log.mislukt')}
          </p>
          {/* Borrowed from the catalogue rather than added to it: "Opnieuw proberen" is the same
              button on the same kind of failure elsewhere in the app, and a screen that can only be
              recovered by reloading the browser is a dead end on the one screen that must not have
              one. */}
          <button
            type="button"
            onClick={() => void load(null)}
            disabled={busy}
            style={{
              padding: '10px 20px',
              borderRadius: 12,
              border: 'none',
              background: M3.primary,
              color: M3.onPrimary,
              fontFamily: 'inherit',
              fontSize: 15,
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {t('inkoop.opnieuwProberen')}
          </button>
        </div>
      )}

      {/* First load in flight. Grey bars and no words: a skeleton claims nothing, while "niets
          gevonden" for half a second is the empty sentence being told before we know it is true.
          aria-busy is what carries the same fact to a screen reader. */}
      {status === 'loading' && (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 64,
                borderRadius: 12,
                background: M3.track,
                border: `1px solid ${M3.outlineVariant}`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── State 1: the rows. ── */}
      {status === 'ok' && visible.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map((entry) => {
            // hasSentence() answering yes IS the guarantee that this key is one of the 89 literal
            // MessageKeys listed in logboek.ts, which is what makes the cast safe. Answering no is a
            // real state and not an error: the action is named instead of phrased, and the row stays.
            const spoken = hasSentence(entry.action)
            const sentence = spoken ? t(entry.messageKey as MessageKey) : t('log.onbekend')

            return (
              <li
                key={entry.id}
                style={{
                  background: M3.surface,
                  border: `1px solid ${M3.outlineVariant}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  textAlign: 'start',
                }}
              >
                {/* An entry with an href opens what it is about; without one it is plain text.
                    logboek.ts only builds a link for an entity that really has a page — a dead link
                    inside an audit trail teaches the owner the trail itself cannot be trusted, at
                    the exact moment they came to it for proof. */}
                {entry.href ? (
                  <Link
                    href={entry.href}
                    style={{
                      display: 'block',
                      fontSize: 15,
                      lineHeight: 1.4,
                      color: M3.primary,
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    {sentence}
                  </Link>
                ) : (
                  <span style={{ display: 'block', fontSize: 15, lineHeight: 1.4, color: M3.onSurface }}>
                    {sentence}
                  </span>
                )}

                {/* The raw action, for a row nobody wrote a sentence for. Quiet and mono because it
                    is a NAME and not a sentence — the owner is not meant to read it, they are meant
                    to be able to quote it. dir="ltr" isolates it: an ASCII identifier dropped into an
                    Arabic line gets reordered by the bidi algorithm otherwise. */}
                {!spoken && (
                  <code
                    dir="ltr"
                    style={{
                      display: 'inline-block',
                      marginTop: 3,
                      fontFamily: FONT_NUM,
                      fontSize: 12,
                      color: M3.mutedText,
                    }}
                  >
                    {entry.action}
                  </code>
                )}

                <div
                  style={{
                    marginTop: 4,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {/* dir="ltr" for the same reason as the action name: "18-08-2026 14:32" is a run of
                      digits and neutral punctuation, and an unisolated one lands scrambled in RTL. */}
                  <time
                    dir="ltr"
                    dateTime={entry.at ?? undefined}
                    style={{ fontSize: 12.5, color: M3.mutedText, fontFamily: FONT_NUM }}
                  >
                    {stamp(entry.at)}
                  </time>
                  {/* The reason this screen exists: an action performed by someone else in the
                      owner's administration. Marked, never named — see the header. */}
                  {entry.byOther && (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: M3.tertiaryContainer,
                        color: M3.tertiary,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('log.doorAnder')}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* ── State 2: read, and there is genuinely nothing. ──
          Gated on nextCursor as well as on the list: with a page still outstanding, "nothing here"
          would be a statement about our paging wearing the words of a statement about the
          administration. Under an active chip it reads as "nothing of this kind", which is exactly
          what it is — the chip that scoped it is on screen directly above the sentence. */}
      {status === 'ok' && visible.length === 0 && nextCursor === null && (
        <p
          style={{
            textAlign: 'center',
            fontSize: 14.5,
            color: M3.onSurfaceVariant,
            padding: '40px 16px',
            margin: 0,
          }}
        >
          {t('log.leeg')}
        </p>
      )}

      {/* A page that failed to load. The rows already read stay exactly where they are — they were
          read honestly — and the button stays so the owner can try again. Silence here would mean
          "that was everything", which is the same lie this file opens with. */}
      {moreFailed && (
        <p
          role="alert"
          style={{
            marginTop: 16,
            marginBottom: 0,
            padding: '12px 14px',
            borderRadius: 12,
            background: M3.errorContainer,
            border: `1px solid ${M3.error}`,
            fontSize: 14,
            lineHeight: 1.45,
            color: M3.onSurface,
            textAlign: 'start',
          }}
        >
          {t('log.mislukt')}
        </p>
      )}

      {status === 'ok' && nextCursor !== null && (
        <button
          type="button"
          onClick={() => void load(nextCursor)}
          disabled={busy}
          aria-busy={busy}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 16,
            padding: '12px 16px',
            borderRadius: 12,
            border: `1px solid ${M3.outlineVariant}`,
            background: M3.surface,
            color: M3.primary,
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {t('log.meer')}
        </button>
      )}
    </div>
  )
}
