# UX-review BoekBrug — juli 2026

*Wat er onderzocht is, wat er veranderd is, en wat er bewust niet.*

De vraag was: het moet soepel aanvoelen, zoals HyperOS op een Poco F6 Pro.

Dat gevoel komt niet van het uiterlijk van Xiaomi. Het komt van drie dingen, in
deze volgorde:

1. **Reageert het meteen op mijn vinger?**
2. **Zie ik dat er iets komt?**
3. **Is het overal hetzelfde?**

Op alle drie stond de app op nul. Niet door slechte smaak — de vormtaal is
Material 3 met Google-kleuren en Roboto, en dat is voor deze klant precies goed,
want de boekhouder werkt in Google Workspace en de app leest daar als een
verlengstuk van. Er zat alleen geen beweging in, geen antwoord op aanraking, en
geen gedeelde bron voor de details.

Zie ook: `docs/MOTION_SYSTEM.md` (de conventies die hieruit volgden),
`docs/HEADER_SYSTEM.md` (de balken).

---

## Wat er niet veranderd is, en waarom

- **De vormtaal.** Material 3, Google-blauw `#1a73e8`, Roboto, Material Symbols.
  Van HyperOS is alleen de *soepelheid* overgenomen, niet de vormtaal.
- **De service worker cachet nog steeds niets** (`public/sw.js`). Dat is een
  bewuste keuze voor een auth-zware financiële app en levert geen snelheidswinst
  op — maar de kans op het tonen van andermans cijfers weegt zwaarder.
- **`force-dynamic` op 58 plekken.** Dat had aangepakt kunnen worden met Cache
  Components en `unstable_instant` (Next 16), maar dat is een architecturale
  ingreep aan de datalaag, geen UX-pass. Zie "Wat er nog ligt".
- **De onboarding navigeert nog met `window.location`.** Bij het afronden
  verandert de rol in het profiel, en een harde herlaadbeurt garandeert dat de
  server dat ziet. De winst van een zachte navigatie weegt daar niet op tegen de
  kans om op een dashboard te landen met een verouderd profiel.
- **Radius 8 op kleine bedieningen.** Kaarten zijn gelijkgetrokken op 16; een
  chip of een klein knopje hoort geen kaart te worden.

---

## Fase 0 — Dingen die het scherm zei maar nooit tekende

| Wat | Gevolg |
|---|---|
| Kwartaaloverzicht gebruikte 58 shadcn-klassenamen (`bg-background`, `bg-muted`, `text-muted-foreground`) die dit project nooit definieerde | In Tailwind 4 bestaat een utility alleen als de `--color-*` bestaat. Kaarten doorzichtig, gedempte tekst in body-kleur, **laadskeletten onzichtbaar** |
| Tailwind 4 veranderde de standaard randkleur naar `currentColor` | Elke kale `border` op dat scherm tekende een bijna-zwarte lijn |
| `viewport-fit` stond niet op `cover` | Negen plekken rekenden met `env(safe-area-inset-*)`, en alle negen kregen `0` terug. Al dat werk stond er en deed niets |
| De home-balk had als enige geen inset | Schoof onder de notch in standalone PWA |
| `autorenew` stond niet in de gesubsette icoonlijst | Op twee plekken in Mijn facturen stond het woord "autorenew" |

---

## Fase 1 — De app luisterde wel, maar liet dat nooit merken

**Het grootste probleem was onzichtbaar.** De basisregel voor `<button>` in
`globals.css` stond op `!important`, en een `!important` in een stylesheet
verslaat een normale inline style. Gemeten in Chromium:

| | met `!important` | zonder |
|---|---|---|
| inline `border-radius: 999px` | **12px** | 999px |
| inline `transition: .4s cubic-bezier(…)` | **`opacity .15s ease`** | blijft |
| knop die niets opgeeft | 12px | 12px |

Ongeveer 350 knoppen vroegen om iets anders dan de opgelegde 12px: 95 pilknoppen,
19 op 999, 17 op 9999, 14 ronde icoonknoppen op 50%. Allemaal getekend als
hetzelfde rechthoekje. De verende tegeldruk op beide startschermen stond
geschreven en heeft nooit gelopen.

Verder:

- **Geen feedback op aanraking.** Hover werd geschilderd met
  `onMouseEnter`/`onMouseLeave` — events die een vinger nooit afvuurt. Op een
  telefoon gaf de terugknop, het meest aangeraakte element van de app, niets
  terug tussen de tik en het volgende scherm. Dat wachten leest als traagheid,
  ook als de server snel is.
- **Dertien plekken deden de druk met `onMouseDown`/`onMouseUp`** — vuren niet op
  aanraking, en bij loslaten buiten het element bleef de tegel op `scale(0.96)`
  hangen.
