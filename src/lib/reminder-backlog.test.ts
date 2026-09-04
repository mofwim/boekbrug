// src/lib/reminder-backlog.test.ts
// [HERINNER-AAN] De rem op de stapel van vroeger.
// Run: npx tsx --test src/lib/reminder-backlog.test.ts
//
// Herinneringen staan sinds 3 september standaard AAN. Deze test bewaakt wat die schakelaar
// gevaarlijk maakte: reminderTierDue() geeft de HOOGST bereikte trap terug, dus een net
// geregistreerd account dat een jaar aan facturen importeert zou in één cron-ronde de
// ingebrekestelling — met incassokosten — naar elke klant in die stapel sturen. Een brief die de
// app nooit had mogen sturen komt niet terug.

import test from "node:test";
import assert from "node:assert/strict";
import { reminderTierDue } from "./invoice-reminders";

// Dagnummers: dueDate wordt intern via dayNumberFromIso omgezet, dus de tests rekenen in datums.
const basis = {
  todayDayNumber: 20300, // een vast "vandaag"
  offsets: [14, 30],
  sentOffsets: [] as number[],
  status: "sent",
  invoiceType: "factuur",
  direction: "outgoing",
  totalIncBtw: 500,
  amountPaid: 0,
  clientEmail: "klant@example.nl",
  remindersPaused: false,
};

// dayNumberFromIso is intern; we leiden het af door één keer zonder rem te meten.
import { dayNumberFromIso } from "./invoice-reminders";
const dag = (iso: string) => dayNumberFromIso(iso) as number;

test("[HERINNER-AAN] zonder rem gedraagt alles zich als voorheen", () => {
  // De tegenproef: als dit niet de hoogste trap gaf, meet de rest van dit bestand niets.
  const vervallen = "2026-01-10";
  const t = reminderTierDue({ ...basis, todayDayNumber: dag(vervallen) + 200, dueDate: vervallen });
  assert.equal(t, 30, "een factuur van 200 dagen oud hoort zonder rem de hoogste trap te krijgen");
});

test("[HERINNER-AAN] de geïmporteerde stapel wordt met rust gelaten", () => {
  // Dit is het scenario: account aangemaakt vandaag, administratie meegenomen uit een ander
  // pakket, facturen van maanden geleden. Geen enkele mag een brief opleveren.
  const aangezet = "2026-09-03";
  for (const oud of ["2026-01-10", "2026-03-31", "2026-07-15", "2026-09-02"]) {
    const t = reminderTierDue({
      ...basis,
      dueDate: oud,
      todayDayNumber: dag(aangezet) + 5,
      remindersActiveSinceDay: dag(aangezet),
    });
    assert.equal(t, null, `factuur vervallen op ${oud} werd toch aangemaand — dit is de brief die niet terug kan`);
  }
});

test("[HERINNER-AAN] wat NA het aanzetten vervalt wordt gewoon gejaagd", () => {
  // De rem mag de functie niet uitschakelen; hij mag alleen de geschiedenis afsnijden.
  const aangezet = dag("2026-09-03");
  const verviel = "2026-09-04";
  const t = reminderTierDue({
    ...basis,
    dueDate: verviel,
    todayDayNumber: dag(verviel) + 15,
    remindersActiveSinceDay: aangezet,
  });
  assert.equal(t, 14, "een factuur die ná het aanzetten verviel hoort gewoon trap 14 te krijgen");
});

test("[HERINNER-AAN] dezelfde dag telt mee", () => {
  // Vervalt een factuur precies op de dag dat de schakelaar omgaat, dan is er niets historisch
  // aan — hij hoort erbij. De grens is `<`, niet `<=`, en dat is het verschil tussen "de stapel
  // van vroeger" en "vanaf nu".
  const dagX = dag("2026-09-03");
  const t = reminderTierDue({
    ...basis,
    dueDate: "2026-09-03",
    todayDayNumber: dagX + 40,
    remindersActiveSinceDay: dagX,
  });
  assert.equal(t, 30);
});

test("[HERINNER-AAN] geen moment bekend → geen rem, precies het oude gedrag", () => {
  // De kolom kan nog leeg zijn (migratie niet toegepast, of een rij van vóór deze wijziging).
  // Dan mag er niets veranderen — een rem die aanslaat omdat een kolom ontbreekt zou stilletjes
  // alle herinneringen van alle bestaande eigenaren stopzetten.
  const verviel = "2026-01-10";
  for (const zonder of [undefined, null]) {
    const t = reminderTierDue({
      ...basis,
      dueDate: verviel,
      todayDayNumber: dag(verviel) + 200,
      remindersActiveSinceDay: zonder,
    });
    assert.equal(t, 30, "zonder bekend aanzetmoment hoort het gedrag onveranderd te zijn");
  }
});

test("[HERINNER-AAN] de rem vervangt geen enkele andere weigering", () => {
  // Betaald, gepauzeerd, creditnota, geen e-mailadres: die weigeren nog steeds, ook als de datum
  // ruim ná het aanzetten ligt. De rem is een extra grens, geen nieuwe hoofdregel.
  const aangezet = dag("2026-09-01");
  const verviel = "2026-09-05";
  const laat = { ...basis, dueDate: verviel, todayDayNumber: dag(verviel) + 40, remindersActiveSinceDay: aangezet };
  assert.equal(reminderTierDue({ ...laat, amountPaid: 500 }), null, "betaald blijft betaald");
  assert.equal(reminderTierDue({ ...laat, remindersPaused: true }), null, "gepauzeerd blijft gepauzeerd");
  assert.equal(reminderTierDue({ ...laat, status: "paid" }), null, "status paid blijft weigeren");
  assert.equal(reminderTierDue({ ...laat, clientEmail: "" }), null, "geen adres blijft weigeren");
  assert.equal(reminderTierDue({ ...laat, invoiceType: "creditnota" }), null, "creditnota blijft weigeren");
  // …en de gewone weg blijft open.
  assert.equal(reminderTierDue(laat), 30);
});
