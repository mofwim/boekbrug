// src/lib/alleen-eigenaar.ts
// [NAMENS] De grendel op alles wat een verkoopmedewerker (nog) NIET mag.
//
// WAAROM DIT BESTAAT, EN WAAROM HET GEEN LUIHEID IS
//
// Een verkoopmedewerker mag precies twee dingen: een factuur maken en hem versturen. Die twee
// paden zijn omgebouwd om NAMENS de eigenaar te werken — één nummerreeks, sender_id van de baas,
// created_by als spoor.
//
// De rest van de factuur-API's is dat NIET. Ze gaan er allemaal van uit dat de ingelogde mens de
// eigenaar van de boekhouding is: /api/invoice/creditnota, /duplicate, /archive, /pay-toggle,
// /numbering, /betaalverzoek, /schedules. Zou een medewerker daar binnenkomen, dan zou een
// creditnota in ZIJN nummerreeks belanden — precies de fout waar deze hele bouw over gaat, alleen
// dan via een achterdeur.
//
// Twee manieren om daarmee om te gaan:
//   1. alle zeven routes ombouwen — meer oppervlak, meer kans op een fout in een pad dat vandaag
//      niemand nodig heeft;
//   2. ze dichtzetten voor een medewerker, met een zin die zegt waarom.
//
// Dit is 2, met opzet. Het is een BEWUSTE grens, geen vergeten geval: een medewerker die op
// "creditnota" tikt hoort te lezen dat zijn baas dat doet, niet stilzwijgend een tweede
// nummerreeks te openen. Wordt zo'n functie later voor hem opengezet, dan is dat één route
// tegelijk — met dezelfde behandeling als send: ownerId erin, created_by als spoor, en een test.

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
