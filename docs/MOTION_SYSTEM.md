# BoekBrug — Motion System

*Hoe dingen bewegen, en waarom. Eén bron voor duur, easing, feedback en de
gedeelde overlays (snackbar, dialoog).*

Zie ook: `docs/HEADER_SYSTEM.md` (de balken), `docs/UX_REVIEW_2026.md` (waar dit
vandaan komt).

---

## 1. De regel

> **Beweging legt uit wat er veranderde. Ze is nooit het wachten waard.**

Dit is een financiële app. Een ondernemer opent hem om iets te controleren of
kwijt te raken, niet om ernaar te kijken. Beweging mag daarom nooit vertragen —
ze mag alleen antwoord geven op "wat gebeurde er net?" en "waar kwam dit
vandaan?". Alles wat langer duurt dan ~400 ms is per definitie te lang.

Drie dingen bepalen of een scherm *vloeiend* aanvoelt, in deze volgorde:

1. **Reageert het meteen op mijn vinger?** (druk-feedback — §3)
2. **Zie ik dat er iets komt?** (skeletten — `loading.tsx` per route)
3. **Is het overal hetzelfde?** (deze tokens)

---

## 2. Tokens

Twee spiegels van dezelfde tabel. Verander je er één, verander dan de andere.

| Waar | Wat |
|---|---|
| `src/lib/design/tokens.ts` | `DUR`, `EASE`, `transition()` — voor inline styles in TSX |
| `src/app/globals.css` | `--dur-*`, `--ease-*` in `:root` — voor stylesheets |

### Duur

| Token | Waarde | Waarvoor |
|---|---|---|
| `instant` | 80 ms | Een druk, een hover-tint. Onder ~100 ms leest als "meteen". |
| `fast` | 140 ms | Standaard voor kleur en dekking op een bedieningselement. |
| `base` | 200 ms | Standaard voor alles wat beweegt of van maat verandert. |
| `slow` | 280 ms | Een dialoog of sheet die binnenkomt. |
| `slower` | 400 ms | Een verandering over het hele oppervlak. Onze bovengrens. |

### Easing

| Token | Waarvoor |
|---|---|
| `standard` | Bijna alles. |
| `decelerate` | Dingen die **binnenkomen** — snel starten, zacht landen. Dit is de grootste enkele bijdrage aan een vloeiend gevoel. |
| `accelerate` | Dingen die **weggaan**. Wat vertrekt hoort niet te blijven hangen. |
| `spring` | Kleine overshoot. Alleen voor een druk of een FAB — **nooit voor cijfers.** |

Asymmetrie is opzettelijk: iets verdwijnt sneller (`fast`) dan het verschijnt
(`slow`). Oude inhoud moet geen aandacht meer vragen; nieuwe inhoud mag even de
tijd krijgen om gelezen te worden.

```tsx
import { transition, DUR, EASE } from '@/lib/design/tokens'

style={{ transition: transition('opacity', 'fast') }}
style={{ transition: transition(['opacity', 'translate'], 'base', 'decelerate') }}
```

Vermijd `transition: all`. Het animeert eigenschappen die je niet bedoelde —
vooral `height`, en dát is wat een lijst laat "zwemmen".

> **Waarom `:root` en niet `@theme`?**
> Tailwind 4 gooit theme-variabelen weg die geen enkele gegenereerde utility
> gebruikt. `--dur-*` en `--ease-*` horen bij geen enkele Tailwind-namespace,
> dus de tokens die deze stylesheet niet zélf gebruikte werden uit de output
> geknipt: `--dur-instant`, `--dur-slower` en `--ease-spring` losten in de
> browser op als lege string. Een `:root`-regel wordt altijd uitgestuurd.

---

## 3. Druk-feedback

Alles wat je kunt aanraken, moet daarop reageren — **binnen 100 ms, zonder
netwerk.** Dit is het verschil tussen "de app hangt" en "de app luistert".

| Selector | Gebruik voor | Wat het doet |
|---|---|---|
| `button` (automatisch) | elke `<button>` | `scale: 0.97` + lichte dekking |
| `.pressable` | `<Link>`, klikbare `<div>`, tegels | `scale: 0.97` |
| `.pressable-row` | volle-breedte lijstrijen | achtergrond-tint (geen schaal) |
| `.nav-icon-btn` | icoonknop in een balk | hover-tint (muis) |

