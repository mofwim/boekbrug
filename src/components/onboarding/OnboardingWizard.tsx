// src/components/onboarding/OnboardingWizard.tsx
// [BOEK-015] Smart Onboarding — Complete Redesign — May 2026
//
// ZZP'er flow:  1=Welcome → 2=Role → 3=HowToStart → 3A=AIUpload | 3B=Manual → 4=Gmail → 5=Accountant → 6=Done
// Accountant:   1=Welcome → 2=Role → 3=OfficeDetails → 4=InviteClient → 5=Done
//
// Rules:
// - Eén vraag per scherm
// - Geen technische termen
// - Minimale invoer — AI doet het werk
// - font-size 16px op inputs (iOS zoom prevention)
// - env(safe-area-inset-bottom) op bottom

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ── Types ────────────────────────────────────────────────

type Role = "zzp" | "accountant";
type StepId = 1 | 2 | 3 | "3A" | "3B" | 4 | 5 | 6;

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
}

// ── Progress mapping ─────────────────────────────────────

function stepToProgress(step: StepId, role: Role): number {
  if (role === "accountant") {
    const map: Record<string, number> = { "1": 10, "2": 30, "3": 55, "4": 80, "5": 100 };
    return map[String(step)] ?? 10;
  }
  const map: Record<string, number> = {
    "1": 5, "2": 20, "3": 35, "3A": 52, "3B": 52, "4": 70, "5": 85, "6": 100,
  };
  return map[String(step)] ?? 5;
}

const KVK_REGEX = /^\d{8}$/;

// ── Main component ──────────────────────────────────────