- **113 inline transitions in 41 bestanden**, geen twee gelijk. Geen bron voor
  duur of easing.
- **`spin` bestond vijf keer onder vijf namen**, `shimmer` drie keer, de
  toaststijging twee keer. Elke kopie in een andere bundle.
- **Zes eigen toasts**, op 24/32/40/90px van de onderrand, geen ervan
  voorgelezen, geen ervan langs de home-indicator, en elk gebonden aan zijn eigen
  scherm — dus een handeling die navigeerde verloor zijn eigen bevestiging.
- **37 browservensters** (22 `alert`, 13 `confirm`, 2 `prompt`) op precies de
  zwaarste beslissingen: een boekhouder loskoppelen, de prullenbak definitief
  legen, een banktransactie koppelen aan een mogelijk al geboekte factuur — die
  laatste als `"Mogelijk dubbel.\n\nToch koppelen?"`, vraag en reden in één blok.
  De vraag van de boekhouder aan zijn klant werd in een `window.prompt` getypt:
  één regel, terwijl iemand anders het op zijn eigen scherm leest.

De druk gebruikt nu de losstaande eigenschap `scale` in plaats van `transform`,
zodat ze stapelt op een transform die er al staat — en geen `!important` nodig
heeft, want niets anders in de app zet `scale`.

**Twee stille fouten kwamen onderweg boven:** het kwartaalscherm draaide een
optimistische statuswijziging terug zonder één woord (op een scherm dat beweert
wat er gecontroleerd is), en twee bestanden hadden een eigen functie `confirm`
die `window.confirm` voor de hele module afdekte.

---

## Fase 2 — Veertig schermen die niets zeiden tijdens het wachten

**Nul `loading.tsx` tegenover veertig dashboardroutes**, waarvan de meeste
`force-dynamic`. Elke tik hield de OUDE pagina roerloos op het scherm tot de
server met de nieuwe kwam. Foutgrenzen waren er overal, laadtoestanden nergens —
precies de omgekeerde volgorde van wat snelheid laat voelen.

- 21 routes hebben nu een skeleton met de vorm en containerbreedte van hun eigen
  pagina, zodat er niets opzij schuift als de inhoud landt. Servercomponenten:
  geen JavaScript nodig om te verschijnen.
- `src/components/ui/Skeletons.tsx` had zes exports en één importeur. De nieuwe
  `PageSkeleton` bouwstenen zijn wat de routes daadwerkelijk gebruiken.
- **View Transitions** aan: terug schuift naar rechts, dieper naar links. De
  richting wordt niet geraden — de gedeelde terugknop en `BackLink` markeren hun
  navigatie als retour, en die twee zijn de enige bron van "terug" in de app. De
  balk blijft stilstaan (`viewTransitionName: 'page-header'`).
- **Vijf `window.location.reload()`** gooiden het hele document weg — bundle,
  scrollpositie, open tabblad, uitgeklapte kaart — voor data die
  `router.refresh()` ook ophaalt.

### En iets wat niet in de opdracht zat

De **publieke kopbalk** zette vijf links op één rij die niet afbrak en niet
inklapte. Op 390px mat die balk 385px vanaf x=104: **99 pixels voorbij de
rechterrand, met de enige conversieknop van de site buiten beeld.** Op elke
landingspagina, elke rekenhulp, elk artikel — precies waar een eerste bezoek
binnenkomt, meestal op een telefoon. Nagemeten: het stond er al vóór dit werk.

Nu: onder 640px stappen de drie bladerlinks opzij (ze staan in elke voettekst),
onder 480px halveert de marge en laat de knop zijn laatste woord vallen, onder
360px levert het woordmerk drie punten in. Van 320px tot desktop past alles.

---

## Fase 3 — Groen dat je niet kon lezen, in dertien kopieën

Dertien schermen hadden elk hun eigen `const M3 = {…}`, en de notitie in
`tokens.ts` zei dat afwijkende schermen bewust niet gemigreerd waren "want
importeren zou hun kleur veranderen". Hun kleur veranderen bleek het punt:

| token | lokaal | contrast op wit | gedeeld | contrast |
|---|---|---|---|---|
| `success` | `#34A853` | **3,06:1** ✗ | `#137333` | 5,95:1 ✓ |
| `warning` | `#E37400` | **3,10:1** ✗ | `#7C5800` | 6,46:1 ✓ |
| `error` (los in code) | `#EA4335` | **3,92:1** ✗ | `#B3261E` | 6,54:1 ✓ |

Zes schermen gebruikten het lichte groen, zeven het lichte amber, en verscheidene
gebruikten ze voor **tekst**: een ontvangst in het kasboek, koppelbevestigingen
in Bank, een knoplabel in Inkoopfacturen. Op het kwartaalscherm van een klant
stonden **Omzet en Kosten** in die kleuren, op 14px — gewone tekst, dus 4,5:1
vereist. Het verraderlijke: dezelfde bestanden schreven een paar regels verderop
letterlijk `'#137333'` neer, daar waar de auteur het toevallig wél opmerkte.

