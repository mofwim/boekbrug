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

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// [FACTUUR-B] numbering extraction (client-side live preview)
import { previewInvoiceStart, reasonToDutch } from "@/lib/invoice-template";
// [TRUST-ONBOARDING] Validate the owner's OWN identity at entry — these validators
// already exist but the onboarding capture path never used them, so garbage BTW/IBAN
// was stored and later printed on a legal invoice. KvK stays the local KVK_REGEX.
import { BTW_REGEX } from "@/lib/validation";
import { isValidIban, normalizeIban } from "@/lib/epc-qr";
// ── Types ────────────────────────────────────────────────

type Role = "zzp" | "accountant";
type StepId = 1 | 2 | 3 | "3A" | "3B" | "3C" | 4 | 5 | 6;
interface CompanyData {
  company_name: string;
  kvk_number: string;
  btw_number: string;
  iban: string;
  address: string;
}

interface OnboardingWizardProps {
  userName: string;
  userEmail?: string;
  initialStep?: number;
  initialRole?: Role;
  roleWasSet?: boolean; // [BOEK-015] P2: true if user already chose role (skip step 2)
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
}: OnboardingWizardProps) {
  const firstName = userName.split(" ")[0] || "daar";
  // [BOEK-015] fix: DB default is 0 — clamp to 1 so Step 1 always renders
  const safeStep = Math.max(1, initialStep) as StepId;
  const [step, setStep] = useState<StepId>(safeStep);
  const [role, setRole] = useState<Role>(initialRole);
  // [BOEK-015] P2 fix: skip step 2 only when role was genuinely chosen before
  // roleWasSet comes from page.tsx (checks profile.role + onboarding_step)
  const roleAlreadySet = roleWasSet;
  const [company, setCompany] = useState<CompanyData>({
    company_name: "", kvk_number: "", btw_number: "", iban: "", address: "",
  });
  const [kvkError, setKvkError] = useState("");
  const [btwError, setBtwError] = useState("");
  const [ibanError, setIbanError] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // [BOEK-015] Reset saving state whenever step changes — safety net for all transitions
  // Placed after useState declaration to avoid hoisting confusion
  useEffect(() => {
    setSaving(false);
  }, [step]);

  // [FACTUUR-B] invoice numbering start (step 3C)
  const [invoiceStart, setInvoiceStart] = useState("");
  const [numberingError, setNumberingError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // [BOEK-011] Fix 2: detect gmail=connected from OAuth callback
  const [gmailConnected, setGmailConnected] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

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
      setGmailConnected(true);
      if (stepParam === "4") setStep(4);

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
    try {
      const res = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: true, role }),
      });
      if (!res.ok) {
        console.error("[BOEK-015] finish failed:", await res.text().catch(() => res.statusText));
        setFinishing(false);
        return; // stay on page — user can retry
      }
      // Use hard navigation to guarantee the redirect + fresh middleware check
      window.location.href = "/dashboard";
    } catch (err) {
      console.error("[BOEK-015] finish error:", err);
      setFinishing(false);
    }
  }

  // ── "Volgende" logic per step ──
  async function handleNext() {
    // [BOEK-015] fix: always wrap in try/finally so saving resets even on error
    setSaving(true);
    setSaveError("");
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
            setNumberingError("Kon de nummering niet opslaan — probeer opnieuw of sla over.");
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
        if (accountantEmail.trim()) {
          await fetch("/api/invite/accountant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountant_email: accountantEmail.trim() }),
          }).catch(() => {}); // non-blocking
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
        if (clientEmail.trim()) {
          await fetch("/api/invite/client", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_email: clientEmail.trim() }),
          }).catch(() => {});
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
      setSaveError("Opslaan mislukt — controleer je verbinding en probeer opnieuw.");
    }
    // Note: no finally — finish() navigates away, component unmounts naturally
  }

  async function handleSkip() {
    if (role === "zzp") {
      // [COLD-START] "Sla over" on "Hoe wil je beginnen?" means SKIP the setup —
      // go straight to Gmail (step 4). It used to silently drop the user into the
      // manual form (3B), which is the opposite of skipping. Company data can be
      // added later in Instellingen.
      if (step === 3) { await persistStep(4); setStep(4); return; }
      if (step === "3A" || step === "3B") { await persistStep(4); setStep(4); return; }
      if (step === "3C") { await persistStep(4); setStep(4); return; } // [FACTUUR-B]
      if (step === 4) { await persistStep(5); setStep(5); return; }
      if (step === 5) { await finish(); return; }
    }
    if (role === "accountant") {
      if (step === 3) { await persistStep(4); setStep(4); return; }
      if (step === 4) { await finish(); return; }
    }
  }

  // [BOEK-015] Reset — clears all onboarding data and starts from Step 1
  async function handleReset() {
    setResetting(true);
    try {
      await fetch("/api/onboarding/reset", { method: "DELETE" });
    } catch {
      // silent — redirect anyway
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
        <a href="/" style={{ textDecoration: "none" }}>
          <span style={{ fontSize: "20px", fontWeight: 700, color: "#1a73e8", letterSpacing: "-0.5px" }}>
            BoekBrug
          </span>
        </a>
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

      {/* Content */}
      <div className="flex-1 flex flex-col px-6 pt-10 pb-8 w-full" style={{ maxWidth: "480px", margin: "0 auto" }}>
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
            <StepAccountant accountantEmail={accountantEmail} setAccountantEmail={setAccountantEmail} />
          )}
          {role === "zzp" && step === 6 && (
            <StepDone
              firstName={firstName}
              role="zzp"
              missingSendFields={[
                !company.company_name.trim() && "bedrijfsnaam",
                !company.btw_number.trim() && "BTW-nummer",
                !company.kvk_number.trim() && "KvK-nummer",
                !company.address.trim() && "adres",
              ].filter(Boolean) as string[]}
            />
          )}

          {/* Accountant */}
          {role === "accountant" && step === 3 && (
            <StepOfficeDetails company={company} setCompany={setCompany} kvkError={kvkError} setKvkError={setKvkError} />
          )}
          {role === "accountant" && step === 4 && (
            <StepInviteClient clientEmail={clientEmail} setClientEmail={setClientEmail} />
          )}
          {role === "accountant" && step === 5 && <StepDone firstName={firstName} role="accountant" missingSendFields={[]} />}
        </div>

        {/* Buttons */}
        <div className="mt-8 space-y-3">
          {saveError && (
            <p style={{ margin: 0, fontSize: "13.5px", color: "#B3261E", textAlign: "center" }}>{saveError}</p>
          )}
          {isDone ? (
            <Btn onClick={finish} loading={finishing}>Ga naar mijn dashboard →</Btn>
          ) : (
            !hideNextButton && <Btn onClick={handleNext} loading={saving} disabled={isNextDisabled}>Volgende</Btn>
          )}
          {showSkip && (
            <button
              onClick={handleSkip}
              style={{ width: "100%", padding: "12px", fontSize: "15px", color: "#5f6368", background: "none", border: "none", cursor: "pointer" }}
            >
              Sla over
            </button>
          )}

          {/* [BOEK-015] Reset button — shown from step 2 onwards, hidden on done */}
          {!isDone && step !== 1 && (
            <button
              onClick={() => setShowResetConfirm(true)}
              disabled={resetting || saving}
              style={{ width: "100%", padding: "8px", fontSize: "13px", color: "#dadce0", background: "none", border: "none", cursor: "pointer" }}
            >
              Opnieuw beginnen
            </button>
          )}
        </div>
      </div>

      {/* [BOEK-015] Reset confirmation dialog */}
      {showResetConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          zIndex: 1000, paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          <div style={{
            background: "#fff", borderRadius: "20px 20px 0 0",
            padding: "24px 20px 32px", width: "100%", maxWidth: "480px",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700, color: "#202124", textAlign: "center" }}>
              Opnieuw beginnen?
            </h3>
            <p style={{ margin: "0 0 24px", fontSize: "15px", color: "#5f6368", textAlign: "center" }}>
              Je ingevoerde gegevens worden gewist. Gmail blijft gekoppeld.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
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
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                style={{
                  padding: "16px", borderRadius: "14px", fontSize: "16px",
                  fontWeight: 600, background: "#f8f9fa", color: "#202124",
                  border: "none", cursor: "pointer",
                }}
              >
                Annuleren
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

function Input({ label, placeholder, value, onChange, inputMode, maxLength, error, type }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number; error?: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "14px", fontWeight: 500, color: "#202124", marginBottom: "8px" }}>
        {label}
      </label>
      <input
        type={type ?? (inputMode === "email" ? "email" : "text")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
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
      {error && <p style={{ fontSize: "13px", color: "#ea4335", marginTop: "6px" }}>{error}</p>}
    </div>
  );
}

