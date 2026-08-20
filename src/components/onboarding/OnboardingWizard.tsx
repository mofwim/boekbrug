// src/components/onboarding/OnboardingWizard.tsx
// [BOEK-015] Smart Onboarding — Complete Redesign — May 2026
//
// ZZP'er flow:  1=Welcome → 2=Role → 3=Manual company details (validated) → 3C=Numbering → 4=Gmail → 5=Accountant → 6=Done
// Accountant:   1=Welcome → 2=Role → 3=OfficeDetails → 4=InviteClient → 5=Done
//
// [TRUST-ONBOARDING] The old "upload a factuur, AI fills your details" step was
// REMOVED: on a received invoice it captured the SUPPLIER's KvK/BTW/IBAN as the
// owner's own, and stored unvalidated legal identity. The owner types their own
// identity once, validated; AI extraction stays where it earns its keep — on
// INCOMING documents, never on the owner's identity.
//
// Rules:
// - Eén vraag per scherm
// - Geen technische termen
// - Eigen identiteit: handmatig + gevalideerd (nooit AI-geraden)
// - font-size 16px op inputs (iOS zoom prevention)
// - env(safe-area-inset-bottom) op bottom

"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
// [FACTUUR-B] numbering extraction (client-side live preview)
import { previewInvoiceStart, reasonToDutch } from "@/lib/invoice-template";
// [TRUST-ONBOARDING] Validate the owner's OWN identity at entry — these validators
// already exist but the onboarding capture path never used them, so garbage BTW/IBAN
// was stored and later printed on a legal invoice. KvK stays the local KVK_REGEX.
import { BTW_REGEX, EMAIL_REGEX } from "@/lib/validation";
import { isValidIban, normalizeIban } from "@/lib/epc-qr";
import Link from 'next/link'
import { M3 } from '@/lib/design/tokens'
// [FUNNEL-OVERDRACHT] Wat op /factuur-maken is ingevuld, hier terugzien in plaats van opnieuw tikken.
import { readHandoff, hasSenderContent, toOnboardingCompany } from "@/lib/factuur-handoff";
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { parseVak } from "@/lib/vak-profile";
import { vakOpties } from "@/lib/vak-sjablonen";
// ── Types ────────────────────────────────────────────────

type Role = "zzp" | "accountant";
type StepId = 1 | 2 | 3 | "3A" | "3B" | "3C" | 4 | 5 | 6;
interface CompanyData {
  company_name: string;
  kvk_number: string;
  btw_number: string;
  iban: string;
  address: string;
  // [VAK-BRUG] What kind of work he does. Optional, and it changes nothing he is allowed to do —
  // it decides what the app OFFERS: which second destination his phone bar carries, and whether his
  // empty price list can offer him his own trade's lines with the right btw rate already on them.
  // Asked here because it is a fact about the business, on the screen that collects those.
  vak: string;
}

interface OnboardingWizardProps {
  userName: string;
  initialStep?: number;
  initialRole?: Role;
  roleWasSet?: boolean; // [BOEK-015] P2: true if user already chose role (skip step 2)
  /** [HERVATTEN] De bedrijfsgegevens die al in het profiel staan — zie useState hieronder. */
  initialCompany?: CompanyData;
}

// ── Progress mapping ─────────────────────────────────────

function stepToProgress(step: StepId, role: Role): number {
  if (role === "accountant") {
    const map: Record<string, number> = { "1": 10, "2": 30, "3": 55, "4": 80, "5": 100 };
    return map[String(step)] ?? 10;
  }
  const map: Record<string, number> = {
    "1": 5, "2": 20, "3": 35, "3A": 52, "3B": 52, "3C": 60, "4": 70, "5": 85, "6": 100,
  };
    return map[String(step)] ?? 5;
}

// Human "Stap X van Y" counter that NEVER skips a number. The setup sub-steps
// (3A/3B/3C) collapse into one "Stap 3", and when the role step is skipped
// (already chosen at registration) the later numbers shift down by one — so the
// user never sees "Stap 1" jump to "Stap 3", and the denominator stays honest.
function stepCounter(step: StepId, role: Role, roleSkipped: boolean): { n: number; total: number } {
  const base = typeof step === "string" ? 3 : step; // 3A/3B/3C → 3 (the setup step)
  const total = role === "accountant" ? (roleSkipped ? 4 : 5) : (roleSkipped ? 5 : 6);
  const n = roleSkipped && base >= 3 ? base - 1 : base;
  return { n: Math.min(n, total), total };
}

const KVK_REGEX = /^\d{8}$/;

// ── Main component ──────────────────────────────────────

