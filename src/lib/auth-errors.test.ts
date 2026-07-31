// [AUTH-FOUT] Pure node test — run: npx tsx --test src/lib/auth-errors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callbackFoutTekst,
  herstelmailFout,
  inlogFout,
  wachtwoordOpslaanFout,
} from "./auth-errors";

test("een verkeerd wachtwoord heet een verkeerd wachtwoord", () => {
  assert.equal(inlogFout({ code: "invalid_credentials", status: 400 }).tekst, "E-mail of wachtwoord is onjuist");
  assert.equal(inlogFout({ message: "Invalid login credentials", status: 400 }).tekst, "E-mail of wachtwoord is onjuist");
});

test("een onbevestigd account krijgt de knop, niet de ontkenning", () => {
  // Dit account bestaat en het wachtwoord kán kloppen. "Onjuist" zou een bewering zijn die niet
  // waar is, en de gebruiker zoekt dan naar een fout die er niet is.
  const f = inlogFout({ code: "email_not_confirmed", status: 400 });
  assert.equal(f.bevestigNodig, true);
  assert.match(f.tekst, /bevestigen/);
  assert.equal(inlogFout({ message: "Email not confirmed" }).bevestigNodig, true);
});

test("te veel pogingen is GEEN verkeerd wachtwoord", () => {
  // Dit is de reden dat dit bestand bestaat: de oude `else` zei "onjuist" bij een 429, dus tikte
  // de gebruiker zijn wachtwoord opnieuw — nog een poging, nog een langere blokkade. De melding
  // maakte het probleem groter dat ze beschreef.
  for (const fout of [
    { status: 429 },
    { code: "over_request_rate_limit" },
    { message: "Request rate limit reached" },
    { message: "Too many requests" },
  ]) {
    const f = inlogFout(fout);
    assert.match(f.tekst, /Te veel pogingen/, JSON.stringify(fout));
    assert.ok(!/onjuist/.test(f.tekst), "mag niet over het wachtwoord gaan");
  }
});

test("een geblokkeerd account krijgt zijn eigen zin", () => {
  assert.match(inlogFout({ code: "user_banned" }).tekst, /geblokkeerd/);
});

test("een onbekende fout beweert niets over wat de gebruiker intikte", () => {
  // Een serverstoring is geen typefout. "Onjuist" zou hier een bewering zijn die we niet kunnen
  // doen, en die iemand met het juiste wachtwoord aan zichzelf laat twijfelen.
  const f = inlogFout({ status: 500, message: "internal error" });
  assert.ok(!/onjuist/.test(f.tekst), f.tekst);
  assert.equal(f.bevestigNodig, undefined);
});

test("een te zwak wachtwoord wijst naar het wachtwoordveld, niet naar een nieuwe link", () => {
  // De oude tekst was "Opslaan mislukt. Vraag een nieuwe link aan." Dan vraagt iemand een nieuwe
  // link aan, kiest hetzelfde wachtwoord, en komt precies even ver.
  for (const fout of [
    { code: "weak_password" },
    { message: "Password should be at least 8 characters" },
  ]) {
    const f = wachtwoordOpslaanFout(fout);
    assert.equal(f.veld, "password", JSON.stringify(fout));
    assert.equal(f.linkVerlopen, undefined, "dit is geen linkprobleem");
    assert.match(f.tekst, /zwak/);
  }
});

test("hetzelfde wachtwoord opnieuw kiezen zegt dát, en niets anders", () => {
  const f = wachtwoordOpslaanFout({ code: "same_password" });
  assert.equal(f.veld, "password");
  assert.match(f.tekst, /huidige/);
});

test("een verlopen herstellink is het enige geval dat naar een nieuwe link stuurt", () => {
  for (const fout of [
    { status: 401 },
    { code: "session_not_found" },
    { message: "JWT expired" },
    { message: "Auth session missing!" },
  ]) {
    const f = wachtwoordOpslaanFout(fout);
    assert.equal(f.linkVerlopen, true, JSON.stringify(fout));
    assert.match(f.tekst, /verlopen|gebruikt/);
  }
  // En andersom: alles wat op dit scherm wél opnieuw te proberen is, mag er niet naar verwijzen.
  assert.equal(wachtwoordOpslaanFout({ code: "weak_password" }).linkVerlopen, undefined);
  assert.equal(wachtwoordOpslaanFout({ status: 429 }).linkVerlopen, undefined);
  assert.equal(wachtwoordOpslaanFout({ status: 500 }).linkVerlopen, undefined);
});

test("de herstelmail meldt een ratelimiet als ratelimiet", () => {
  assert.match(herstelmailFout({ status: 429 }).tekst, /Te veel aanvragen/);
  assert.match(herstelmailFout({ status: 500 }).tekst, /Versturen/);
});

test("de callback-reden wordt vertaald, niet doorgegeven", () => {
  assert.match(callbackFoutTekst("no_code"), /afgebroken/);
  assert.match(callbackFoutTekst("auth_failed"), /Google/);
  assert.equal(callbackFoutTekst(null), "");
  assert.equal(callbackFoutTekst(undefined), "");
  assert.equal(callbackFoutTekst(""), "");
});

test("wat er verder in die parameter staat, komt niet op het scherm", () => {
  // Een querystring is invoer van buiten. Terugtonen wat er in staat maakt van het inlogscherm
  // een plek waar een vreemde tekst kan laten verschijnen — met onze eigen naam eromheen.
  for (const rommel of [
    "<img src=x onerror=alert(1)>",
    "Je account is geblokkeerd, bel 0900-1234",
    "../../etc/passwd",
    "onzin",
  ]) {
    const t = callbackFoutTekst(rommel);
    assert.ok(!t.includes(rommel), `"${rommel}" mag niet worden teruggetoond`);
    assert.equal(t, "Inloggen lukte niet. Probeer het opnieuw of gebruik je e-mailadres.");
  }
});