// ── Choice card ───────────────────────────────────────────

function ChoiceCard({ active, onClick, icon, title, desc }: {
  active: boolean; onClick: () => void; icon: string; title: string; desc: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <span style={{ fontSize: "52px" }}>👋</span>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>
          Welkom bij BoekBrug, {firstName}!
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          Laten we je account in 3 minuten instellen.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {["Alle facturen op één plek", "AI leest je documenten automatisch", "Nooit meer een factuur kwijt"].map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: "#34a853", fontSize: "16px" }}>✓</span>
            <span style={{ fontSize: "15px", color: "#5f6368" }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRole({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>Wie ben jij?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>We passen BoekBrug aan op jouw situatie.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ChoiceCard active={role === "zzp"} onClick={() => setRole("zzp")} icon="💼" title="Ik ben ZZP'er" desc="Ik stuur en ontvang facturen" />
        <ChoiceCard active={role === "accountant"} onClick={() => setRole("accountant")} icon="📊" title="Ik ben boekhouder" desc="Ik beheer facturen voor klanten" />
      </div>
    </div>
  );
}

function StepInvoiceStart({ value, onChange, error }: {
  value: string; onChange: (v: string) => void; error?: string;
}) {
  const year = new Date().getFullYear();
  const trimmed = value.trim();
  const preview = trimmed ? previewInvoiceStart(trimmed, year) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>
          Met welk factuurnummer wil je beginnen?
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          Kom je van een ander programma? Vul je volgende factuurnummer in —
          wij gaan verder waar jij gebleven bent.
        </p>
      </div>

      <Input
        label="Je volgende factuurnummer"
        placeholder="bijv. 045-2026"
        value={value}
        onChange={onChange}
        error={error}
      />

      {/* live confirmation — the "understanding loop" */}
      {!trimmed && (
        <div style={{ fontSize: "14px", color: "#5f6368" }}>
          Laat leeg om bij <strong>{year}0001</strong> te beginnen.
        </div>
      )}
      {trimmed && preview && preview.ok && (
        <div style={{
          background: "#e9f9ef", border: "1px solid #34a853", borderRadius: "14px",
          padding: "14px 16px", fontSize: "15px", color: "#202124",
        }}>
          <div>✓ Je eerste factuur wordt: <strong>{preview.first}</strong></div>
          <div style={{ marginTop: "4px", color: "#5f6368" }}>De volgende: {preview.next}</div>
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

function StepManual({ company, setCompany, kvkError, setKvkError, btwError, setBtwError, ibanError, setIbanError }: {
  company: CompanyData; setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  kvkError: string; setKvkError: (e: string) => void;
  btwError: string; setBtwError: (e: string) => void;
  ibanError: string; setIbanError: (e: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>Jouw bedrijf</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>Alleen de naam is verplicht om verder te gaan. BTW-nummer, adres en IBAN heb je nodig om facturen te versturen — vul ze nu in (dat mag ook later in Instellingen).</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input label="Wat is je bedrijfsnaam?" placeholder="Mohammad BV" value={company.company_name}
          onChange={(v) => setCompany((p) => ({ ...p, company_name: v }))} />
        <Input label="Wat is je KVK-nummer? (optioneel)" placeholder="12345678" value={company.kvk_number}
          inputMode="numeric" maxLength={8} error={kvkError}
          onChange={(v) => { setCompany((p) => ({ ...p, kvk_number: v })); setKvkError(""); }} />
        <Input label="Wat is je BTW-nummer? (nodig om facturen te versturen)" placeholder="NL123456789B01" value={company.btw_number} error={btwError}
          onChange={(v) => { setCompany((p) => ({ ...p, btw_number: v })); setBtwError(""); }} />
        <Input label="Wat is je IBAN? (voor betaalverzoeken)" placeholder="NL91ABNA0417164300" value={company.iban} error={ibanError}
          onChange={(v) => { setCompany((p) => ({ ...p, iban: v })); setIbanError(""); }} />
        <Input label="Wat is je adres? (nodig om facturen te versturen)" placeholder="Straat 1, 1234 AB Stad" value={company.address}
          onChange={(v) => setCompany((p) => ({ ...p, address: v }))} />
      </div>
      {/* [COLD-START] Explain WHY "Volgende" is greyed out — a disabled button with
          no reason reads as "broken" to a first-time user. */}
      {!company.company_name.trim() && (
        <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
          Vul je bedrijfsnaam in om verder te gaan.
        </p>
      )}
    </div>
  );
}

function StepOfficeDetails({ company, setCompany, kvkError, setKvkError }: {
  company: CompanyData; setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  kvkError: string; setKvkError: (e: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>Jouw kantoor</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>Alleen de naam is nodig — de rest kun je later aanpassen.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input label="Naam van je kantoor" placeholder="Bakker Boekhouders" value={company.company_name}
          onChange={(v) => setCompany((p) => ({ ...p, company_name: v }))} />
        <Input label="KVK-nummer van je kantoor (optioneel)" placeholder="12345678" value={company.kvk_number}
          inputMode="numeric" maxLength={8} error={kvkError}
          onChange={(v) => { setCompany((p) => ({ ...p, kvk_number: v })); setKvkError(""); }} />
      </div>
      {/* [COLD-START] Explain WHY "Volgende" is greyed out (name is required). */}
      {!company.company_name.trim() && (
        <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
          Vul de naam van je kantoor in om verder te gaan.
        </p>
      )}
    </div>
  );
}

function StepGmail({ gmailConnected, onNext }: { gmailConnected: boolean; onNext: () => void }) {
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
            Gmail succesvol gekoppeld!
          </h2>
          <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#5f6368" }}>
            We importeren je facturen automatisch op de achtergrond.
          </p>
        </div>
        {/* [BOEK-015] fix: explicit button — auto-advance may not fire if step wasn't set */}
        <button
          onClick={onNext}
          style={{
            width: "100%", padding: "16px", borderRadius: "16px",
            fontSize: "16px", fontWeight: 600, background: "#1a73e8",
            color: "#fff", border: "none", cursor: "pointer",
          }}
        >
          Volgende →
        </button>
        <p style={{ fontSize: "14px", color: "#5f6368" }}>Of wacht even, je gaat automatisch verder…</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>Wil je je Gmail koppelen?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          We importeren automatisch je facturen. Jij hoeft niets te doen.
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
            Gmail openen…
          </p>
        </div>
      ) : (
        <button
          onClick={() => {
            setLoading(true);
            window.location.href = "/api/email/connect?provider=gmail&redirect=/onboarding";
          }}
          style={{
            textAlign: "left", padding: "20px", borderRadius: "18px", background: "#f8f9fa",
            border: "none", cursor: "pointer", width: "100%", display: "flex", alignItems: "flex-start", gap: "16px",
          }}
        >
          <span style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#EA4335", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "16px", flexShrink: 0 }}>G</span>
          <div>
            <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#202124" }}>Ja, koppel mijn Gmail</p>
            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#5f6368" }}>We importeren automatisch je facturen.</p>
            <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#5f6368" }}>🔒 We lezen alleen factuur-bijlagen. Nooit persoonlijke e-mails.</p>
          </div>
        </button>
      )}

      <p style={{ textAlign: "center", fontSize: "14px", color: "#5f6368" }}>
        Tik op &ldquo;Sla over&rdquo; om dit later in te stellen
      </p>
    </div>
  );
}

function StepAccountant({ accountantEmail, setAccountantEmail }: {
  accountantEmail: string; setAccountantEmail: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>Heb je een boekhouder?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          Stuur een uitnodiging — hij kan dan al je facturen inzien.
        </p>
      </div>
      <Input label="E-mailadres boekhouder" placeholder="jan@boekhouder.nl"
        value={accountantEmail} inputMode="email" onChange={setAccountantEmail} />
    </div>
  );
}

function StepInviteClient({ clientEmail, setClientEmail }: {
  clientEmail: string; setClientEmail: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#202124" }}>Voeg je eerste klant toe</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#5f6368" }}>
          Je klant ontvangt een e-mail om zijn account aan te maken.
        </p>
      </div>
      <Input label="E-mailadres klant" placeholder="klant@bedrijf.nl"
        value={clientEmail} inputMode="email" onChange={setClientEmail} />
    </div>
  );
}

function StepDone({ firstName, role, missingSendFields }: { firstName: string; role: Role; missingSendFields: string[] }) {
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
          {needsMore ? `Bijna klaar, ${firstName}!` : `Je bent klaar, ${firstName}!`}
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#5f6368" }}>
          {role === "accountant"
            ? "Nodig klanten uit en beheer alles op één plek."
            : needsMore
              ? "Je kunt meteen aan de slag. Eén ding nog voordat je facturen kunt versturen:"
              : "BoekBrug is ingericht en klaar voor gebruik."}
        </p>
      </div>
      {needsMore ? (
        <div style={{ background: "#FFF8E6", border: "1px solid #FFE9A8", borderRadius: "16px", padding: "16px 20px", fontSize: "14px", color: "#7C5800", textAlign: "left", width: "100%", lineHeight: 1.5 }}>
          Vul nog je <strong>{missingSendFields.join(", ")}</strong> in bij <strong>Instellingen</strong> — dat is wettelijk verplicht op een factuur. Zonder deze gegevens kun je nog geen factuur versturen.
        </div>
      ) : (
        <div style={{ background: "#f8f9fa", borderRadius: "16px", padding: "16px 20px", fontSize: "14px", color: "#5f6368", textAlign: "left", width: "100%" }}>
          💡 Tip: gebruik de zoekbalk om elke factuur in seconden terug te vinden
        </div>
      )}
    </div>
  );
}

// ── Helper ───────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(new Error("Bestand kon niet worden gelezen"));
    reader.readAsDataURL(file);
  });
}