export function OnboardingWizard({
  userName,
  initialStep = 1,
  initialRole = "zzp",
  roleWasSet = false,
  initialCompany,
}: OnboardingWizardProps) {
  const t = translator(useLocale())
  const firstName = userName.split(" ")[0] || "daar";
  // [BOEK-015] fix: DB default is 0 — clamp to 1 so Step 1 always renders
  const safeStep = Math.max(1, initialStep) as StepId;
  const [step, setStep] = useState<StepId>(safeStep);
  const [role, setRole] = useState<Role>(initialRole);
  // [BOEK-015] P2 fix: skip step 2 only when role was genuinely chosen before
  // roleWasSet comes from page.tsx (checks profile.role + onboarding_step)
  const roleAlreadySet = roleWasSet;
  // [HERVATTEN] Begint bij wat er AL in het profiel staat, niet leeg.
  //
  // Dit stond hard op lege strings, en dat had een gevolg dat op de meest voorkomende route
  // altijd optrad. Wie zich met e-mail registreert vult daar zijn bedrijfsnaam, KVK en BTW in;
  // die worden opgeslagen en de registratie zet onboarding_step op 4. De wizard opent dus op
  // stap 4 — mét een leeg `company`-object, want de pagina las die kolommen niet eens.
  //
  // Op het slotscherm bouwt StepDone zijn "dit ontbreekt nog"-lijst uit precies dit object. De
  // gebruiker kreeg daardoor te lezen dat hij zijn bedrijfsnaam, BTW-nummer, KvK-nummer én adres
  // nog moest invullen "want dat is wettelijk verplicht op een factuur" — over gegevens die hij
  // tien minuten eerder had ingetikt en die gewoon in de database stonden.
  //
  // Datzelfde gold voor iedereen die de wizard hervat: een dag later terugkomen betekende een
  // leeg formulier en een slotscherm dat loog. Het comment boven StepDone zegt "Be HONEST about
  // readiness" — dat kan alleen als het scherm weet wat er al staat.
  const [company, setCompany] = useState<CompanyData>(
    initialCompany ?? { company_name: "", kvk_number: "", btw_number: "", iban: "", address: "", vak: "" }
  );
  // [FUNNEL-OVERDRACHT] Kwam deze gebruiker binnen via de gratis factuurgenerator, dan tikte
  // hij zijn bedrijfsblok daar al in — bedrijfsnaam, adres, KVK, BTW, IBAN. Dat is exact deze
  // stap. Hem hetzelfde nóg een keer laten invullen was de duurste wrijving in de hele trechter:
  // het gebeurt op het moment dat hij net besloot te blijven.
  //
  // Dit vult stil voor, zonder te vragen. Dat mag hier — het zijn zijn eigen gegevens van een
  // paar minuten geleden, dus hij herkent ze in plaats van ervan te schrikken. De factuur zélf
  // (klant + regels) wordt wél expliciet aangeboden, want een compleet ingevulde factuur die
  // vanzelf verschijnt zou wel verrassen; zie dashboard/invoice/new.
  //
  // localStorage bestaat alleen in de browser, dus dit gebeurt na mount. Alleen lege velden
  // worden gevuld: wat de gebruiker hier zelf al typte wint altijd.
  // Alleen om het te kúnnen zeggen. Stil voorvullen zonder uitleg voelt als een systeem dat
  // meer van je weet dan je dacht; één zin erbij maakt er herkenning van.
  // (Stond onder het effect dat hem gebruikt — vandaar de eslint-fout "Cannot access variable
  // before it is declared". Werkte in de praktijk, want het effect draait na mount, maar de
  // volgorde hoort te kloppen met het gebruik.)
  const [prefilledFromFactuur, setPrefilledFromFactuur] = useState(false);
  // [PREFILL-LATCH] Een ref, geen state. Dit is een grendel — "het voorvullen is al gebeurd" — en
  // geen gegeven waar de render iets mee doet: buiten het effect hieronder wordt hij nergens
  // gelezen. Als useState kostte hij toch een extra renderronde bij élke keer dat de wizard opent,
  // en zette hij setState in de body van een effect. Dat is precies waar
  // react-hooks/set-state-in-effect voor waarschuwt, en het was de laatste eslint-ERROR in het
  // project.
  //
  // Het onderscheid dat dit bestand zelf twaalf regels verderop al maakt: prevStep/setSaving wordt
  // TIJDENS de render bijgesteld, met het comment "scheelt een tweede renderronde". Dezelfde
  // gedachte, andere gereedschapskist — hier kan het niet tijdens de render, want readHandoff leest
  // localStorage en dat bestaat pas na mount. Een ref is dan het juiste antwoord: geen render, geen
  // dependency, en de grendel overleeft de dubbele effect-aanroep van StrictMode (waarna de tweede
  // ronde er meteen weer uit valt — precies de bedoeling, één keer voorvullen).
  //
  // `prefilledFromFactuur` hierboven blijft wél state: die stuurt de zin op het scherm.
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefillDone.current) return;
    prefillDone.current = true;
    try {
      const h = readHandoff(localStorage);
      if (!h || !hasSenderContent(h)) return;
      const uit = toOnboardingCompany(h);
      // [PREFILL-LATCH] Hier staat bewust een uitzondering op react-hooks/set-state-in-effect, en
      // wél met reden — niet om de regel het zwijgen op te leggen.
      //
      // De regel waarschuwt voor cascaderende renders door state te zetten in een effect. Dat is
      // terecht, en één van de twee gevallen in dit effect IS zo opgelost: de grendel hierboven is
      // nu een ref in plaats van state. Wat overblijft kán niet anders.
      //
      // readHandoff leest localStorage — een store die alleen in de browser bestaat. De pagina die
      // deze wizard rendert is een SERVER component (src/app/onboarding/page.tsx: async, met
      // createServerSupabaseClient), dus de waarde kan niet als initialCompany meekomen. En hem
      // tijdens de render lezen kan evenmin: dan verschilt de eerste client-render van de HTML die
      // de server stuurde, en dat is een hydratie-mismatch — een echt defect in ruil voor een
      // gerustgestelde linter.
      //
      // Eén extra render, één keer, bij het openen van de wizard. Dat is de prijs van het lezen van
      // een browser-only store zonder hydratie te breken, en het is precies waar een effect voor is.
      /* eslint-disable react-hooks/set-state-in-effect -- browser-only store (localStorage), na mount, eenmalig; zie toelichting hierboven */
      setCompany((p) => ({
        company_name: p.company_name || uit.company_name,
        kvk_number: p.kvk_number || uit.kvk_number,
        btw_number: p.btw_number || uit.btw_number,
        iban: p.iban || uit.iban,
        address: p.address || uit.address,
        // [VAK-BRUG] Not carried from the free generator's stored block: that store predates this
        // field, so there is nothing of his in it to preserve. Keeping whatever the wizard already
        // has means a trade read from his profile survives this merge.
        vak: p.vak,
      }));
      setPrefilledFromFactuur(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* geblokkeerde opslag — de gebruiker vult het gewoon zelf in */
    }
    // Lege dependency-lijst: de grendel zit nu in een ref, dus er is niets meer om op te reageren.
    // Hij stond op [prefillDone] omdat het effect zijn eigen state zette — een lus die zichzelf één
    // keer opnieuw plande en dan tot stilstand kwam.
  }, []);
  const [kvkError, setKvkError] = useState("");
  const [btwError, setBtwError] = useState("");
  const [ibanError, setIbanError] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // [UITNODIGING] Apart van saveError: dit gaat over het adres in het veld, niet over de stap.
  const [inviteError, setInviteError] = useState("");

  // [BOEK-015] Reset saving state whenever step changes — safety net for all transitions
  // Placed after useState declaration to avoid hoisting confusion
  // [REACT] Afgeleid van de stap: bij elke stapwissel is een lopende opslag niet meer
  // relevant. Tijdens de render bijstellen scheelt een tweede renderronde.
  const [prevStep, setPrevStep] = useState(step);
  if (prevStep !== step) {
    setPrevStep(step);
    setSaving(false);
  }

  // [FACTUUR-B] invoice numbering start (step 3C)
  const [invoiceStart, setInvoiceStart] = useState("");
  const [numberingError, setNumberingError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  useCloseOnBack(!!showResetConfirm, () => setShowResetConfirm(false))

  // [BOEK-011] Fix 2: detect gmail=connected from OAuth callback
  const [gmailConnected, setGmailConnected] = useState(false);
  const searchParams = useSearchParams();

  const progress = stepToProgress(step, role);
  const counter = stepCounter(step, role, roleAlreadySet);

  async function persistStep(nextStep: number, extra?: Record<string, unknown>) {
    // [TRUST-ONBOARDING] THROW on a failed save. Before this, persistStep ignored
    // res.ok and the caller advanced regardless — so if the PATCH 500'd (expired
    // session / RLS), the wizard moved on and the entered KvK/BTW/adres were silently
    // lost while the user believed they were stored. Throwing lets handleNext's catch
    // keep the user on the step with an error, so nothing is lost unknowingly.
    const res = await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep, role, ...extra }),
    });
    if (!res.ok) throw new Error(`onboarding save failed: ${res.status}`);
  }

  // [BOEK-011] Fix 2: detect gmail=connected after OAuth callback redirect
  useEffect(() => {
    const gmail = searchParams.get("gmail");
    const stepParam = searchParams.get("step");

    if (gmail === "connected") {
      // In één wikkel: zelfde tick als voorheen, zonder synchrone setState in de effect-body.
      void (async () => {
        setGmailConnected(true);
        if (stepParam === "4") setStep(4);
      })();

      // [BOEK-015] Auto-advance after 2s — guarded so manual "Volgende" doesn't double-fire
      // setStep uses functional form: only advances if still on step 4
      const timer = setTimeout(() => {
        setStep((cur) => {
          if (cur === 4) {
            // fire-and-forget; step guard prevents double. persistStep now throws on
            // a failed save, so swallow here — this auto-advance is a convenience and
            // step 5 (accountant) carries no data to lose.
            void persistStep(5).catch(() => {});
            return 5;
          }
          return cur; // user already advanced manually — do nothing
        });
      }, 2000);

      // Clean URL without reload
      window.history.replaceState({}, "", "/onboarding");

      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [finishing, setFinishing] = useState(false);

  async function finish() {
    // [BOEK-015] fix: explicit finishing state — separate from `saving` which
    // the step-change effect resets. This one persists through navigation.
    setFinishing(true);
    setSaveError("");
    try {
      const res = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: true, role }),
      });
      if (!res.ok) {
        console.error("[BOEK-015] finish failed:", await res.text().catch(() => res.statusText));
        // [LAATSTE-KNOP] Zeg het. Hier stond alleen een console.error, en dat is de allerlaatste
        // handeling van de hele aanmelding: de knop "Ga naar mijn dashboard →". Mislukte de
        // aanroep, dan stopte het draaiwieltje, kwam de knop terug alsof er niets gebeurd was, en
        // stond er nergens iets. De gebruiker klikt dan nog een keer, en nog een keer. Dezelfde
        // reden als de [TRUST-ONBOARDING]-melding bij handleNext: een stap die niet is opgeslagen
        // moet dat zeggen, niet doen alsof.
        //
        // 401 apart, want dat is het geval dat opnieuw klikken NOOIT oplost: wie lang in de
        // wizard bleef staan heeft geen sessie meer, en moet weten dat hij opnieuw moet inloggen.
        setSaveError(
          res.status === 401
            ? t('onb.sessieVerlopenAfronden')
            : t('onb.afrondenMislukt')
        );
        setFinishing(false);
        return; // stay on page — user can retry
      }
      // Use hard navigation to guarantee the redirect + fresh middleware check
      window.location.href = "/dashboard";
    } catch (err) {
      console.error("[BOEK-015] finish error:", err);
      setSaveError(t('onb.afrondenMislukt'));
      setFinishing(false);
    }
  }

  // ── "Volgende" logic per step ──
  async function handleNext() {
    // [DUBBEL] Loopt er al een opslag, dan houdt het hier op. De knop is dan uitgeschakeld, maar
    // een tweede klik vóór de her-render — of straks een Enter uit het formulier — kwam er
    // langs, en dan staan er twee PATCH'es op dezelfde stap in de lucht.
    if (saving || finishing) return;

    // [BOEK-015] fix: always wrap in try/finally so saving resets even on error
    setSaving(true);
    setSaveError("");
    setInviteError("");
    try {
    if (role === "zzp") {
      if (step === 1) {
        // [BOEK-015] P2: skip role step if already set from register
        if (roleAlreadySet) { await persistStep(3); setStep(3); } else { await persistStep(2); setStep(2); }
        return;
      }
      if (step === 2) { await persistStep(3); setStep(3); return; }
      if (step === "3B" || step === 3) {
        // [TRUST-ONBOARDING] Validate the owner's OWN identity BEFORE it is stored and
        // later printed on a legal invoice. Fields stay optional-to-finish (a user can
        // add them later in Instellingen — StepDone is honest about that), but anything
        // TYPED must be well-formed: a garbage BTW/IBAN is never saved as truth.
        const kvk = company.kvk_number.trim();
        const btw = company.btw_number.trim().toUpperCase();
        const iban = company.iban.trim() ? normalizeIban(company.iban) : "";
        let bad = false;
        if (kvk && !KVK_REGEX.test(kvk)) { setKvkError("KVK-nummer moet uit 8 cijfers bestaan"); bad = true; }
        if (btw && !BTW_REGEX.test(btw)) { setBtwError("BTW-nummer moet zijn als NL123456789B01"); bad = true; }
        if (iban && !isValidIban(iban)) { setIbanError("IBAN is ongeldig — controleer het rekeningnummer"); bad = true; }
        if (bad) return;
        setKvkError(""); setBtwError(""); setIbanError("");
        await persistStep(4, {
          company_name: company.company_name.trim() || null,
          kvk_number: kvk || null,
          btw_number: btw || null,
          address: company.address.trim() || null,
          iban: iban || null,
          // [VAK-BRUG] parseVak turns anything unrecognised into null, so a stale option or a
          // tampered value stores "unknown" — which is the state every account was in until now
          // and costs nothing. Never a guess: a WRONG trade would prefill another profession's
          // btw rates, which is the one outcome this whole bridge exists to prevent.
          vak: parseVak(company.vak),
        });
        setStep("3C"); // [FACTUUR-B] go to numbering step before Gmail
        return;
      }
      if (step === "3C") {
        // [FACTUUR-B] save numbering (skippable). Empty = default {year}0001 (20260001).
        if (invoiceStart.trim()) {
          const res = await fetch("/api/invoice/numbering", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoice_start: invoiceStart.trim() }),
          });
          if (!res.ok) {
            setNumberingError(t('onb.nummeringMislukt'));
            return;
          }
        }
        setNumberingError("");
        await persistStep(4);
        setStep(4);
        return;
      }
      if (step === 4) { await persistStep(5); setStep(5); return; }
      if (step === 5) {
        // [UITNODIGING] Verstuurd is verstuurd, en anders zeggen we het.
        //
        // Hier stond `.catch(() => {})` en daarna gewoon door naar het slotscherm. Wie het adres
        // van zijn boekhouder intikte kreeg dus "je bent klaar" te zien, ook als die uitnodiging
        // nooit is aangemaakt — een verkeerd adres, een ratelimiet, een 500, allemaal stil. Dat
        // is precies het gat dat het [COHERENCE-ONBOARDING]-comment hierboven al een keer heeft
        // gedicht voor één oorzaak (de verkeerde veldnaam); de vorm bleef staan voor alle andere.
        //
        // Het is en blijft optioneel: leeg laten mag, "Sla over" mag. Maar wie hem invult moet
        // erop kunnen rekenen, of horen dat het niet lukte.
        const boekhouder = accountantEmail.trim();
        if (boekhouder) {
          if (!EMAIL_REGEX.test(boekhouder)) {
            setInviteError(t('onb.emailKloptNiet'));
            setSaving(false);
            return;
          }
          const res = await fetch("/api/invite/accountant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountant_email: boekhouder }),
          });
          if (!res.ok) {
            setInviteError(
              res.status === 429
                ? t('onb.teVeelUitnodigingen')
                : t('onb.uitnodigingMislukt')
            );
            setSaving(false);
            return;
          }
          setInviteError("");
        }
        await persistStep(6);
        setStep(6);
        return;
      }
      if (step === 6) { await finish(); return; }
    }

    if (role === "accountant") {
      if (step === 1) {
        // [COLD-START] Mirror the ZZP branch: skip the role step when the role was
        // already chosen at registration, so we never show it twice.
        if (roleAlreadySet) { await persistStep(3); setStep(3); } else { await persistStep(2); setStep(2); }
        return;
      }
      if (step === 2) { await persistStep(3); setStep(3); return; }
      if (step === 3) {
        const kvk = company.kvk_number.trim();
        if (kvk && !KVK_REGEX.test(kvk)) { setKvkError("KVK-nummer moet uit 8 cijfers bestaan"); return; }
        setKvkError("");
        await persistStep(4, {
          company_name: company.company_name.trim() || null,
          kvk_number: kvk || null,
        });
        setStep(4);
        return;
      }
      if (step === 4) {
        // [COHERENCE-ONBOARDING] The route reads `clientEmail` (see /api/invite/client
        // and InviteClient.tsx). Sending `client_email` made it 400 "Email verplicht",
        // which the .catch swallowed → the invite was never created while onboarding
        // showed success. Send the field name the route actually expects.
        //
        // [UITNODIGING] En het antwoord wordt nu ook gelezen. Dat die veldnaam ooit fout kón
        // staan zonder dat iemand het merkte, kwam door de `.catch` eronder: die maakte van elke
        // mislukking een succes op het scherm. De veldnaam is gerepareerd, de vorm die hem
        // verborg tot nu toe niet.
        const klant = clientEmail.trim();
        if (klant) {
          if (!EMAIL_REGEX.test(klant)) {
            setInviteError(t('onb.emailKloptNiet'));
            setSaving(false);
            return;
          }
          const res = await fetch("/api/invite/client", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientEmail: klant }),
          });
          if (!res.ok) {
            setInviteError(
              res.status === 429
                ? t('onb.teVeelUitnodigingen')
                : t('onb.uitnodigingMislukt')
            );
            setSaving(false);
            return;
          }
          setInviteError("");
        }
        await persistStep(5);
        setStep(5);
        return;
      }
      if (step === 5) { await finish(); return; }
    }
    } catch (err) {
      console.error("[BOEK-015] handleNext error:", err);
      setSaving(false); // only reset on actual error
      // [TRUST-ONBOARDING] Tell the user the step did NOT save (they stay put, data
      // intact) instead of silently swallowing it and appearing to advance.
      setSaveError(t('onb.opslaanMislukt'));
    }
    // Note: no finally — finish() navigates away, component unmounts naturally
  }

  async function handleSkip() {
    // [STIL-STRANDEN] Dit hele blok stond BUITEN een try/catch, terwijl persistStep met opzet
    // gooit als het opslaan mislukt (zie daar). Een verlopen sessie of een wegvallende
    // verbinding leverde dus een onafgevangen rejection op: de knop deed niets, er kwam geen
    // melding, er draaide geen wieltje. De gebruiker klikt dan nog eens, en nog eens, en sluit
    // het tabblad. handleNext had die afhandeling al — "Sla over" is dezelfde handeling met
    // dezelfde risico's, en hoorde hem net zo goed te hebben.
    if (saving || finishing) return;
    setSaving(true);
    setSaveError("");
    try {
    if (role === "zzp") {
      // [COLD-START] "Sla over" on "Hoe wil je beginnen?" means SKIP the setup —
      // go straight to Gmail (step 4). It used to silently drop the user into the
      // manual form (3B), which is the opposite of skipping. Company data can be
      // added later in Instellingen.
      if (step === 3) { await persistStep(4); setStep(4); return; }
      if (step === "3A" || step === "3B") { await persistStep(4); setStep(4); return; }
      if (step === "3C") { await persistStep(4); setStep(4); return; } // [FACTUUR-B]
      if (step === 4) { await persistStep(5); setStep(5); return; }
      // Overslaan betekent hier: géén boekhouder uitnodigen — niet: de rest overslaan. Dit riep
      // finish() aan en sprong dus regelrecht naar het dashboard, langs het slotscherm heen. Juist
      // daar staat welke wettelijk verplichte gegevens nog ontbreken voordat je een factuur kunt
      // versturen; dat is het enige scherm dat dat zegt. Twee knoppen naast elkaar op hetzelfde
      // scherm hoorden niet op twee verschillende plekken uit te komen.
      if (step === 5) { await persistStep(6); setStep(6); return; }
    }
    if (role === "accountant") {
      if (step === 3) { await persistStep(4); setStep(4); return; }
      if (step === 4) { await finish(); return; }
    }
    } catch (err) {
      console.error("[STIL-STRANDEN] handleSkip error:", err);
      setSaving(false);
      setSaveError(t('onb.overslaanMislukt'));
    }
  }

  // [BOEK-015] Reset — clears all onboarding data and starts from Step 1
  async function handleReset() {
    // Een wis die niet lukte, mag niet als gelukt ogen. Hier stond `catch { /* silent — redirect
    // anyway */ }`: mislukte de DELETE, dan werd er tóch hard genavigeerd, en kwam de gebruiker
    // terug op precies dezelfde gegevens waarvan hij zojuist had bevestigd dat ze gewist mochten
    // worden. Niets legde uit waarom ze er nog stonden.
    if (resetting) return;
    setResetting(true);
    try {
      const res = await fetch("/api/onboarding/reset", { method: "DELETE" });
      if (!res.ok) {
        setSaveError(
          res.status === 401
            ? t('onb.sessieVerlopenReset')
            : t('onb.resetMislukt')
        );
        setResetting(false);
        setShowResetConfirm(false);
        return;
      }
    } catch {
      setSaveError(t('onb.resetVerbinding'));
      setResetting(false);
      setShowResetConfirm(false);
      return;
    }
    // Hard reload to clear all state and re-fetch profile
    window.location.href = "/onboarding";
  }

  const isDone = (role === "zzp" && step === 6) || (role === "accountant" && step === 5);
  // [COHERENCE-ONBOARDING] Hide the shared "Volgende" ONLY on the step that supplies
  // its OWN forward button — the ZZP Gmail step (StepGmail renders "Volgende →" once
  // connected, or the user taps "Sla over"). Every other step needs this button:
  //  • numeric step 3 = StepManual (ZZP "Jouw bedrijf") / StepOfficeDetails (accountant
  //    "Jouw kantoor") — neither has an internal submit, so hiding it stranded the
  //    typed legal identity (only "Sla over" advanced, discarding it).
  //  • accountant step 4 = StepInviteClient — no internal button either, so the invite
  //    was never sent and StepDone (step 5) was unreachable.
  // The previous `step === 3 || step === "3A" || step === 4` hid the button on ALL of
  // these (the "3A"/"3B" string states are legacy dead code the navigation never sets).
  const hideNextButton = role === "zzp" && step === 4;
  const showSkip =
    !isDone && step !== 1 && step !== 2 &&
    !(role === "zzp" && step === 6) &&
    !(role === "accountant" && step === 5);

  // [BOEK-015] Fix 3: disable Volgende until company_name is filled.
  // [COHERENCE-ONBOARDING] numeric step 3 is the company/office step for BOTH personas
  // (ZZP StepManual + accountant StepOfficeDetails); the old guard only matched the
  // legacy "3B" string for ZZP, so once the button was restored the ZZP name-required
  // rule (and the "Vul je bedrijfsnaam in" hint) had no teeth. Match numeric 3 too.
  const isCompanyStep = step === "3B" || step === 3;
  const kvkVal = company.kvk_number.trim();
  // [FACTUUR-B] also disable "Volgende" while a typed numbering value is unparseable
  const numberingTrimmed = invoiceStart.trim();
  const numberingBad =
    step === "3C" &&
    numberingTrimmed !== "" &&
    !previewInvoiceStart(numberingTrimmed, new Date().getFullYear()).ok;
  const isNextDisabled =
    (isCompanyStep && (
      !company.company_name.trim() ||
      (kvkVal.length > 0 && !/^\d{8}$/.test(kvkVal))
    )) || numberingBad;

  return (
    <div
      className="flex flex-col bg-white"
      // [BOEK-015] fix: explicit minHeight prevents blank screen if Tailwind min-h-screen fails
      style={{ minHeight: "100vh", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* [BOEK-015] P3: Logo header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px 0",
      }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <span style={{ fontSize: "20px", fontWeight: 700, color: "#1a73e8", letterSpacing: "-0.5px" }}>
            BoekBrug
          </span>
        </Link>
        <span style={{ fontSize: "13px", color: "#bdc1c6" }}>
          Stap {counter.n} van {counter.total}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: "3px", background: "#e0e0e0", marginTop: "12px" }}>
        <div
          style={{
            height: "3px",
            width: `${progress}%`,
            background: "#1a73e8",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Content
          In een <form>, zodat Enter uit een veld doet wat "Volgende" doet. Er stond geen enkele
          onKeyDown en geen enkel formulier in dit hele bestand: over zes schermen met tien velden
          deed de Enter-toets nergens iets, en mobiele toetsenborden toonden een regeleinde waar
          een verzendtoets hoort. De submit doet precies wat de knop doet — inclusief dezelfde
          voorwaarden, dus Enter kan niet langs een uitgeschakelde knop heen. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isDone) { void finish(); return; }
          if (hideNextButton || isNextDisabled || saving || finishing) return;
          void handleNext();
        }}
        className="flex-1 flex flex-col px-6 pt-10 pb-8 w-full"
        style={{ maxWidth: "480px", margin: "0 auto" }}
      >
        <div className="flex-1">

          {step === 1 && <StepWelcome firstName={firstName} />}
          {step === 2 && <StepRole role={role} setRole={setRole} />}

          {/* ZZP — [TRUST-ONBOARDING] identity is entered MANUALLY and validated. The
              old "upload a factuur, AI fills your details" path was removed: it captured
              the SUPPLIER's KvK/BTW/IBAN as the owner's own when a received invoice was
              uploaded, and stored unvalidated legal identity. The owner's own 5 fields
              are known by heart and typed once — AI extraction belongs on INCOMING
              documents, not on the owner's identity. */}
          {role === "zzp" && (step === 3 || step === "3B") && (
            <StepManual
              company={company} setCompany={setCompany}
              kvkError={kvkError} setKvkError={setKvkError}
              btwError={btwError} setBtwError={setBtwError}
              ibanError={ibanError} setIbanError={setIbanError}
              prefilledFromFactuur={prefilledFromFactuur}
            />
          )}
          {role === "zzp" && step === "3C" && (
            <StepInvoiceStart
              value={invoiceStart}
              onChange={(v) => { setInvoiceStart(v); setNumberingError(""); }}
              error={numberingError}
            />
          )}
          {role === "zzp" && step === 4 && <StepGmail gmailConnected={gmailConnected} onNext={handleNext} />}
          {role === "zzp" && step === 5 && (
            <StepAccountant
              accountantEmail={accountantEmail}
              setAccountantEmail={(v) => { setAccountantEmail(v); setInviteError(""); }}
              error={inviteError}
            />
          )}
          {role === "zzp" && step === 6 && (
            <StepDone
              firstName={firstName}
              role="zzp"
              missingSendFields={[
                !company.company_name.trim() && t('onb.veldBedrijfsnaam'),
                !company.btw_number.trim() && t('onb.veldBtw'),
                !company.kvk_number.trim() && t('onb.veldKvk'),
                !company.address.trim() && t('onb.veldAdres'),
              ].filter(Boolean) as string[]}
            />
          )}

          {/* Accountant */}
          {role === "accountant" && step === 3 && (
            <StepOfficeDetails company={company} setCompany={setCompany} kvkError={kvkError} setKvkError={setKvkError} />
          )}
          {role === "accountant" && step === 4 && (
            <StepInviteClient
              clientEmail={clientEmail}
              setClientEmail={(v) => { setClientEmail(v); setInviteError(""); }}
              error={inviteError}
            />
          )}
          {role === "accountant" && step === 5 && <StepDone firstName={firstName} role="accountant" missingSendFields={[]} />}
        </div>

        {/* Buttons */}
        <div className="mt-8 space-y-3">
          {saveError && (
            <p style={{ margin: 0, fontSize: "13.5px", color: "#B3261E", textAlign: "center" }}>{saveError}</p>
          )}
          {isDone ? (
            <Btn onClick={finish} loading={finishing}>{t('onb.naarDashboard')} →</Btn>
          ) : (
            !hideNextButton && <Btn onClick={handleNext} loading={saving} disabled={isNextDisabled}>{t('onb.volgende')}</Btn>
          )}
          {showSkip && (
            <button
              type="button"
              onClick={handleSkip}
              style={{ width: "100%", padding: "12px", fontSize: "15px", color: "#5f6368", background: "none", border: "none", cursor: "pointer" }}
            >
              {t('onb.slaOver')}
            </button>
          )}

          {/* [BOEK-015] Reset button — shown from step 2 onwards, hidden on done */}
          {!isDone && step !== 1 && (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              disabled={resetting || saving}
              style={{ width: "100%", padding: "8px", fontSize: "13px", color: "#dadce0", background: "none", border: "none", cursor: "pointer" }}
            >
              {t('onb.opnieuw')}
            </button>
          )}
        </div>
      </form>

      {/* [BOEK-015] Reset confirmation dialog */}
      {showResetConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          // [SHEET-BOTTOM-EXEMPT] /onboarding has no layout, so no BottomNav is
          // rendered here. --bottom-nav-h is still 64px on mobile because it lives
          // on :root, so sheetPaddingBottom() would reserve 64px of dead space
          // under the button for a bar that is not on this screen.
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          zIndex: 1000, paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          <div className="sheet-scroll" style={{
            background: "#fff", borderRadius: "20px 20px 0 0",
            padding: "24px 20px 32px", width: "100%", maxWidth: "480px",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700, color: "#202124", textAlign: "center" }}>
              {t('onb.opnieuwVraag')}
            </h3>
            <p style={{ margin: "0 0 24px", fontSize: "15px", color: "#5f6368", textAlign: "center" }}>
              {t('onb.opnieuwUitleg')}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                type="button"
                onClick={handleReset}
                disabled={resetting}
                style={{
                  padding: "16px", borderRadius: "14px", fontSize: "16px",
                  fontWeight: 600, background: "#ea4335", color: "#fff",
                  border: "none", cursor: resetting ? "not-allowed" : "pointer",
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? "Bezig…" : "Ja, begin opnieuw"}
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                style={{
                  padding: "16px", borderRadius: "14px", fontSize: "16px",
                  fontWeight: 600, background: "#f8f9fa", color: "#202124",
                  border: "none", cursor: "pointer",
                }}
              >
                {t('lijst.annuleren')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared button ────────────────────────────────────────

function Btn({ onClick, loading, children, secondary, disabled }: {
  onClick: () => void; loading?: boolean; children: React.ReactNode; secondary?: boolean; disabled?: boolean;
}) {
  // [BOEK-015] Fix 3: disabled state for validation
  const isOff = !!loading || !!disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isOff}
      style={{
        width: "100%",
        padding: "16px",
        borderRadius: "16px",
        fontSize: "16px",
        fontWeight: 600,
        background: isOff ? "#dadce0" : secondary ? "#f8f9fa" : "#1a73e8",
        color: secondary ? "#1a73e8" : "#fff",
        border: "none",
        cursor: isOff ? "not-allowed" : "pointer",
        transition: "transform 0.1s, background 0.15s",
        opacity: isOff ? 0.6 : 1,
      }}
    >
      {loading ? "Bezig…" : children}
    </button>
  );
}

// ── Input ────────────────────────────────────────────────

// De label hoorde bij niets. Er stond geen htmlFor en geen id, dus een tik op het opschrift
// zette de cursor niet in het veld (op een telefoon een groot doelwit dat niets doet) en een
// schermlezer noemde het veld ongelabeld. En `autoComplete` ontbrak overal, dus de browser bood
// nooit het adres of de bedrijfsnaam aan die hij allang kent — in een formulier dat juist om die
// gegevens vraagt.
function Input({ id, label, placeholder, value, onChange, inputMode, maxLength, error, type, autoComplete }: {
  id: string; label: string; placeholder: string; value: string; onChange: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number; error?: string; type?: string; autoComplete?: string;
}) {
  const foutId = error ? `${id}-fout` : undefined;
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: "14px", fontWeight: 500, color: "#202124", marginBottom: "8px" }}>
        {label}
      </label>
      <input
        id={id}
        type={type ?? (inputMode === "email" ? "email" : "text")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-describedby={foutId}
        aria-invalid={error ? true : undefined}
        style={{
          width: "100%",
          padding: "14px 16px",
          fontSize: "16px", // iOS zoom prevention
          borderRadius: "14px",
          border: `1.5px solid ${error ? "#ea4335" : "#e0e0e0"}`,
          background: "#fff",
          color: "#202124",
          fontFamily: "inherit",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {error && <p id={foutId} role="alert" style={{ fontSize: "13px", color: M3.error, marginTop: "6px" }}>{error}</p>}
    </div>
  );
}

// ── Choice card ───────────────────────────────────────────

function ChoiceCard({ active, onClick, icon, title, desc }: {
  active: boolean; onClick: () => void; icon: string; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "start",
        padding: "18px 20px",
        borderRadius: "18px",
        border: "none",
        background: active ? "#1a73e8" : "#f8f9fa",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        transition: "transform 0.1s",
      }}
    >
      <span style={{ fontSize: "26px" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: active ? "#fff" : "#202124" }}>{title}</p>
        <p style={{ margin: "2px 0 0", fontSize: "14px", color: active ? "rgba(255,255,255,0.75)" : "#5f6368" }}>{desc}</p>
      </div>
      {active && <span style={{ color: "#fff", fontSize: "16px" }}>✓</span>}
    </button>
  );
}

