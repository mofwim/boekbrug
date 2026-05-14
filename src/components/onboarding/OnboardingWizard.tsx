// components/onboarding/OnboardingWizard.tsx
// 5-step onboarding wizard (BOEK-015)
// Shown once — on first login when onboarding_done = false

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OnboardingWizardProps {
  userName: string;
}

type Role = "zzp" | "accountant";

const STEPS = [
  { id: 1, title: "Welkom bij BoekBrug" },
  { id: 2, title: "Wie ben jij?" },
  { id: 3, title: "Bedrijfsgegevens" },
  { id: 4, title: "Je eerste factuur" },
  { id: 5, title: "Alles klaar!" },
] as const;

export function OnboardingWizard({ userName }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role>("zzp");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function saveStep(nextStep: number) {
    await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep, role }),
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
    await saveStep(step + 1);
    setStep((s) => s + 1);
  }

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-lg bg-background border rounded-2xl shadow-sm overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-1 bg-foreground transition-all duration-500"
            style={{ width: `${(step / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="px-8 py-8">
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.map((s) => (
              <div
                key={s.id}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s.id <= step ? "bg-foreground" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Content */}
          <div className="min-h-[280px]">
            {step === 1 && <StepWelcome userName={userName} />}
            {step === 2 && <StepRole role={role} setRole={setRole} />}
            {step === 3 && <StepCompany />}
            {step === 4 && <StepFirstInvoice role={role} />}
            {step === 5 && <StepDone role={role} />}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            {step > 1 ? (
              <button
                onClick={handleBack}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Terug
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={handleNext}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium bg-foreground text-background rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {step === STEPS.length
                ? saving
                  ? "Bezig…"
                  : "Naar dashboard →"
                : "Volgende →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Steps ───────────────────────────────────────────────

function StepWelcome({ userName }: { userName: string }) {
  return (
    <div className="space-y-4">
      <div className="text-4xl">👋</div>
      <h1 className="text-2xl font-semibold">
        Welkom, {userName.split(" ")[0]}!
      </h1>
      <p className="text-muted-foreground">
        BoekBrug is jouw financiële ruggengraat. We helpen je in 5 minuten op weg.
      </p>
      <div className="pt-4 space-y-3">
        {[
          "Alle facturen op één plek",
          "AI die jouw documenten leest en ordent",
          "Nooit meer een factuur kwijt",
        ].map((item) => (
          <div key={item} className="flex items-center gap-3 text-sm">
            <span className="text-green-600">✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRole({
  role,
  setRole,
}: {
  role: Role;
  setRole: (r: Role) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Wie ben jij?</h2>
      <p className="text-muted-foreground text-sm">
        We passen BoekBrug aan op jouw situatie.
      </p>
      <div className="grid grid-cols-2 gap-3 pt-2">
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
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        active
          ? "border-foreground bg-foreground/5"
          : "border-muted hover:border-foreground/30"
      }`}
    >
      <div className="text-2xl mb-2">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </button>
  );
}

function StepCompany() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Bedrijfsgegevens</h2>
      <p className="text-sm text-muted-foreground">
        Je kunt dit nu invullen of later via Instellingen aanpassen.
      </p>
      <div className="space-y-3 pt-2">
        <div>
          <label className="text-sm font-medium block mb-1">Bedrijfsnaam</label>
          <input
            type="text"
            placeholder="Mijn Bedrijf BV"
            className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">KVK-nummer</label>
          <input
            type="text"
            placeholder="12345678"
            maxLength={8}
            className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">BTW-nummer</label>
          <input
            type="text"
            placeholder="NL123456789B01"
            className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}

function StepFirstInvoice({ role }: { role: Role }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Je eerste factuur</h2>
      <p className="text-sm text-muted-foreground">
        {role === "accountant"
          ? "Nodig je eerste klant uit of bekijk het dashboard."
          : "Maak meteen je eerste factuur aan, of verken eerst het dashboard."}
      </p>
      <div className="pt-4 space-y-3">
        {role === "zzp" ? (
          <a
            href="/dashboard/invoice/new"
            className="flex items-center justify-between w-full px-4 py-3 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            <span>Maak eerste factuur</span>
            <span>→</span>
          </a>
        ) : (
          <a
            href="/dashboard/clients/invite"
            className="flex items-center justify-between w-full px-4 py-3 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            <span>Nodig klant uit</span>
            <span>→</span>
          </a>
        )}
        <p className="text-xs text-center text-muted-foreground">
          Of klik op &ldquo;Volgende&rdquo; om door te gaan
        </p>
      </div>
    </div>
  );
}

function StepDone({ role }: { role: Role }) {
  return (
    <div className="space-y-4 text-center">
      <div className="text-5xl">🎉</div>
      <h2 className="text-xl font-semibold">Klaar om te starten!</h2>
      <p className="text-sm text-muted-foreground">
        {role === "accountant"
          ? "Jouw dashboard is klaar. Nodig klanten uit en beheer alles op één plek."
          : "Jouw BoekBrug is klaar. Laat geen factuur meer verloren gaan."}
      </p>
      <div className="pt-4 text-sm text-muted-foreground">
        💡 Tip: gebruik de zoekbalk om elke factuur in seconden terug te vinden
      </div>
    </div>
  );
}
