// components/onboarding/OnboardingWizard.tsx
// [BOEK-015] Onboarding Wizard — iOS mobile-first redesign
// Changes v4:
//   - Language selection in Step 1 (nl/en/ar/tr) saved to profiles.preferred_language
//   - Email connection (Gmail/Outlook) in Step 4
//   - iOS-style responsive design (safe areas, native feel)
//   - Accountant Step 4 → "Nodig klant uit" + email invite option
//   - All previous: KVK/BTW validation, skip, resume, company save ✅

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ── Types ────────────────────────────────────────────────

interface OnboardingWizardProps {
  userName: string;
  /** Resume from saved step (onboarding_step from profiles) */
  initialStep?: number;
  /** Pre-saved role if user already passed Step 2 */
  initialRole?: Role;
  /** Pre-saved language if user already passed Step 1 */
  initialLanguage?: Language;
}

type Role = "zzp" | "accountant";
type Language = "nl" | "en" | "ar" | "tr";

interface CompanyData {
  company_name: string;
  kvk_number: string;
  btw_number: string;
}

interface CompanyErrors {
  kvk_number?: string;
  btw_number?: string;
}

// ── i18n labels (minimal, for onboarding only) ──────────
const LANG_LABELS: Record<Language, { label: string; flag: string; dir: "ltr" | "rtl" }> = {
  nl: { label: "Nederlands", flag: "🇳🇱", dir: "ltr" },
  en: { label: "English", flag: "🇬🇧", dir: "ltr" },
  ar: { label: "العربية", flag: "🇸🇦", dir: "rtl" },
  tr: { label: "Türkçe", flag: "🇹🇷", dir: "ltr" },
};

// ── Validation ──────────────────────────────────────────
const KVK_REGEX = /^\d{8}$/;
const BTW_REGEX = /^NL\d{9}B\d{2}$/i;

function validateCompany(data: CompanyData): CompanyErrors {
  const errors: CompanyErrors = {};
  const kvk = data.kvk_number.trim();
  const btw = data.btw_number.trim();
  if (kvk && !KVK_REGEX.test(kvk)) {
    errors.kvk_number = "KVK-nummer moet uit 8 cijfers bestaan";
  }
  if (btw && !BTW_REGEX.test(btw)) {
    errors.btw_number = "Formaat: NL123456789B01";
  }
  return errors;
}

// ── Step definitions ────────────────────────────────────
const STEPS = [
  { id: 1, title: "Welkom" },
  { id: 2, title: "Wie ben jij?" },
  { id: 3, title: "Bedrijf" },
  { id: 4, title: "E-mail" },
  { id: 5, title: "Klaar!" },
] as const;

// ── Main component ──────────────────────────────────────

