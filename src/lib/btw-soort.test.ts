// Run: npx tsx --test src/lib/btw-soort.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { doubtAboutInputVat } from "./btw-soort";

test("[GEEN-BTW-SOORT] the production invoice that provoked this", () => {
  // Coöperatie Univé Zuid-Nederland, 142257742, 14-08-2026. € 195,28 + € 41,01 = € 236,29, booked
  // 'received', so that € 41,01 is standing as voorbelasting right now. Read correctly, added up
  // correctly, passed every gate — and it is assurantiebelasting, which is 21 % as well.
  const d = doubtAboutInputVat({
    supplierName: "Coöperatie Univé Zuid-Nederland U.A.",
    totalExBtw: 195.28, btwAmount: 41.01,
  });
  assert.equal(d?.kind, "assurantiebelasting");
  assert.match(d!.message, /assurantiebelasting/);
  assert.match(d!.message, /niet terugvragen/, "the owner must be told what the consequence is");
  assert.ok(d!.wet.includes("11-1-k"), "an accountant must be able to check the claim");
});

test("[GEEN-BTW-SOORT] silent when nothing is being claimed", () => {
  // The whole module only matters where an amount is going INTO an aangifte. The same insurer's
  // invoice booked at € 0 BTW is already correct and must produce no noise at all.
  assert.equal(doubtAboutInputVat({ supplierName: "Univé Zuid-Nederland", totalExBtw: 236.29, btwAmount: 0 }), null);
  assert.equal(doubtAboutInputVat({ supplierName: "Univé", totalExBtw: 100, btwAmount: null }), null);
});

test("[GEEN-BTW-SOORT] horeca: the BTW is real and still may not be reclaimed", () => {
  // Different from the insurance case and the difference matters: here there IS btw on the bill.
  // Art. 15 lid 5 excludes it anyway, with no threshold and no working-lunch exception.
  const d = doubtAboutInputVat({ supplierName: "Restaurant De Zwaan", totalExBtw: 100, btwAmount: 9 });
  assert.equal(d?.kind, "horeca");
  assert.match(d!.message, /niet terugvragen/);
  assert.match(d!.message, /kosten zelf blijven wel aftrekbaar/,
    "the cost stays deductible for income tax — saying only 'not deductible' would be half true " +
      "and would cost the owner a real deduction");
});

test("[GEEN-BTW-SOORT] rent ASKS, because taxed rental is lawful and common", () => {
  // The one family where 21 % is very often completely correct: landlord and tenant may opt for
  // btw-belaste verhuur, which is normal for business premises. A verdict here would strip a real
  // deduction, so the sentence is a question about the contract.
  const d = doubtAboutInputVat({ supplierName: "Atalantix Vastgoed CV", totalExBtw: 2000, btwAmount: 420 });
  assert.equal(d?.kind, "verhuur");
  assert.match(d!.message, /kunnen kiezen voor/, "it must present the option, not an accusation");
  assert.match(d!.message, /huurcontract/, "…and point at where the answer actually is");
  assert.ok(!/mag je niet/.test(d!.message), "rent must never be told it is non-deductible outright");
});

test("[GEEN-BTW-SOORT] tax, pension and wages carry no BTW at all", () => {
  for (const naam of ["Belastingdienst", "Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf", "Loonheffing januari"]) {
    assert.equal(doubtAboutInputVat({ supplierName: naam, totalExBtw: 1000, btwAmount: 210 })?.kind,
      "buiten_btw", `${naam} moet als buiten-btw herkend worden`);
  }
});

test("[GEEN-BTW-SOORT] an ordinary supplier is left completely alone", () => {
  // The failure mode that would make this feature worthless: a warning on invoices that are fine.
  // These are the owner's real wholesalers, at their real rates.
  for (const naam of ["Sumer Food B.V.", "ATAPACK Cash & Carry B.V.", "W.KETELS & ZN EIERHANDEL",
                      "Enka Horeca B.V.", "Trimex", "Greenchoice Zakelijk N.V."]) {
    assert.equal(doubtAboutInputVat({ supplierName: naam, totalExBtw: 1000, btwAmount: 210 }), null,
      `${naam} kreeg een waarschuwing die er niet hoort — een melding op een goede factuur is ` +
      `precies hoe een melding ophoudt gelezen te worden`);
  }
});

test("[GEEN-BTW-SOORT] 'Enka Horeca' is a WHOLESALER, not a restaurant", () => {
  // The trap in the owner's own administration: a supplier whose NAME contains the word horeca
  // while it sells stock. 14 of its invoices are booked with fully deductible BTW and they are
  // right. The pattern therefore matches whole words like 'restaurant' and 'cafe', never the
  // industry word 'horeca' on its own.
  assert.equal(doubtAboutInputVat({ supplierName: "Enka Horeca B.V.", totalExBtw: 1000, btwAmount: 90 }), null);
});

test("[GEEN-BTW-SOORT] a bakery is not a bank", () => {
  // 'Bank' as a fragment matches Bankethuis, banketbakkerij, bankstel. The financial pattern is
  // anchored on real bank names and on the cost words, not on the four letters.
  assert.equal(doubtAboutInputVat({ supplierName: "Bankethuis Van Dijk", totalExBtw: 500, btwAmount: 45 }), null);
  assert.equal(doubtAboutInputVat({ supplierName: "Banketbakkerij De Rooij", totalExBtw: 500, btwAmount: 45 }), null);
  assert.equal(doubtAboutInputVat({ supplierName: "ABN AMRO", totalExBtw: 100, btwAmount: 21 })?.kind, "financieel");
});

test("[GEEN-BTW-SOORT] the description is read too, not only the name", () => {
  // A premium invoiced by an intermediary names itself in the line, not in the sender.
  assert.equal(
    doubtAboutInputVat({ supplierName: "Adviesgroep Zuid", description: "Premie brandverzekering 2026", totalExBtw: 195.28, btwAmount: 41.01 })?.kind,
    "assurantiebelasting");
});