Een rij over de volle breedte krimpt níét: op die maat leest een schaal van 0.97
als de hele pagina die doorbuigt. Die tint in plaats daarvan.

### Twee dingen die je moet weten

**`scale`, niet `transform`.** De druk gebruikt de losstaande CSS-eigenschap
`scale`. Daardoor stapelt ze op een `transform` die het element al heeft — een
FAB op `scale(1.08)` bij hover, een toast op `translateX(-50%)` — in plaats van
die te overschrijven. Het scheelt ook `!important`: niets anders in de app zet
`scale`.

**Geen JS-hover.** De app schilderde hover met `onMouseEnter`/`onMouseLeave`.
Een vinger vuurt die events nooit af, dus op een telefoon gaf de terugknop —
het meest aangeraakte element in de hele app — precies niets terug tussen de tik
en het volgende scherm. Hover hoort in CSS (`:hover`), druk in `:active`.

> ### ⚠️ Geen `!important` op `button`
> De basisregels voor `<button>` in `globals.css` staan er bewust **zonder**
> `!important`. Ze hadden het, en de prijs was onzichtbaar maar groot: een
> `!important` in een stylesheet verslaat een normale inline style. Dus
> `border-radius: 12px !important` hervormde stilletjes élke knop die iets
> anders vroeg — ~350 stuks, waaronder 95 pil-knoppen (`R.full`), 19 op 999px,
> 17 op 9999px en 14 ronde icoonknoppen op 50%. Allemaal getekend als hetzelfde
> afgeronde rechthoekje. De `transition`-regel deed hetzelfde met beweging:
> elke handgeschreven cubic-bezier op een knop werd vervangen door
> `opacity .15s ease` voordat hij ooit liep.
>
> Zonder `!important` krijgt een knop die niets opgeeft nog steeds deze
> waarden; een knop die wél iets opgeeft, houdt het eindelijk.

---

## 4. Keyframes

Allemaal globaal in `globals.css`. Niets importeren, geen `<style>`-tag in een
component.

| Klasse | Wat |
|---|---|
| `.animate-fade-in` | verschijnen met een kleine opwaartse verschuiving |
| `.animate-scale-in` | een oppervlak dat ter plekke arriveert (dialoog, menu) |
| `.animate-rise-in` / `.animate-rise-out` | snackbar |
| `.animate-sheet-in` / `.animate-sheet-out` | bottom sheet |
| `.animate-backdrop-in` / `.animate-backdrop-out` | de scrim |
| `.animate-spin` | wachtindicator |
| `bb-shimmer` (keyframe) | skeletglans — combineer met een 200% brede gradient |

Deze stonden eerder in componenten: `spin` bestond **vijf keer onder vijf
namen** (`spin` / `bb-spin` / `bbSpin` / `m3spin` / `bq-spin`), `shimmer` drie
keer, de toast-stijging twee keer (`fadeInUp` / `m3fadeUp`). Elke kopie zat in
een andere bundle en dreef weg van de rest.

> ### ⚠️ Geen paginaovergangen
> Er staan hier bewust **geen** overgangen tussen pagina's. Die zijn geprobeerd
> (React `<ViewTransition>` + `experimental.viewTransition`) en weer verwijderd:
> beide bovenbalken droegen `view-transition-name: 'page-header'`, en bij een
> navigatie van een startpagina naar een subpagina staan die twee even samen in
> de DOM. Een dubbele naam breekt de transitie af en de afgebroken snapshot
> bleef als een leeg wit vlak over de kopbalk staan. Wil je het opnieuw
> proberen: één gedeeld balk-element of twee verschillende namen, en bewijs het
> met een ingelogde navigatie heen én terug in beide rollen.
> Zie de post-mortem in `docs/UX_REVIEW_2026.md`.

---

## 5. Snackbar — `useToast()`

`src/components/ui/Toast.tsx`. Eén keer gemonteerd in `src/app/layout.tsx`.

```tsx
const toast = useToast()
toast('Factuur verstuurd')
toast('Opgeslagen', { tone: 'success' })
toast('Uploaden mislukt', { tone: 'error' })
toast('Verwijderd', { action: { label: 'Ongedaan maken', onClick: undo } })
```

Zes schermen hadden er elk een eigen gebouwd. Ze waren het over niets eens: de
afstand tot de onderrand was 24, 32, 40 of 90 px, geen enkele klaarde de
home-indicator, geen enkele werd voorgelezen, en omdat elke toast bij zijn eigen
scherm hoorde ging een bevestiging verloren zodra de handeling navigeerde.