// ── Steps ─────────────────────────────────────────────────

function StepWelcome({ firstName }: { firstName: string }) {
  const t = translator(useLocale())
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <span style={{ fontSize: "52px" }}>👋</span>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>
          Welkom bij BoekBrug, {firstName}!
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          {t('onb.drieMinuten')}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {[t('onb.puntAlles'), t('onb.puntAI'), t('onb.puntKwijt')].map((punt) => (
          <div key={punt} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: M3.success, fontSize: "16px" }}>✓</span>
            <span style={{ fontSize: "15px", color: "#5f6368" }}>{punt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRole({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  const t = translator(useLocale())
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>{t('onb.wie')}</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>{t('onb.aanpassen')}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ChoiceCard active={role === "zzp"} onClick={() => setRole("zzp")} icon="💼" title={t('onb.zzp')} desc={t('onb.zzpDesc')} />
        <ChoiceCard active={role === "accountant"} onClick={() => setRole("accountant")} icon="📊" title={t('onb.boekhouder')} desc={t('onb.boekhouderDesc')} />
      </div>
    </div>
  );
}

function StepInvoiceStart({ value, onChange, error }: {
  value: string; onChange: (v: string) => void; error?: string;
}) {
  const t = translator(useLocale())
  const year = new Date().getFullYear();
  const trimmed = value.trim();
  const preview = trimmed ? previewInvoiceStart(trimmed, year) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>
          {t('onb.nummer')}
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          {t('onb.anderProgramma')}
        </p>
      </div>

      <Input
        id="ob-factuurnummer"
        label={t('onb.volgendNummer')}
        placeholder="bijv. 045-2026"
        value={value}
        onChange={onChange}
        error={error}
      />

      {/* live confirmation — the "understanding loop" */}
      {!trimmed && (
        <div style={{ fontSize: "14px", color: "#5f6368" }}>
          {t('onb.laatLeeg', { number: `${year}0001` })}
        </div>
      )}
      {trimmed && preview && preview.ok && (
        <div style={{
          background: "#e9f9ef", border: "1px solid #34a853", borderRadius: "14px",
          padding: "14px 16px", fontSize: "15px", color: "#202124",
        }}>
          <div>✓ {t('onb.eersteWordt')} <strong>{preview.first}</strong></div>
          <div style={{ marginTop: "4px", color: "#5f6368" }}>{t('onb.volgendeNummer', { number: preview.next })}</div>
        </div>
      )}
      {trimmed && preview && !preview.ok && preview.reason !== "empty" && (
        <div style={{
          background: "#fff4e5", border: "1px solid #e37400", borderRadius: "14px",
          padding: "14px 16px", fontSize: "14px", color: "#202124",
        }}>
          {reasonToDutch(preview.reason)}
        </div>
      )}
    </div>
  );
}

function StepManual({ company, setCompany, kvkError, setKvkError, btwError, setBtwError, ibanError, setIbanError, prefilledFromFactuur }: {
  prefilledFromFactuur?: boolean;
  company: CompanyData; setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  kvkError: string; setKvkError: (e: string) => void;
  btwError: string; setBtwError: (e: string) => void;
  ibanError: string; setIbanError: (e: string) => void;
}) {
  const t = translator(useLocale())
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>{t('onb.jouwBedrijf')}</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>{t('onb.alleenNaamUitleg')}</p>
      </div>
      {/* [FUNNEL-OVERDRACHT] Stil voorvullen zonder het te zeggen voelt als een systeem dat meer
          van je weet dan je dacht. Eén zin maakt er herkenning van — en noemt meteen dat het uit
          zijn eigen browser komt, niet uit iets dat wij al hadden. */}
      {prefilledFromFactuur && (
        <div
          role="status"
          style={{
            background: "#E6F4EA", border: "1px solid #137333", color: "#137333",
            borderRadius: 10, padding: "10px 12px", fontSize: 14, lineHeight: 1.5,
          }}
        >
          {t('onb.overgenomenUitFactuur')}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input id="ob-bedrijfsnaam" autoComplete="organization" label={t('onb.bedrijfsnaam')} placeholder="Mohammad BV" value={company.company_name}
          onChange={(v) => setCompany((p) => ({ ...p, company_name: v }))} />
        <Input id="ob-kvk" label={t('onb.kvk')} placeholder="12345678" value={company.kvk_number}
          inputMode="numeric" maxLength={8} error={kvkError}
          onChange={(v) => { setCompany((p) => ({ ...p, kvk_number: v })); setKvkError(""); }} />
        <Input id="ob-btw" label={t('onb.btw')} placeholder="NL123456789B01" value={company.btw_number} error={btwError}
          onChange={(v) => { setCompany((p) => ({ ...p, btw_number: v })); setBtwError(""); }} />
        <Input id="ob-iban" label={t('onb.iban')} placeholder="NL91ABNA0417164300" value={company.iban} error={ibanError}
          onChange={(v) => { setCompany((p) => ({ ...p, iban: v })); setIbanError(""); }} />
        <Input id="ob-adres" autoComplete="street-address" label={t('onb.adres')} placeholder="Straat 1, 1234 AB Stad" value={company.address}
          onChange={(v) => setCompany((p) => ({ ...p, address: v }))} />

        {/* [VAK-BRUG] The one question that lets the app configure itself, and it is optional.
            vak-sjablonen.ts has known eleven trades and their correct btw rates all along, and only
            the public invoice generator ever read them — so a barber who arrived any other way met
            an app that had no idea what he does: an empty price list, and a phone bar leading with
            Facturen he never sends. This answer decides what the app OFFERS and nothing about what
            he may do; leaving it blank keeps everything exactly as it was. */}
        <div>
          <label
            htmlFor="ob-vak"
            style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#202124", marginBottom: 6 }}
          >
            {t('onb.vak')}
          </label>
          <select
            id="ob-vak"
            value={company.vak}
            onChange={(e) => setCompany((p) => ({ ...p, vak: e.target.value }))}
            style={{
              width: "100%", fontSize: 16, padding: "12px 14px", borderRadius: 10,
              border: "1px solid #dadce0", background: "#fff", color: "#202124",
              boxSizing: "border-box",
            }}
          >
            <option value="">{t('onb.vak.leeg')}</option>
            {vakOpties().map((o) => (
              <option key={o.slug} value={o.slug}>{o.label}</option>
            ))}
          </select>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#5f6368" }}>{t('onb.vak.uitleg')}</p>
        </div>
      </div>
      {/* [COLD-START] Explain WHY "Volgende" is greyed out — a disabled button with
          no reason reads as "broken" to a first-time user. */}
      {!company.company_name.trim() && (
        <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
          {t('onb.naamVerplicht')}
        </p>
      )}
    </div>
  );
}

function StepOfficeDetails({ company, setCompany, kvkError, setKvkError }: {
  company: CompanyData; setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  kvkError: string; setKvkError: (e: string) => void;
}) {
  const t = translator(useLocale())
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>{t('onb.jouwKantoor')}</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>{t('onb.alleenNaam')}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input id="ob-kantoornaam" autoComplete="organization" label={t('onb.kantoornaam')} placeholder="Bakker Boekhouders" value={company.company_name}
          onChange={(v) => setCompany((p) => ({ ...p, company_name: v }))} />
        <Input id="ob-kantoor-kvk" label={t('onb.kvkKantoor')} placeholder="12345678" value={company.kvk_number}
          inputMode="numeric" maxLength={8} error={kvkError}
          onChange={(v) => { setCompany((p) => ({ ...p, kvk_number: v })); setKvkError(""); }} />
      </div>
      {/* [COLD-START] Explain WHY "Volgende" is greyed out (name is required). */}
      {!company.company_name.trim() && (
        <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
          {t('onb.kantoorVerplicht')}
        </p>
      )}
    </div>
  );
}

function StepGmail({ gmailConnected, onNext }: { gmailConnected: boolean; onNext: () => void }) {
  const t = translator(useLocale())
  // [BOEK-011] Fix 3: loading state while waiting for OAuth callback
  const [loading, setLoading] = useState(false);

  // [BOEK-015] fix: reset loading when user returns to tab without completing OAuth
  // window.location changes to Gmail → user cancels → comes back → loading was stuck
  useEffect(() => {
    if (!loading) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Give OAuth 500ms to redirect — if still here, user cancelled
        setTimeout(() => setLoading(false), 500);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [loading]);

  // [BOEK-011] Fix 2: show success state when gmail=connected in URL
  if (gmailConnected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: "40px", gap: "20px" }}>
        <span style={{ fontSize: "52px" }}>✅</span>
        <div>
          <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>
            {t('onb.gmailGelukt')}
          </h2>
          <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#5f6368" }}>
            {t('onb.importerenAchtergrond')}
          </p>
        </div>
        {/* [BOEK-015] fix: explicit button — auto-advance may not fire if step wasn't set */}
        <button
          type="button"
          onClick={onNext}
          style={{
            width: "100%", padding: "16px", borderRadius: "16px",
            fontSize: "16px", fontWeight: 600, background: "#1a73e8",
            color: "#fff", border: "none", cursor: "pointer",
          }}
        >
          {t('onb.volgende')} →
        </button>
        <p style={{ fontSize: "14px", color: "#5f6368" }}>{t('onb.autoVerder')}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>{t('onb.gmail')}</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          {t('onb.importerenNiks')}
        </p>
      </div>

      {/* [BOEK-011] Fix 3: loading spinner while waiting for OAuth */}
      {loading ? (
        <div style={{
          padding: "20px", borderRadius: "18px", background: "#f8f9fa",
          display: "flex", alignItems: "center", justifyContent: "center", gap: "12px",
        }}>
          <span style={{ fontSize: "20px" }}>⏳</span>
          <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#202124" }}>
            {t('onb.gmailOpen')}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            window.location.href = "/api/email/connect?provider=gmail&redirect=/onboarding";
          }}
          style={{
            textAlign: "start", padding: "20px", borderRadius: "18px", background: "#f8f9fa",
            border: "none", cursor: "pointer", width: "100%", display: "flex", alignItems: "flex-start", gap: "16px",
          }}
        >
          <span style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#EA4335", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "16px", flexShrink: 0 }}>G</span>
          <div>
            <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#202124" }}>{t('onb.gmailJa')}</p>
            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#5f6368" }}>{t('onb.importeren')}</p>
            <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#5f6368" }}>🔒 We lezen alleen factuur-bijlagen. Nooit persoonlijke e-mails.</p>
          </div>
        </button>
      )}

      <p style={{ textAlign: "center", fontSize: "14px", color: "#5f6368" }}>
        {t('onb.slaOverLater')}
      </p>
    </div>
  );
}

