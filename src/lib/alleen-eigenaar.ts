// src/lib/alleen-eigenaar.ts
// [NAMENS] De grendel op alles wat een verkoopmedewerker (nog) NIET mag.
//
// WAAROM DIT BESTAAT, EN WAAROM HET GEEN LUIHEID IS
//
// Een verkoopmedewerker moet zijn werk AF kunnen maken. Die hele levensloop is omgebouwd om
// NAMENS de eigenaar te werken — één nummerreeks, sender_id van de baas, created_by als spoor:
// maken (draft), bewerken en weggooien ([id]), versturen (send), herinneren (reminder),
// dupliceren (duplicate) en corrigeren (creditnota).
//
// De rest van de factuur-API's is dat NIET, en hoeft dat ook niet te zijn. Ze gaan er allemaal
// van uit dat de ingelogde mens de eigenaar van de boekhouding is, en ze gaan over dingen die
// buiten het factureren vallen: /numbering (verandert de reeks van het hele bedrijf),
// /pay-toggle (raakt de geldwaarheid en de bankafstemming), /schedules (een doorlopende
// verplichting), /archive (een factuur uit de boeken halen), /betaalverzoek, /supersede,
// /multi-invoice, /payment/move. Zou een medewerker daar binnenkomen, dan boekt hij onder ZIJN
// eigen id — precies de fout waar deze hele bouw over gaat, alleen dan via een achterdeur.
//
// Twee manieren om daarmee om te gaan:
//   1. alle zeven routes ombouwen — meer oppervlak, meer kans op een fout in een pad dat vandaag
//      niemand nodig heeft;
//   2. ze dichtzetten voor een medewerker, met een zin die zegt waarom.
//
// Dit is 2, met opzet. Het is een BEWUSTE grens, geen vergeten geval: een medewerker die op
// "nummering wijzigen" tikt hoort te lezen dat zijn baas dat doet, niet stilzwijgend de reeks van
// het hele bedrijf te verzetten. Wordt zo'n functie later voor hem opengezet, dan is dat één
// route tegelijk — met dezelfde behandeling als send: ownerId erin, created_by als spoor, en een
// regel in de OMGEBOUWD-lijst van namens-poorten.test.ts erbij.

import { NextResponse } from "next/server";
import { getActingFor } from "@/lib/acting-for-server";
import { isNamens, type ActingFor } from "@/lib/acting-for";

/**
 * Geeft de acting-for terug als de sessie van een EIGENAAR is, anders een kant-en-klaar antwoord.
 *
 * Gebruik:
 *   const w = await vereisEigenaar()
 *   if (w.antwoord) return w.antwoord
 *   const acting = w.acting!
 */
export async function vereisEigenaar(
  wat = "Dit",
): Promise<{ acting?: ActingFor; antwoord?: NextResponse }> {
  const acting = await getActingFor();
  if (!acting) {
    return { antwoord: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (isNamens(acting)) {
    return {
      antwoord: NextResponse.json(
        {
          error: `${wat} kan alleen de eigenaar van de administratie doen. Jij maakt en verstuurt facturen; vraag je werkgever om dit te doen.`,
        },
        { status: 403 },
      ),
    };
  }
  return { acting };
}