export function OnboardingWizard({
  userName,
  initialStep = 1,
  initialRole = "zzp",
}: OnboardingWizardProps) {
  const firstName = userName.split(" ")[0] || "daar";
  // [BOEK-015] fix: DB default is 0 — clamp to 1 so Step 1 always renders
  const safeStep = Math.max(1, initialStep) as StepId;
  const [step, setStep] = useState<StepId>(safeStep);
  const [role, setRole] = useState<Role>(initialRole);

  // [BOEK-015] P2 fix: if role already set (from register page) skip step 2
  // initialRole comes from profiles.role — if 'zzper' or 'accountant', user already chose
  // [BOEK-015] P2: use initialStep (number) not safeStep (StepId = string|number)
  const roleAlreadySet = initialRole !== "zzp" || (typeof initialStep === "number" && initialStep > 2);
  const [company, setCompany] = useState<CompanyData>({
    company_name: "", kvk_number: "", btw_number: "", iban: "", address: "",
  });
  const [kvkError, setKvkError] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // [BOEK-011] Fix 2: detect gmail=connected from OAuth callback
  const [gmailConnected, setGmailConnected] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const progress = stepToProgress(step, role);

  async function persistStep(nextStep: number, extra?: Record<string, unknown>) {
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep, role, ...extra }),
    });
  }

  // [BOEK-011] Fix 2: detect gmail=connected after OAuth callback redirect
  useEffect(() => {
    const gmail = searchParams.get("gmail");
    const stepParam = searchParams.get("step");

    if (gmail === "connected") {
      setGmailConnected(true);
      if (stepParam === "4") setStep(4);

      // Auto-advance to step 5 after 2 seconds — user sees the success state
      const timer = setTimeout(async () => {
        await persistStep(5);
        setStep(5);
      }, 2000);

      // Clean URL without reload
      window.history.replaceState({}, "", "/onboarding");

      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish() {
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true, role }),
    });
    router.push("/dashboard");
  }

  // ── "Volgende" logic per step ──
  async function handleNext() {
    // [BOEK-015] fix: always wrap in try/finally so saving resets even on error
    setSaving(true);
    try {
    if (role === "zzp") {
      if (step === 1) {
        // [BOEK-015] P2: skip role step if already set from register
        if (roleAlreadySet) { await persistStep(3); setStep(3); } else { await persistStep(2); setStep(2); }
        return;
      }
      if (step === 2) { await persistStep(3); setStep(3); return; }
      if (step === "3B") {
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
      if (step === 1) { await persistStep(2); setStep(2); return; }
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
    }
    // Note: no finally — finish() navigates away, component unmounts naturally
  }

  async function handleSkip() {
    if (role === "zzp") {
      if (step === 3) { setStep("3B"); return; }
      if (step === "3A" || step === "3B") { await persistStep(4); setStep(4); return; }
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
  const hideNextButton = step === 3 || step === "3A" || step === 4;
  const showSkip =
    !isDone && step !== 1 && step !== 2 &&
    !(role === "zzp" && step === 6) &&
    !(role === "accountant" && step === 5);

  // [BOEK-015] Fix 3: disable Volgende until company_name is filled
  const isCompanyStep = step === "3B" || (role === "accountant" && step === 3);
  const kvkVal = company.kvk_number.trim();
  const isNextDisabled = isCompanyStep && (
    !company.company_name.trim() ||
    (kvkVal.length > 0 && !/^\d{8}$/.test(kvkVal))
  );

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
          <span style={{ fontSize: "20px", fontWeight: 700, color: "#007aff", letterSpacing: "-0.5px" }}>
            BoekBrug
          </span>
        </a>
        <span style={{ fontSize: "13px", color: "#aeaeb2" }}>
          Stap {typeof step === "string" ? step.replace("3A","3").replace("3B","3") : step} van {role === "accountant" ? 5 : 6}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: "3px", background: "#e5e5ea", marginTop: "12px" }}>
        <div
          style={{
            height: "3px",
            width: `${progress}%`,
            background: "#007aff",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col px-6 pt-10 pb-8 w-full" style={{ maxWidth: "480px", margin: "0 auto" }}>
        <div className="flex-1">

          {step === 1 && <StepWelcome firstName={firstName} />}
          {step === 2 && <StepRole role={role} setRole={setRole} />}

          {/* ZZP */}
          {role === "zzp" && step === 3 && (
            <StepHowToStart
              onUpload={() => setStep("3A")}
              onManual={() => setStep("3B")}
            />
          )}
          {role === "zzp" && step === "3A" && (
            <StepAIUpload
              company={company}
              setCompany={setCompany}
              onSuccess={async () => {
                await persistStep(4, {
                  company_name: company.company_name || null,
                  kvk_number: company.kvk_number || null,
                  btw_number: company.btw_number || null,
                  iban: company.iban || null,
                  address: company.address || null,
                });
                setStep(4);
              }}
              onFallback={() => setStep("3B")}
            />
          )}
          {role === "zzp" && step === "3B" && (
            <StepManual company={company} setCompany={setCompany} kvkError={kvkError} setKvkError={setKvkError} />
          )}
          {role === "zzp" && step === 4 && <StepGmail gmailConnected={gmailConnected} onNext={handleNext} />}
          {role === "zzp" && step === 5 && (
            <StepAccountant accountantEmail={accountantEmail} setAccountantEmail={setAccountantEmail} />
          )}
          {role === "zzp" && step === 6 && <StepDone firstName={firstName} role="zzp" />}

          {/* Accountant */}
          {role === "accountant" && step === 3 && (
            <StepOfficeDetails company={company} setCompany={setCompany} kvkError={kvkError} setKvkError={setKvkError} />
          )}
          {role === "accountant" && step === 4 && (
            <StepInviteClient clientEmail={clientEmail} setClientEmail={setClientEmail} />
          )}
          {role === "accountant" && step === 5 && <StepDone firstName={firstName} role="accountant" />}
        </div>

        {/* Buttons */}
        <div className="mt-8 space-y-3">
          {isDone ? (
            <Btn onClick={finish} loading={saving}>Ga naar mijn dashboard →</Btn>
          ) : (
            !hideNextButton && <Btn onClick={handleNext} loading={saving} disabled={isNextDisabled}>Volgende</Btn>
          )}
          {showSkip && (
            <button
              onClick={handleSkip}
              style={{ width: "100%", padding: "12px", fontSize: "15px", color: "#8e8e93", background: "none", border: "none", cursor: "pointer" }}
            >
              Sla over
            </button>
          )}

          {/* [BOEK-015] Reset button — shown from step 2 onwards, hidden on done */}
          {!isDone && step !== 1 && (
            <button
              onClick={() => setShowResetConfirm(true)}
              disabled={resetting || saving}
              style={{ width: "100%", padding: "8px", fontSize: "13px", color: "#c7c7cc", background: "none", border: "none", cursor: "pointer" }}
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
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700, color: "#1c1c1e", textAlign: "center" }}>
              Opnieuw beginnen?
            </h3>
            <p style={{ margin: "0 0 24px", fontSize: "15px", color: "#6b6b6e", textAlign: "center" }}>
              Je ingevoerde gegevens worden gewist. Gmail blijft gekoppeld.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                onClick={handleReset}
                disabled={resetting}
                style={{
                  padding: "16px", borderRadius: "14px", fontSize: "16px",
                  fontWeight: 600, background: "#ff3b30", color: "#fff",
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
                  fontWeight: 600, background: "#f2f2f7", color: "#1c1c1e",
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
        background: isOff ? "#c7c7cc" : secondary ? "#f2f2f7" : "#007aff",
        color: secondary ? "#007aff" : "#fff",
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
      <label style={{ display: "block", fontSize: "14px", fontWeight: 500, color: "#1c1c1e", marginBottom: "8px" }}>
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
          border: `1.5px solid ${error ? "#ff3b30" : "#e5e5ea"}`,
          background: "#fff",
          color: "#1c1c1e",
          fontFamily: "inherit",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {error && <p style={{ fontSize: "13px", color: "#ff3b30", marginTop: "6px" }}>{error}</p>}
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
        background: active ? "#007aff" : "#f2f2f7",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        transition: "transform 0.1s",
      }}
    >
      <span style={{ fontSize: "26px" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: active ? "#fff" : "#1c1c1e" }}>{title}</p>
        <p style={{ margin: "2px 0 0", fontSize: "14px", color: active ? "rgba(255,255,255,0.75)" : "#6b6b6e" }}>{desc}</p>
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
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>
          Welkom bij BoekBrug, {firstName}!
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
          Laten we je account in 3 minuten instellen.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {["Alle facturen op één plek", "AI leest je documenten automatisch", "Nooit meer een factuur kwijt"].map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: "#34c759", fontSize: "16px" }}>✓</span>
            <span style={{ fontSize: "15px", color: "#6b6b6e" }}>{t}</span>
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
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Wie ben jij?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>We passen BoekBrug aan op jouw situatie.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ChoiceCard active={role === "zzp"} onClick={() => setRole("zzp")} icon="💼" title="Ik ben ZZP'er" desc="Ik stuur en ontvang facturen" />
        <ChoiceCard active={role === "accountant"} onClick={() => setRole("accountant")} icon="📊" title="Ik ben boekhouder" desc="Ik beheer facturen voor klanten" />
      </div>
    </div>
  );
}

function StepHowToStart({ onUpload, onManual }: { onUpload: () => void; onManual: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Hoe wil je beginnen?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>Kies de makkelijkste manier voor jou.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <button
          onClick={onUpload}
          style={{
            textAlign: "left", padding: "20px", borderRadius: "18px", background: "#f2f2f7",
            border: "none", cursor: "pointer", width: "100%",
          }}
        >
          <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1c1c1e" }}>📄 Upload een factuur</p>
          <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#6b6b6e", lineHeight: 1.5 }}>
            We lezen je bedrijfsgegevens automatisch uit — je hoeft niets zelf in te typen.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#8e8e93" }}>🔒 Jouw gegevens blijven privé.</p>
        </button>
        <button
          onClick={onManual}
          style={{
            textAlign: "left", padding: "20px", borderRadius: "18px", background: "#f2f2f7",
            border: "none", cursor: "pointer", width: "100%",
          }}
        >
          <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1c1c1e" }}>✏️ Zelf invullen</p>
          <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#6b6b6e" }}>
            Vul je gegevens stap voor stap handmatig in.
          </p>
        </button>
      </div>
    </div>
  );
}

type UploadState = "idle" | "uploading" | "success" | "editing" | "error";

function StepAIUpload({ company, setCompany, onSuccess, onFallback }: {
  company: CompanyData;
  setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  onSuccess: () => void;
  onFallback: () => void;
}) {
  const [state, setState] = useState<UploadState>("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setState("uploading");
    try {
      // [BOEK-015] Step 1: upload file via /api/files to get a documentId
      const now = new Date();
      const year = String(now.getFullYear());
      const quarter = String(Math.ceil((now.getMonth() + 1) / 3));

      // [BOEK-015] fix: unique filename prevents Supabase Storage collision
      // error "The resource already exists" = same path uploaded twice
      const ext = file.name.split(".").pop() ?? "pdf";
      const uniqueName = `onboarding-${Date.now()}.${ext}`;
      const renamedFile = new File([file], uniqueName, { type: file.type });

      const formData = new FormData();
      formData.append("file", renamedFile);   // renamed — no collision
      formData.append("year", year);
      formData.append("quarter", quarter);
      // doc_type omitted — not required, avoids constraint issues

      const uploadRes = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) { setState("error"); return; }

      const uploadData = await uploadRes.json();
      const documentId: string = uploadData.id ?? uploadData.document?.id;

      if (!documentId) { setState("error"); return; }

      // [BOEK-015] Step 2: extract company details via /api/onboarding/extract
      // This endpoint uses extractCompanyDetails from @/lib/ai
      // It reads the actual PDF/image content and returns: company_name, kvk, btw, iban
      const extractRes = await fetch("/api/onboarding/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, fileName: file.name, mimeType: file.type }),
      });

      const extractData = await extractRes.json();

      if (extractData.found) {
        setCompany((p) => ({
          ...p,
          company_name: extractData.company_name ?? p.company_name,
          kvk_number: extractData.kvk_number ?? p.kvk_number,
          btw_number: extractData.btw_number ?? p.btw_number,
          iban: extractData.iban ?? p.iban,
          address: extractData.address ?? p.address,
        }));
        setState("success");
      } else {
        // AI found nothing useful → guide user to manual form
        onFallback();
      }
    } catch {
      setState("error");
    }
  }

  if (state === "uploading") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "60px", gap: "16px" }}>
      <span style={{ fontSize: "40px" }}>✨</span>
      <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1c1c1e" }}>We lezen je factuur uit…</p>
      <p style={{ margin: 0, fontSize: "14px", color: "#8e8e93" }}>Dit duurt maar even</p>
    </div>
  );

  if (state === "success") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#34c759" }}>✓ We hebben je gegevens gevonden!</p>
      <div style={{ background: "#f2f2f7", borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {([["Bedrijfsnaam", company.company_name], ["KVK", company.kvk_number], ["BTW", company.btw_number], ["IBAN", company.iban]] as [string, string][])
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "14px", color: "#8e8e93" }}>{label}</span>
              <span style={{ fontSize: "14px", fontWeight: 500, color: "#1c1c1e" }}>{value}</span>
            </div>
          ))}
      </div>
      <Btn onClick={onSuccess}>✓ Ja, ga verder</Btn>
      <Btn onClick={() => setState("editing")} secondary>Aanpassen</Btn>
    </div>
  );

  if (state === "editing") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1c1c1e" }}>Gegevens aanpassen</h3>
      {(["company_name", "kvk_number", "btw_number", "iban"] as (keyof CompanyData)[]).map((f) => (
        <Input key={f} label={f === "company_name" ? "Bedrijfsnaam" : f === "kvk_number" ? "KVK-nummer" : f === "btw_number" ? "BTW-nummer" : "IBAN"}
          placeholder="" value={company[f]} onChange={(v) => setCompany((p) => ({ ...p, [f]: v }))} />
      ))}
      <Btn onClick={onSuccess}>Opslaan en verder</Btn>
    </div>
  );

  if (state === "error") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ color: "#ff3b30", fontSize: "15px" }}>Er ging iets mis. Probeer opnieuw of vul handmatig in.</p>
      <Btn onClick={() => setState("idle")}>Opnieuw proberen</Btn>
      <Btn onClick={onFallback} secondary>Handmatig invullen</Btn>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Upload een factuur</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
          We lezen je bedrijfsgegevens automatisch uit.
        </p>
      </div>
      <button
        onClick={() => fileRef.current?.click()}
        style={{
          padding: "40px 20px", borderRadius: "18px", border: "2px dashed #c7c7cc",
          background: "#f9f9fb", cursor: "pointer", display: "flex", flexDirection: "column",
          alignItems: "center", gap: "12px", width: "100%",
        }}
      >
        <span style={{ fontSize: "40px" }}>📄</span>
        <span style={{ fontSize: "16px", fontWeight: 600, color: "#1c1c1e" }}>Tik om te uploaden</span>
        <span style={{ fontSize: "14px", color: "#8e8e93" }}>PDF, JPG of PNG — max 25 MB</span>
      </button>
      {/* [BOEK-015] fix: expanded accept — includes webp, heic, application/pdf */}
      <input ref={fileRef} type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      <div style={{ background: "#f2f2f7", borderRadius: "14px", padding: "14px 16px", display: "flex", gap: "10px" }}>
        <span>🔒</span>
        <p style={{ margin: 0, fontSize: "13px", color: "#6b6b6e" }}>
          Jouw gegevens blijven privé. We lezen alleen je bedrijfsgegevens uit.
        </p>
      </div>
    </div>
  );
}

