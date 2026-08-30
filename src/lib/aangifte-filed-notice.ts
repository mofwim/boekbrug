// src/lib/aangifte-filed-notice.ts
// [AANGIFTE-INGEDIEND] Wat er boven de berekening staat als het kwartaal al is ingediend. Puur.
// Run: npx tsx --test src/lib/aangifte-filed-notice.test.ts
//
// ── WAAROM DIT EEN EIGEN MODULE IS ──
//
// De banner maakt VIER uitspraken uit twee tekens: het saldo van wat is ingediend (betalen of
// terugkrijgen) en het verschil met de huidige berekening (erbij of eraf). Die vier stonden als
// geneste ternaries in de JSX, en één verkeerd gekozen sleutel zegt daar "te betalen" boven een
// bedrag dat de ondernemer juist terugkrijgt. Dat is geen opmaakfout maar een verkeerde uitspraak
// over geld, op het scherm dat hij opent om te zien of zijn ingediende aangifte nog klopt.
//
// AGENTS.md noemt precies deze vorm: de tekst hoort in een pure module, het component rendert wat
// het krijgt. Zo is de keuze te testen zonder iets te renderen — en de banner zit achter een fetch,
// dus de render-poort komt er nooit bij.
//
// ── WAAROM HELE ZINNEN EN GEEN SAMENGESTELDE ──
//
// Hier stond `t('aang.jeHebt')` gevolgd door het letterlijke 'te betalen'. Dat werkt alleen in het
// Nederlands: het Arabisch zet de woorden anders neer en het Turks hangt een achtervoegsel aan het
// bedrag. En de helft die niet in de catalogus staat, blijft in élke taal Nederlands. Elke zin
// heeft daarom een eigen sleutel, met de richting erin verwerkt in plaats van erachter geplakt.

import type { MessageKey } from "./i18n/messages";

/** Wat de banner van de ingediende aangifte weet. Alleen dit; de rest gaat hem niet aan. */
export interface FiledFacts {
  /**
   * Het ingediende 5g-saldo. >= 0 betekent te betalen, < 0 terug te ontvangen — dezelfde afspraak
   * die de rest van dit product hanteert.
   */
  saldo: number;
  /**
   * Het verschil tussen de HUIDIGE berekening en wat er is ingediend. 0 = nog gelijk.
   * Positief = er komt bij, negatief = er gaat af.
   */
  delta: number;
}

/** Eén regel van de banner: een sleutel plus het bedrag dat erin hoort. */
export interface FiledLine {
  key: MessageKey;
  /** De parameter die de zin verwacht. Altijd een MAGNITUDE — de richting zit in de sleutel. */
  bedrag: number;
}

export interface FiledNotice {
  /** De kop: "Dit kwartaal is al ingediend (datum)". */
  titelKey: MessageKey;
  /**
   * De regels eronder, in volgorde. Bij gelijkheid is dat er één; bij een verschil drie — wat er
   * is ingediend, wat er nu bij of af komt, en waar de ondernemer dat beslist.
   */
  lines: FiledLine[];
  /** Wijkt de huidige berekening af? Bepaalt de kleur, niet de woorden. */
  diverges: boolean;
}

/** Een halve cent: dezelfde marge als de rest van het geldvocabulaire in dit product. */
const EPSILON = 0.005;

/**
 * De banner, als sleutels.
 *
 * Geen opmaak, geen euro's, geen datum — het component zet die erin. Wat hier wordt beslist is de
 * enige vraag die fout kán: WELKE zin.
 */
export function filedNotice(facts: FiledFacts): FiledNotice {
  const saldo = Number(facts.saldo) || 0;
  const delta = Number(facts.delta) || 0;
  // Gelijk = binnen een halve cent. Een verschil van € 0,001 als "er komt bij" melden zou de
  // ondernemer naar de Waarheid-pagina sturen voor stof.
  const diverges = Math.abs(delta) > EPSILON;

  if (!diverges) {
    return {
      titelKey: "aang.ingediend.titel",
      lines: [{
        key: saldo >= 0 ? "aang.ingediend.gelijk.betalen" : "aang.ingediend.gelijk.terug",
        bedrag: Math.abs(saldo),
      }],
      diverges: false,
    };
  }

  return {
    titelKey: "aang.ingediend.titel",
    lines: [
      // Wat er is INGEDIEND — het teken van het saldo, niet van het verschil.
      { key: saldo >= 0 ? "aang.ingediend.aangifte.betalen" : "aang.ingediend.aangifte.terug", bedrag: Math.abs(saldo) },
      // Wat de huidige gegevens daaraan veranderen — het teken van het VERSCHIL. Dat de twee
      // tekens onafhankelijk zijn is precies waarom dit vier zinnen zijn en geen twee: een
      // teruggaaf die kleiner wordt en een betaling die groter wordt zijn allebei "+", en het is
      // niet dezelfde mededeling.
      { key: delta > 0 ? "aang.ingediend.verschil.bij" : "aang.ingediend.verschil.af", bedrag: Math.abs(delta) },
      { key: "aang.ingediend.beslis", bedrag: 0 },
    ],
    diverges: true,
  };
}