export function OnboardingWizard({
  userName,
  initialStep = 1,
  initialRole = "zzp",
  initialLanguage = "nl",
}: OnboardingWizardProps) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), STEPS.length));
  const [role, setRole] = useState<Role>(initialRole);
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [emailConnected, setEmailConnected] = useState<"gmail" | "outlook" | null>(null);
  const [company, setCompany] = useState<CompanyData>({
    company_name: "",
    kvk_number: "",
    btw_number: "",
  });
  const [companyErrors, setCompanyErrors] = useState<CompanyErrors>({});
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const dir = LANG_LABELS[language].dir;

  /** Save current step + optional extra fields */
  async function persistStep(nextStep: number, extraData?: Record<string, unknown>) {
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep, role, ...extraData }),
    });
  }

  async function handleNext() {
    if (step === STEPS.length) {
      setSaving(true);
      await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: true, role }),
      });
      router.push("/dashboard");
      return;
    }

    // Step 1 — save language choice
    if (step === 1) {
      await persistStep(2, { preferred_language: language });
      setStep(2);
      return;
    }

    // Step 3 — validate + save company data
    if (step === 3) {
      const errors = validateCompany(company);
      if (Object.keys(errors).length > 0) {
        setCompanyErrors(errors);
        return;
      }
      setCompanyErrors({});
      const companyPayload = {
        company_name: company.company_name.trim() || null,
        kvk_number: company.kvk_number.trim() || null,
        btw_number: company.btw_number.trim() || null,
      };
      await persistStep(4, companyPayload);
      setStep(4);
      return;
    }

    await persistStep(step + 1);
    setStep((s) => s + 1);
  }

  async function handleSkip() {
    await persistStep(step + 1);
    setStep((s) => s + 1);
  }

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  const isLastStep = step === STEPS.length;
  const showSkip = step === 3 || step === 4;

  return (
    // [BOEK-015] iOS mobile-first layout — safe area + full height
    <div
      className="min-h-screen flex flex-col bg-background"
      dir={dir}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* ── Top progress strip ── */}
      <div className="flex gap-1 px-5 pt-5 pb-2">
        {STEPS.map((s) => (
          <div
            key={s.id}
            className="flex-1 h-[3px] rounded-full transition-all duration-500"
            style={{
              background: s.id <= step ? "var(--color-text-primary)" : "var(--color-border-tertiary)",
            }}
          />
        ))}
      </div>

      {/* ── Step label ── */}
      <div className="px-6 pt-3 pb-1">
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          Stap {step} van {STEPS.length}
        </p>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 flex flex-col px-6 pt-4 pb-6 overflow-y-auto">
        <div className="flex-1">
          {step === 1 && (
            <StepWelcome
              userName={userName}
              language={language}
              setLanguage={setLanguage}
            />
          )}
          {step === 2 && <StepRole role={role} setRole={setRole} />}
          {step === 3 && (
            <StepCompany
              company={company}
              setCompany={setCompany}
              errors={companyErrors}
            />
          )}
          {step === 4 && (
            <StepEmailConnect
              role={role}
              connected={emailConnected}
              setConnected={setEmailConnected}
            />
          )}
          {step === 5 && <StepDone role={role} />}
        </div>

        {/* ── Navigation ── */}
        <div className="mt-8 space-y-3">
          {/* Primary button */}
          <button
            onClick={handleNext}
            disabled={saving}
            className="w-full py-4 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-50"
            style={{
              background: "var(--color-text-primary)",
              color: "var(--color-background-primary)",
            }}
          >
            {isLastStep
              ? saving
                ? "Bezig…"
                : "Naar dashboard"
              : "Volgende"}
          </button>

          {/* Secondary row: Back + Skip */}
          <div className="flex items-center justify-between">
            {step > 1 ? (
              <button
                onClick={handleBack}
                disabled={saving}
                className="py-2 px-1 text-sm transition-colors disabled:opacity-40"
                style={{ color: "var(--color-text-secondary)" }}
              >
                ← Terug
              </button>
            ) : (
              <div />
            )}

            {showSkip && (
              <button
                onClick={handleSkip}
                disabled={saving}
                className="py-2 px-1 text-sm transition-colors disabled:opacity-40"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Overslaan →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1 — Welcome + Language selection ────────────────

function StepWelcome({
  userName,
  language,
  setLanguage,
}: {
  userName: string;
  language: Language;
  setLanguage: (l: Language) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-4xl mb-4">👋</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welkom, {userName.split(" ")[0]}
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          BoekBrug is jouw financiële ruggengraat. Klaar in 5 minuten.
        </p>
      </div>

      {/* Language selector */}
      <div>
        <p className="text-sm font-medium mb-3">Kies je taal</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(LANG_LABELS) as [Language, typeof LANG_LABELS[Language]][]).map(
            ([code, meta]) => (
              <button
                key={code}
                onClick={() => setLanguage(code)}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-left transition-all active:scale-[0.97]"
                style={{
                  background:
                    language === code
                      ? "var(--color-text-primary)"
                      : "var(--color-background-secondary)",
                  color:
                    language === code
                      ? "var(--color-background-primary)"
                      : "var(--color-text-primary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                }}
              >
                <span className="text-lg">{meta.flag}</span>
                <span className="font-medium">{meta.label}</span>
              </button>
            )
          )}
        </div>
      </div>

      <div className="space-y-2 pt-2">
        {[
          "Alle facturen op één plek",
          "AI leest en ordent je documenten",
          "Nooit meer een factuur kwijt",
        ].map((item) => (
          <div key={item} className="flex items-center gap-3 text-sm">
            <span style={{ color: "var(--color-text-success)" }}>✓</span>
            <span style={{ color: "var(--color-text-secondary)" }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 2 — Role selection ──────────────────────────────

function StepRole({
  role,
  setRole,
}: {
  role: Role;
  setRole: (r: Role) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Wie ben jij?</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          We passen BoekBrug aan op jouw situatie.
        </p>
      </div>

      <div className="space-y-3 pt-2">
        <RoleCard
          active={role === "zzp"}
          onClick={() => setRole("zzp")}
          icon="🧑‍💼"
          title="ZZP'er / ondernemer"
          desc="Ik stuur en ontvang facturen zelf"
        />
        <RoleCard
          active={role === "accountant"}
          onClick={() => setRole("accountant")}
          icon="📊"
          title="Boekhouder"
          desc="Ik beheer meerdere klanten"
        />
      </div>
    </div>
  );
}

function RoleCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
      style={{
        background: active
          ? "var(--color-text-primary)"
          : "var(--color-background-secondary)",
        border: active
          ? "none"
          : "0.5px solid var(--color-border-tertiary)",
        color: active
          ? "var(--color-background-primary)"
          : "var(--color-text-primary)",
      }}
    >
      <div className="flex items-center gap-4">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p
            className="text-xs mt-0.5"
            style={{
              color: active
                ? "rgba(255,255,255,0.7)"
                : "var(--color-text-secondary)",
            }}
          >
            {desc}
          </p>
        </div>
        {active && (
          <span className="ml-auto text-xs opacity-70">✓</span>
        )}
      </div>
    </button>
  );
}

// ── Step 3 — Company data ────────────────────────────────

function StepCompany({
  company,
  setCompany,
  errors,
}: {
  company: CompanyData;
  setCompany: React.Dispatch<React.SetStateAction<CompanyData>>;
  errors: CompanyErrors;
}) {
  function handleChange(field: keyof CompanyData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setCompany((prev) => ({ ...prev, [field]: e.target.value }));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Bedrijfsgegevens</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Optioneel — je kunt dit later aanpassen via Instellingen.
        </p>
      </div>

      <div className="space-y-4 pt-1">
        <Field label="Bedrijfsnaam">
          <input
            type="text"
            value={company.company_name}
            onChange={handleChange("company_name")}
            placeholder="Mijn Bedrijf BV"
            className="ios-input"
          />
        </Field>

        <Field label="KVK-nummer" error={errors.kvk_number}>
          <input
            type="text"
            value={company.kvk_number}
            onChange={handleChange("kvk_number")}
            placeholder="12345678"
            maxLength={8}
            inputMode="numeric"
            className="ios-input"
            style={
              errors.kvk_number
                ? { borderColor: "var(--color-border-danger)" }
                : undefined
            }
          />
        </Field>

        <Field label="BTW-nummer" error={errors.btw_number}>
          <input
            type="text"
            value={company.btw_number}
            onChange={handleChange("btw_number")}
            placeholder="NL123456789B01"
            autoCapitalize="characters"
            className="ios-input"
            style={
              errors.btw_number
                ? { borderColor: "var(--color-border-danger)" }
                : undefined
            }
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-sm font-medium mb-1.5"
        style={{ color: "var(--color-text-primary)" }}
      >
        {label}
      </label>
      {children}
      {error && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Step 4 — Email connection ────────────────────────────
// [BOEK-015] OAuth flow — redirect to /api/email/connect?provider=gmail|outlook
// On return, the callback sets email_connections row and redirects back to /onboarding

function StepEmailConnect({
  role,
  connected,
  setConnected,
}: {
  role: Role;
  connected: "gmail" | "outlook" | null;
  setConnected: (p: "gmail" | "outlook" | null) => void;
}) {
  function handleConnect(provider: "gmail" | "outlook") {
    // [BOEK-015] Redirect to OAuth initiation endpoint
    // After OAuth completes, provider redirects back to /onboarding?step=4&connected=gmail
    window.location.href = `/api/email/connect?provider=${provider}&redirect=/onboarding`;
  }

  // Accountant sees a different Step 4: invite first client
  if (role === "accountant") {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Nodig klant uit</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Stuur je eerste klant een uitnodiging om BoekBrug te gebruiken.
          </p>
        </div>

        <a
          href="/dashboard/clients/invite"
          className="flex items-center justify-between w-full px-5 py-4 rounded-2xl text-sm font-medium transition-all active:scale-[0.98]"
          style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            color: "var(--color-text-primary)",
            textDecoration: "none",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">📧</span>
            <div>
              <p className="font-medium">Klant uitnodigen</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                Via e-mail uitnodiging
              </p>
            </div>
          </div>
          <span style={{ color: "var(--color-text-tertiary)" }}>→</span>
        </a>

        <p className="text-xs text-center" style={{ color: "var(--color-text-tertiary)" }}>
          Of klik op &ldquo;Overslaan&rdquo; en doe dit later vanuit het dashboard
        </p>
      </div>
    );
  }

  // ZZP'er — connect Gmail or Outlook
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Koppel je e-mail</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Facturen komen automatisch binnen — je hoeft ze nooit meer zelf te uploaden.
        </p>
      </div>

      {connected ? (
        // ── Connected state ──
        <div
          className="flex items-center gap-3 px-5 py-4 rounded-2xl"
          style={{
            background: "var(--color-background-success)",
            border: "0.5px solid var(--color-border-success)",
          }}
        >
          <span className="text-xl">✅</span>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-text-success)" }}>
              {connected === "gmail" ? "Gmail" : "Outlook"} gekoppeld
            </p>
            <button
              onClick={() => setConnected(null)}
              className="text-xs mt-0.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Verwijderen
            </button>
          </div>
        </div>
      ) : (
        // ── Connect buttons ──
        <div className="space-y-3 pt-1">
          <EmailProviderButton
            provider="gmail"
            label="Gmail koppelen"
            icon="G"
            iconColor="#EA4335"
            onClick={() => handleConnect("gmail")}
          />
          <EmailProviderButton
            provider="outlook"
            label="Outlook koppelen"
            icon="O"
            iconColor="#0078D4"
            onClick={() => handleConnect("outlook")}
          />
        </div>
      )}

      <div
        className="flex items-start gap-3 px-4 py-3 rounded-xl"
        style={{ background: "var(--color-background-secondary)" }}
      >
        <span className="text-base mt-0.5">🔒</span>
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          BoekBrug leest alleen factuur-bijlagen. Persoonlijke e-mails worden nooit opgeslagen.
        </p>
      </div>
    </div>
  );
}

function EmailProviderButton({
  label,
  icon,
  iconColor,
  onClick,
}: {
  provider: "gmail" | "outlook";
  label: string;
  icon: string;
  iconColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-sm font-medium text-left transition-all active:scale-[0.98]"
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        color: "var(--color-text-primary)",
      }}
    >
      {/* Provider icon circle */}
      <span
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
        style={{ background: iconColor }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span>{label}</span>
      <span className="ml-auto" style={{ color: "var(--color-text-tertiary)" }}>→</span>
    </button>
  );
}

// ── Step 5 — Done ────────────────────────────────────────

function StepDone({ role }: { role: Role }) {
  return (
    <div className="flex flex-col items-center text-center space-y-4 pt-8">
      <span className="text-6xl">🎉</span>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Klaar om te starten!</h2>
        <p className="mt-3 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {role === "accountant"
            ? "Jouw dashboard is klaar. Nodig klanten uit en beheer alles op één plek."
            : "Jouw BoekBrug is klaar. Laat geen factuur meer verloren gaan."}
        </p>
      </div>
      <div
        className="w-full px-5 py-4 rounded-2xl text-sm mt-4"
        style={{
          background: "var(--color-background-secondary)",
          color: "var(--color-text-secondary)",
        }}
      >
        💡 Tip: gebruik de zoekbalk om elke factuur in seconden terug te vinden
      </div>
    </div>
  );
}