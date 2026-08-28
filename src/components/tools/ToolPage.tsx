// src/components/tools/ToolPage.tsx
// [PDF-TOOLS] The shell every file tool sits in.
//
// Same furniture as the calculators — public header, cross-links to the other
// tools, the kennisbank articles, the footer, and the "maak een gratis account"
// close. What differs is the middle: a calculator is a form, and these move a
// file about, so the working area is wrapped in .tp where tools.css lives.
//
// It is a SERVER component on purpose. The words around the tool are what a
// crawler reads and what somebody sees before the interactive part has loaded;
// only the tool itself is a client component, and it is passed in as children.

import Link from "next/link";
import type { ReactNode } from "react";
import ToolsCrossLinks from "@/app/tools/ToolsCrossLinks";
import KennisbankLinks from "@/components/KennisbankLinks";
import PublicFooter from "@/components/public-footer";
import PublicHeader from "@/components/public-header";
import "./tools.css";

export default function ToolPage({
  slug,
  title,
  intro,
  children,
  faq,
  // [WAT-HET-DOET] Deze ene zin staat onderaan ALLE 27 gratis tools, en dat maakt hem de
  // meestgelezen productbeschrijving die dit bedrijf heeft — meer gelezen dan de homepage.
  //
  // Hij begon met "Deze tool werkt zonder account" en zei daarna dat facturen, bonnetjes en BTW
  // in BoekBrug "bij elkaar staan". Allebei waar, en samen precies verkeerd: het eerste is het
  // sterkste signaal op de pagina en het tweede beschrijft een ordner. Wie de site zo leest —
  // een bezoeker, een zoekmachine, een AI die om een samenvatting wordt gevraagd — concludeert
  // dat dit een gratis factuurgenerator is zonder opslag, zonder automatisering en zonder bank.
  // Dat is ook precies wat er terugkwam toen iemand het navroeg.
  //
  // Wat er nu staat is niet meer maar wél waar: het uitlezen (ai.ts), het herinneren
  // (/api/cron/reminders) en de boekhouder bestaan alledrie en draaien. De bank staat er met
  // opzet NIET bij, want die koppeling wacht nog op haar sleutels — een belofte die vandaag niet
  // waargemaakt kan worden hoort niet op de meestgelezen zin van de site.
  close = "Deze tool werkt zonder account. BoekBrug zelf doet meer: het leest je bonnetjes en inkoopfacturen vanzelf uit, herinnert je klanten aan wat ze nog moeten betalen, en telt je BTW per kwartaal op — klaar voor je aangifte en je boekhouder.",
}: {
  /** The route this page lives at, e.g. "/pdf-verkleinen". */
  slug: string;
  title: string;
  intro: string;
  children: ReactNode;
  faq?: { q: string; a: string }[];
  close?: string;
}) {
  return (
    <div className="tp-page">
      <PublicHeader />

      <div className="tp tp-tool">
        <header>
          <h1 className="tp-title">{title}</h1>
          <p className="tp-sub">{intro}</p>
        </header>

        {children}

        {/* The promise, stated once and in terms somebody can check in their own
            network tab rather than in terms a lawyer would prefer. */}
        <p className="tp-foot-note">
          Dit gebeurt allemaal in je browser. Je bestand wordt niet geüpload, nergens bewaard en
          door niemand gelezen — sluit je het tabblad, dan is het weg.
        </p>

        {faq && faq.length > 0 && (
          <section className="tp-faq">
            <h2>Veelgestelde vragen</h2>
            {faq.map((item) => (
              <div key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </section>
        )}

        <section className="tp-close">
          <strong>Alles op één plek met BoekBrug</strong>
          <p>{close}</p>
          <Link className="tp-close-cta" href="/register">
            Gratis account maken
          </Link>
        </section>
      </div>

      <ToolsCrossLinks currentSlug={slug} />
      <KennisbankLinks tool={slug} />
      <PublicFooter />
    </div>
  );
}