function StepManual({ company, setCompany, kvkError, setKvkError }: {
  company: CompanyData; setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  kvkError: string; setKvkError: (e: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Jouw bedrijf</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>Twee velden — de rest vul je later in.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input label="Wat is je bedrijfsnaam?" placeholder="Mohammad BV" value={company.company_name}
          onChange={(v) => setCompany((p) => ({ ...p, company_name: v }))} />
        <Input label="Wat is je KVK-nummer?" placeholder="12345678" value={company.kvk_number}
          inputMode="numeric" maxLength={8} error={kvkError}
          onChange={(v) => { setCompany((p) => ({ ...p, kvk_number: v })); setKvkError(""); }} />
      </div>
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
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Jouw kantoor</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>Optioneel — je kunt dit later aanpassen.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input label="Naam van je kantoor" placeholder="Bakker Boekhouders" value={company.company_name}
          onChange={(v) => setCompany((p) => ({ ...p, company_name: v }))} />
        <Input label="KVK-nummer van je kantoor" placeholder="12345678" value={company.kvk_number}
          inputMode="numeric" maxLength={8} error={kvkError}
          onChange={(v) => { setCompany((p) => ({ ...p, kvk_number: v })); setKvkError(""); }} />
      </div>
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
          <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>
            Gmail succesvol gekoppeld!
          </h2>
          <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
            We importeren je facturen automatisch op de achtergrond.
          </p>
        </div>
        {/* [BOEK-015] fix: explicit button — auto-advance may not fire if step wasn't set */}
        <button
          onClick={onNext}
          style={{
            width: "100%", padding: "16px", borderRadius: "16px",
            fontSize: "16px", fontWeight: 600, background: "#007aff",
            color: "#fff", border: "none", cursor: "pointer",
          }}
        >
          Volgende →
        </button>
        <p style={{ fontSize: "14px", color: "#8e8e93" }}>Of wacht even, je gaat automatisch verder…</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Wil je je Gmail koppelen?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
          We importeren automatisch je facturen. Jij hoeft niets te doen.
        </p>
      </div>

      {/* [BOEK-011] Fix 3: loading spinner while waiting for OAuth */}
      {loading ? (
        <div style={{
          padding: "20px", borderRadius: "18px", background: "#f2f2f7",
          display: "flex", alignItems: "center", justifyContent: "center", gap: "12px",
        }}>
          <span style={{ fontSize: "20px" }}>⏳</span>
          <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1c1c1e" }}>
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
            textAlign: "left", padding: "20px", borderRadius: "18px", background: "#f2f2f7",
            border: "none", cursor: "pointer", width: "100%", display: "flex", alignItems: "flex-start", gap: "16px",
          }}
        >
          <span style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#EA4335", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "16px", flexShrink: 0 }}>G</span>
          <div>
            <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#1c1c1e" }}>Ja, koppel mijn Gmail</p>
            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#6b6b6e" }}>We importeren automatisch je facturen.</p>
            <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#8e8e93" }}>🔒 We lezen alleen factuur-bijlagen. Nooit persoonlijke e-mails.</p>
          </div>
        </button>
      )}

      <p style={{ textAlign: "center", fontSize: "14px", color: "#8e8e93" }}>
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
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Heb je een boekhouder?</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
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
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>Voeg je eerste klant toe</h2>
        <p style={{ margin: "8px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
          Je klant ontvangt een e-mail om zijn account aan te maken.
        </p>
      </div>
      <Input label="E-mailadres klant" placeholder="klant@bedrijf.nl"
        value={clientEmail} inputMode="email" onChange={setClientEmail} />
    </div>
  );
}

function StepDone({ firstName, role }: { firstName: string; role: Role }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: "40px", gap: "16px" }}>
      <span style={{ fontSize: "60px" }}>🎉</span>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#1c1c1e" }}>
          Je bent klaar, {firstName}!
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#6b6b6e" }}>
          {role === "accountant"
            ? "Nodig klanten uit en beheer alles op één plek."
            : "BoekBrug is ingericht en klaar voor gebruik."}
        </p>
      </div>
      <div style={{ background: "#f2f2f7", borderRadius: "16px", padding: "16px 20px", fontSize: "14px", color: "#6b6b6e", textAlign: "left", width: "100%" }}>
        💡 Tip: gebruik de zoekbalk om elke factuur in seconden terug te vinden
      </div>
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