function StepAccountant({ accountantEmail, setAccountantEmail, error }: {
  accountantEmail: string; setAccountantEmail: (v: string) => void; error?: string;
}) {
  const t = translator(useLocale())
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>{t('onb.hebBoekhouder')}</h2>
        {/* [BELOFTE] Dit is de afloop van de hele belofte: hier wordt "staat klaar voor je
            boekhouder" iets echts. Daarom staat het resultaat er, niet de handeling.

            En hier stond een ONJUISTHEID: "hij kan dan al je facturen inzien". Dat spreekt
            voorwaarden §7.3 tegen — je boekhouder ziet NOOIT je concepten, alleen wat jij zelf
            hebt verstuurd, ontvangen of als betaald gemarkeerd. Een belofte over privacy die
            in de app ruimer klinkt dan in het contract is precies de verkeerde kant op fout. */}
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368", lineHeight: 1.55 }}>
          Nodig hem uit, dan haalt hij aan het eind van het kwartaal alles in één keer op.
          Hij ziet alleen wat jij zelf hebt verstuurd, ontvangen of als betaald hebt gemarkeerd —
          je concepten blijven van jou alleen.
        </p>
        <p style={{ margin: "10px 0 0", fontSize: "14.5px", color: "#5f6368", lineHeight: 1.55 }}>
          {t('onb.nogGeenBoekhouder')}
        </p>
      </div>
      <Input id="ob-boekhouder" label={t('onb.boekhouderEmail')} placeholder="jan@boekhouder.nl"
        value={accountantEmail} inputMode="email" autoComplete="email" error={error}
        onChange={setAccountantEmail} />
    </div>
  );
}