Details die ertoe doen:

- **`aria-live` staat er altijd.** Een schermlezer meldt alleen veranderingen
  *binnen* een gebied dat er al was. Wie het gebied samen met de eerste melding
  monteert, meldt niets.
- Maximaal drie tegelijk; daarna schuift de oudste eruit.
- Een fout krijgt `role="alert"`, de rest `role="status"`.
- Met een actie erin blijft hij 5,2 s staan in plaats van 3,2 s. Drie seconden
  is genoeg om iets te **lezen**, niet om te **besluiten** dat je het toch niet
  wilde.

---

## 6. Dialogen — `useDialog()`

`src/components/ui/Dialog.tsx`. Vervangt `window.alert` / `confirm` / `prompt`.
De vorm volgt bewust de oude, zodat een aanroep meestal met één woord verandert:

```tsx
const dialog = useDialog()

if (!await dialog.confirm({ title: 'Klant verwijderen?', message: '…', danger: true })) return
await dialog.alert({ title: 'Mislukt', message: '…' })
const antwoord = await dialog.prompt({ message: '…', multiline: true, maxLength: 200 })
```

`alert()` levert `void`, `confirm()` levert `boolean`, `prompt()` levert
`string | null` — precies wat de browserversies teruggaven.

De app had 22 `alert()`, 13 `confirm()` en 2 `prompt()`, en ze zaten juist op de
beslissingen die de meeste zorg verdienden: een boekhouder loskoppelen van een
klant, de prullenbak definitief legen, een banktransactie koppelen aan een
factuur die mogelijk al geboekt was. Een browservenster bevriest de hoofdthread,
tekent in de chrome van het besturingssysteem in plaats van die van de app, kan
een bedrag of leveranciersnaam alleen als kale tekst tonen — en meldt zich op
een telefoon in standalone-modus met de herkomst-URL. Dat is precies het moment
waarop een financiële app het minst betrouwbaar oogt.

Wat de dialoog wél doet: focus naar binnen bij openen en terug bij sluiten, Tab
gevangen binnen het paneel, Escape annuleert, klik op de scrim annuleert, de
pagina erachter scrollt niet mee, en `\n` in een bericht blijft een regeleinde.

### Welke van de twee?

| | |
|---|---|
| Iets is **gebeurd** | `toast()` |
| Iets moet **besloten** worden | `dialog.confirm()` |
| Iets moet **gelezen** zijn voor je verder kunt | `dialog.alert()` |
| Iets moet **geschreven** worden | `dialog.prompt()` |

De meeste oude `alert()`-aanroepen waren in werkelijkheid meldingen, geen
vragen. Die zijn toast geworden.

### Bevestig geen omkeerbare handeling

Een dialoog vóór iets dat je terug kunt draaien is wrijving, en het leert mensen
dialogen weg te klikken zonder te lezen. Bestanden naar de prullenbak verplaatsen
gebeurt daarom meteen, met "Ongedaan maken" in de snackbar. De bevestiging zit
waar ze hoort: bij het definitief legen van de prullenbak.

---

## 7. Verminderde beweging

`prefers-reduced-motion: reduce` zet alle duren op ~0, neutraliseert elke
druk-schaal en schakelt de entree-animaties uit. Inhoud verschijnt dan direct op
zijn eindpositie — nooit onzichtbaar, alleen niet bewegend.

Zet je een nieuwe animatie op de losstaande `scale`- of `translate`-eigenschap,
**noem hem dan in dat blok**: de algemene `animation`/`transition`-reset dekt die
eigenschappen niet.

---

## 8. Checklist voor nieuw werk

- [ ] Duur en easing uit de tokens, geen los getal
- [ ] `transition('opacity', …)` in plaats van `all`
- [ ] Aanraakbaar element heeft `button`, `.pressable` of `.pressable-row`
- [ ] Geen `onMouseEnter`/`onMouseLeave` voor feedback — dat is CSS
- [ ] Geen `@keyframes` in een component
- [ ] Geen `window.alert` / `confirm` / `prompt`
- [ ] Geen `!important` op een gedeelde elementregel
- [ ] Nieuwe `scale`/`translate`-animatie ook in het reduced-motion-blok
- [ ] Vast element aan de onderrand rekent met `env(safe-area-inset-bottom)`
