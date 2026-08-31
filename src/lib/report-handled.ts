// src/lib/report-handled.ts
// [ALARM] Een fout die de app netjes heeft opgevangen, en die tóch iemand moet bereiken.
//
// ── WAAROM DIT BESTAAT ──
// Sentry staat al aan, en goed: onafgevangen fouten komen binnen, en instrumentation.ts geeft
// onRequestError door, dus een route die klapt is zichtbaar. Maar dit product is er bijna helemaal
// op gebouwd om NIET te klappen. De hele week is besteed aan poorten die netjes weigeren: een lees
// die niet kon draaien, een dubbelcheck die niet liep, een boeking die is tegengehouden, een
// invariant die is scheefgetrokken. Elk daarvan doet precies wat het hoort te doen — het vangt de
// fout op, zegt het in het Nederlands tegen de ondernemer, en logt een regel.
//
// Er wordt dus GEEN exception gegooid. Sentry ziet niets. Die regel gaat naar de runtime-logs van
// het platform, waar niemand kijkt, en dat is precies de klasse waar dit hele codebestand zijn
// commentaar aan besteedt: een probleem dat is opgemerkt en aan niemand verteld.
//
// 66 van zulke plekken zijn er op de geldlijn. Dit is het kanaal dat de gevaarlijkste ervan
// hoorbaar maakt.
//
// ── WAAROM NIET ALLES ──
// Alle 339 console.error's doorzetten maakt van Sentry een tweede logbestand, en een alarm dat
// altijd afgaat is geen alarm. Hier gaan alleen de gevallen doorheen waarvan de code ZELF al zegt
// dat de toestand niet hoort te bestaan: een geldinvariant die scheef staat, een factuur die als
// betaald geldt zonder bankregel, een functie die stilletjes uit staat. De rest blijft een logregel
// — bewust, en genoemd in de audit zodat het een keuze is en geen vergeetpunt.

import * as Sentry from "@sentry/nextjs";

/**
 * Hoe erg is dit?
 *
 * `data-integrity` — de boekhouding klopt op dit moment niet meer, of kan niet meer kloppen zonder
 *                    dat iemand ingrijpt. Dit is de reden dat dit bestand bestaat.
 * `gate-unavailable` — een controle kon niet draaien. Er is (nog) niets fout, maar een beveiliging
 *                    die de app normaal biedt, heeft deze keer niet gedraaid.
 * `feature-off`    — een functie staat stil zonder dat iemand dat heeft besloten (ontbrekende
 *                    configuratie, een migratie die niet is toegepast).
 */
export type HandledSeverity = "data-integrity" | "gate-unavailable" | "feature-off";

const SENTRY_LEVEL: Record<HandledSeverity, "fatal" | "error" | "warning"> = {
  "data-integrity": "fatal",
  "gate-unavailable": "warning",
  "feature-off": "error",
};

/**
 * Log het, én meld het.
 *
 * De console-regel blijft exact zoals hij was — die is bruikbaar bij het lezen van een runtime-log
 * en bij lokaal debuggen. Wat erbij komt is het Sentry-bericht, met de tag als eigen dimensie zodat
 * er per soort een alert op te zetten is.
 *
 * Nooit gooiend: dit is het kanaal voor fouten die al zijn opgevangen. Als Sentry zelf stukgaat mag
 * dat de weigering die net correct is uitgevoerd niet alsnog omzetten in een crash — dan zou het
 * melden van een probleem een groter probleem maken dan het probleem.
 */
export function reportHandledFailure(input: {
  /** De marker die al in de logregel stond, bv. "PARTIAL-PAY". Wordt een Sentry-tag. */
  tag: string;
  /** Dezelfde zin als in de log — geschreven voor een mens die om 3 uur 's nachts gewekt wordt. */
  message: string;
  severity: HandledSeverity;
  /** Ids en waarden om het terug te vinden. Nooit bedragen van klanten hierin — zie beforeSend. */
  context?: Record<string, unknown>;
}): void {
  const { tag, message, severity, context } = input;
  console.error(`[${tag}] ${message}`, context ?? {});
  // [STORINGSBEELD] …en een streepje in de tabel die de beheerpagina leest. ALLEEN tag en ernst:
  // geen message, geen context. Zie system_events.sql — drie kolommen kunnen niets lekken, en de
  // vraag die die pagina stelt ("welke storing, hoe vaak, wanneer voor het laatst") heeft de tekst
  // niet nodig. De zin staat hierboven in de log en hieronder in Sentry, waar de toegang bij past.
  //
  // Losgelaten met opzet: deze functie is void en wordt aangeroepen middenin foutafhandeling. Erop
  // wachten zou de melding traag maken; hem laten gooien zou de kop van dit bestand breken —
  // melden mag nooit de oorzaak van een tweede storing worden.
  void recordSystemEvent(tag, severity);
  try {
    Sentry.captureMessage(`[${tag}] ${message}`, {
      level: SENTRY_LEVEL[severity],
      tags: { handled: "true", boekbrug_tag: tag, severity },
      extra: context,
    });
  } catch {
    // Zie de kop: melden mag nooit de oorzaak van een tweede storing worden.
  }
}

/**
 * Write the bare fact — which tag, how severe, when — to system_events.
 *
 * Never throws, never awaited by the caller, and deliberately carries NOTHING else. A missing table
 * (the migration ships after the code) is not a failure: the log and Sentry already have the event.
 */
async function recordSystemEvent(tag: string, severity: HandledSeverity): Promise<void> {
  try {
    const { createPipelineClient } = await import("./supabase-pipeline");
    // system_events staat niet in de gegenereerde types (handmatig toegepaste migratie) — dezelfde
    // versoepelde cast die cron_runs en btw_filings gebruiken.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createPipelineClient() as any).from("system_events").insert({ tag, severity });
  } catch {
    // Zie de kop van dit bestand.
  }
}