function StepInviteClient({ clientEmail, setClientEmail, error }: {
  clientEmail: string; setClientEmail: (v: string) => void; error?: string;
}) {
  const t = translator(useLocale())
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>{t('onb.eersteKlant')}</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          {t('onb.klantMail')}
        </p>
      </div>
      <Input id="ob-klant" label={t('onb.klantEmail')} placeholder="klant@bedrijf.nl"
        value={clientEmail} inputMode="email" autoComplete="email" error={error}
        onChange={setClientEmail} />
    </div>
  );
}

function StepDone({ firstName, role, missingSendFields }: { firstName: string; role: Role; missingSendFields: string[] }) {
  const t = translator(useLocale())
  // [TRUST-ONBOARDING] Be HONEST about readiness. The invoice-send route legally
  // requires bedrijfsnaam + BTW + KvK + adres; if any is still blank we must NOT
  // celebrate "klaar voor gebruik" and then hard-block the owner at their first
  // invoice. When something's missing we say so plainly and point to Instellingen.
  const needsMore = role === "zzp" && missingSendFields.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: "40px", gap: "16px" }}>
      <span style={{ fontSize: "60px" }}>{needsMore ? "👍" : "🎉"}</span>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>
          {needsMore ? t('onb.bijnaKlaar', { name: firstName }) : t('onb.jeBentKlaar', { name: firstName })}
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#5f6368" }}>
          {role === "accountant"
            ? t('onb.klaarAccountant')
            : needsMore
              ? t('onb.klaarNogEen')
              : t('onb.klaarIngericht')}
        </p>
      </div>
      {needsMore ? (
        <div style={{ background: "#FFF8E6", border: "1px solid #FFE9A8", borderRadius: "16px", padding: "16px 20px", fontSize: "14px", color: "#7C5800", textAlign: "start", width: "100%", lineHeight: 1.5 }}>
          {t('onb.vulNog', { fields: missingSendFields.join(', ') })}
        </div>
      ) : (
        <div style={{ background: "#f8f9fa", borderRadius: "16px", padding: "16px 20px", fontSize: "14px", color: "#5f6368", textAlign: "start", width: "100%" }}>
          💡 Tip: gebruik de zoekbalk om elke factuur in seconden terug te vinden
        </div>
      )}
    </div>
  );
}
