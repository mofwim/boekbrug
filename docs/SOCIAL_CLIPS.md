# Clips voor social — wat er klaarstaat en hoe je het maakt

`npx tsx scripts/record-clips.mts` maakt verticale schermopnames van de app. Geen opnameprogramma,
geen montage: het pad staat in code, en één commando maakt alles opnieuw.

```bash
npx next build && npx next start -p 3100        # in één shell
npx tsx scripts/record-clips.mts                # in een andere
```

Uitvoer: `store-assets/clips/*.mp4`, 1080×1920, H.264 — het formaat dat Reels, Shorts en TikTok
native tonen.

## Waarom gegenereerd en niet gefilmd

Een productvideo veroudert stil. Hij blijft staan waar hij is gepost, blijft een scherm tonen dat
niet meer bestaat, en niemand merkt het. Dat is precies wat `capture-screenshots.mjs` voor de
storefoto's oploste — dit is dezelfde machine met beweging erbij. Verandert een scherm, dan draai je
het commando opnieuw en zijn alle clips weer waar.

## De demo-administratie, nooit een echte

Een video verraadt méér dan een foto: scrollen toont rijen, een autocomplete toont klantnamen, het
bankscherm toont IBAN's en omschrijvingen. `scripts/seed-demo-account.sql` maakt een tenant van
verzonnen gegevens voor precies dit doel — dezelfde die Play Console als testaccount wil.

```bash
SHOT_EMAIL=demo@boekbrug.nl SHOT_PASSWORD=BoekBrugDemo2026! npx tsx scripts/record-clips.mts
```

Zonder die twee variabelen draaien alleen de vier publieke clips. Die hebben geen account nodig en
draaien overal — ook op een CI-doos die de Supabase-host niet mag bereiken (inloggen gebeurt in de
BROWSER, dus die moet erbij kunnen; zie dezelfde noot in `PLAY_STORE_LISTING.md`).

## Twee soorten clip, en het verschil is niet cosmetisch

| | Werving (01–04) | Uitleg (05–06) |
| --- | --- | --- |
| Voor wie | iemand die de app niet heeft | iemand die hem al heeft |
| Begint bij | een probleem | een scherm |
| Waar | Reels, Shorts, TikTok, LinkedIn | in de app, de kennisbank, YouTube |
| Lengte | 9–15 seconden | mag langer |

Op social wil niemand een rondleiding langs knoppen van software die hij niet gebruikt. Daarom
beginnen 01–04 bij een vraag die de kijker zelf heeft, en laten ze het antwoord zien in plaats van
het uit te leggen. De uitleg-clips zijn ook nuttig — maar niet dáár.

## Onderschriften, niet gesproken tekst

De meeste mensen kijken zonder geluid. De tekst staat daarom IN het beeld, in het merklettertype,
en is niet weg te klikken. Muziek eronder mag; een stem is een extra, geen drager.

En als er ooit een stem komt: één Nederlandse stem, geen synthetische. Dit is een boekhoudapp — de
Nederlandse ondernemer die dit hoort beslist in twee seconden of dit een serieus product is.

## De vier die klaarstaan, met de tekst voor eronder

Kort, geen hashtag-muur, en de laatste regel is altijd dezelfde vraag: probeer het zelf.

**01 · BTW berekenen** — 9 s
> Hoeveel btw zit er op € 1.000?
>
> € 210 erbij, € 1.210 totaal. Zonder account, zonder je bestand ergens heen te sturen — het rekenen
> gebeurt in je eigen browser.
>
> boekbrug.nl/btw-berekenen

**02 · Uurtarief** — 12 s
> "Wat moet ik per uur vragen?"
>
> De meeste zzp'ers rekenen hun jaardoel door 2.080 uur. Dat is precies te weinig: vakantie, ziekte
> en de uren die je niet kunt factureren zitten er niet in. Dit rekent ze wél mee.
>
> boekbrug.nl/uurtarief-berekenen

**03 · Kilometervergoeding** — 9 s
> 4.200 zakelijke kilometers = € 1.050 aftrekbaar.
>
> € 0,25 per kilometer in 2026. Reken je eigen jaar na — het duurt tien seconden en het staat op je
> aangifte.
>
> boekbrug.nl/kilometervergoeding

**04 · Factuur maken** — 15 s
> Een factuur die klopt, zonder programma.
>
> Jij, je klant, je regels. Btw en totaal rekenen zichzelf uit, en je downloadt de PDF. Geen account
> — je gegevens blijven in je browser zolang je er geen maakt.
>
> boekbrug.nl/factuur-maken

## Waar te posten

- **LinkedIn** is voor dit publiek waarschijnlijk het sterkst: Nederlandse zzp'ers én de boekhouders
  die met ze werken. De PDF-deck uit `scripts/generate-deck.mts` werkt daar als carrousel; deze
  clips als losse video.
- **Instagram / TikTok** — 01 en 03 zijn het kortst en het makkelijkst te delen.
- **In de app en de kennisbank** — 05 en 06, naast de functie die ze uitleggen.

Lees eerst de regels van een groep voordat je erin post. Een clip op een plek waar promotie niet
welkom is kost meer dan het bereik oplevert.

## Een nieuwe clip toevoegen

Eén item in `CLIPS` in `scripts/record-clips.mts`: een pad, een openingszin, en een `run` die de
pagina echt bedient. `say()` zet een onderschrift, `type()` typt met een menselijk ritme. Zet
`auth: true` als de clip een sessie nodig heeft.

Twee dingen die uit meten zijn gekomen en die je niet zelf hoeft te ontdekken:

- **De opname begint bij het aanmaken van de context**, dus het laden van de pagina staat vooraan in
  het bestand — soms twaalf seconden wit beeld. Dat wordt er automatisch afgeknipt door te KIJKEN
  waar het beeld begint (`negate,blackdetect`), niet door het te berekenen; twee pogingen om het uit
  te rekenen zaten er allebei naast.
- **Scroll naar een element, niet naar een aantal pixels.** Een vast getal schoot voorbij het totaal
  en liet de factuurclip eindigen op de uitleg onderaan de pagina in plaats van op het bedrag dat
  zojuist was uitgerekend.