Het lichte groen en amber zijn niet weg — ze heten `successFill` / `warningFill`
en zijn voor een vlak, een stip, een balk, waar 3:1 volstaat.

Daarnaast keken de twee helften van de app elkaar niet aan: een kaart op de
boekhouderskant was 8px met een grijze lijn en geen schaduw, dezelfde kaart op de
ondernemerskant 16px met schaduw en geen lijn. Vijftien kaartcontainers
gelijkgetrokken. En de drie emoji in de chrome (🔔 💬 ⚙️) zijn Material Symbols
geworden — ze stonden op élke pagina, in een app die verderop consequent een
gesubsette icoonfont gebruikt.

---

## Fase 4 — Op een telefoon was er geen navigatie

De tekstlinks in de bovenbalk verdwijnen onder 640px omdat ze met het zoekveld
botsten. Er kwam niets voor in de plaats. De enige manieren om je te verplaatsen
waren het logo, de terugknop van de browser, en welke tegels de startpagina
toevallig liet zien.

Nu een Material 3 navigatiebalk, alleen op de telefoon, vier bestemmingen per
rol, op dezelfde grens waarop de boventekstlinks verdwijnen. Zijn hoogte reist
mee als `--bottom-nav-h` (0px op een breed scherm), zodat 16 bottom-ankers in één
uitdrukking op beide maten kloppen. Het actieve tabblad krijgt de M3-pil, niet
alleen een kleur — kleur alleen is onzichtbaar voor wie rood en groen niet
onderscheidt en valt als eerste weg in de zon.

Dertien wis-kruisjes van 19–22px hebben een aanraakvlak van 44px zonder dat hun
uiterlijk verandert.

---

## Een patroon dat drie keer toesloeg

De cascade, in twee richtingen, en beide keren onzichtbaar:

1. **`!important` in een stylesheet verslaat een inline style.** Zo verloren ~350
   knoppen hun vorm en al hun beweging.
2. **Een inline style verslaat een klasseregel.** Zo deden de media queries van
   de publieke CTA niets (maat en padding stonden inline), en zo bleef de
   bottom-navigatie op desktop in beeld (`display: flex` stond inline).

Vandaar de regel in `MOTION_SYSTEM.md`: geen `!important` op een gedeelde
elementregel, en alles wat een media query moet kunnen veranderen hoort in CSS,
niet inline.

En daarom is elke bewering hier nagemeten in een echte browser (Chromium via
Playwright) in plaats van uit de specificatie afgeleid. Drie van de bevindingen
in dit document — de radius van 12px, de lege bewegings-tokens, de balk op
desktop — waren met lezen alleen niet te vinden.

**Tailwind 4 knipt bovendien `@theme`-variabelen weg die geen enkele gegenereerde
utility gebruikt.** Drie bewegings-tokens losten daardoor op als lege string in
de browser. Ze staan nu in `:root`.

---

## Wat er nog ligt

Op volgorde van wat het meeste oplevert:

1. **Cache Components + `unstable_instant`** (Next 16). De skeletten dekken het
   wachten af; dit haalt het wachten wég. Raakt de datalaag, dus een eigen
   traject — `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`
   is het startpunt.
2. **Optimistische updates** (`useOptimistic`) op de handelingen die het vaakst
   herhaald worden: een factuur op betaald zetten, een banktransactie
   bevestigen, een bon categoriseren. Nu wacht elk van die tikken op het netwerk
   voor er iets beweegt.
3. **De onboarding-wizard** is 985 regels in één component met een handgebouwde
   stapmachine (inclusief sub-stappen `"3A"/"3B"/"3C"`) en wisselt van stap
   zonder enige overgang. Voor een meerstapsflow is dat de meest zichtbare
   gemiste beweging die er nog is.
4. **Login en register zijn geen `<form>`.** Enter werkt alleen vanuit het
   wachtwoordveld, mobiele toetsenborden krijgen geen "Ga"-toets
   (`enterKeyHint` staat nergens).
5. **Nog vier of vijf zoekvelden, drie kwartaalkiezers en zes vormen van
   "niets hier"** zijn nog per pagina gebouwd. Gedeelde componenten daarvoor
   zouden de laatste zichtbare inconsistenties opruimen.
6. **Op 280px** (de buitenkant van een Fold) loopt de inhoud van de rekenhulpen
   nog 5px over. De kopbalk past daar wel.
7. **De `screenshots` in het manifest** ontbreken, waardoor het
   installatiedialoog op Android minimaal blijft.
