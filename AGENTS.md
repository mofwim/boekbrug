<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Er werkt meer dan één sessie aan deze repo

`main` loopt tijdens jouw werk door: een andere sessie merget er zijn eigen tak in, en soms
raakt die hetzelfde bestand als jij. Dat is op 31 juli twee keer gebeurd, één keer met een echt
conflict in `src/app/register/page.tsx`.

**Voordat je naar `main` pusht: merge `main` eerst in JOUW tak en draai de poorten op het
resultaat.**

```bash
git fetch origin main
git merge origin/main          # los conflicten hier op, niet op main
npx tsc --noEmit
npx tsx --test src/lib/*.test.ts src/content/legal/*.test.ts
npx next build                 # zonder secrets — zie LIVE_GAAN.md §0
```

De reden dat dit niet optioneel is: je poorten op je eigen tak bewijzen dat *jouw* wijziging
werkt, niet dat de COMBINATIE werkt — en de combinatie is wat er gedeployed wordt. Een merge die
schoon automerget kan alsnog stuk zijn (twee sessies die dezelfde functie anders aanroepen
geven geen conflict, wel een fout).

Twee dingen die daarbij horen:

- **Een conflict is meestal additief.** Twee sessies die hetzelfde scherm verbeteren lossen
  zelden hetzelfde probleem op. Kijk wat elke kant DOET voordat je er een kiest; het antwoord is
  vaak "allebei houden".
- **Controleer daarna of de merge niets stils heeft opgegeten.** Een automerge slaagt ook als
  hij jouw blok kwijtraakt. Tel je eigen markeringen (`grep -c "[JOUW-TAG]"`) in de bestanden die
  je hebt aangeraakt, en kijk in de gebouwde HTML in plaats van in de bron waar dat kan.
