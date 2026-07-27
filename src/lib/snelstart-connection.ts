// src/lib/snelstart-connection.ts
// [SNELSTART] Opslag van de koppeling — server-only — juli 2026
//
// De maatwerksleutel is een langlevend geheim met volledige toegang tot de administratie
// van de gebruiker. Hij gaat daarom door dezelfde deur als de e-mail OAuth-tokens:
// Supabase Vault, met alleen de secret-id in de tabel (zie email-integration.ts en
// supabase/migrations/snelstart_connection.sql).
//
// Deze helpers zijn de ENIGE plek die de sleutel leest of schrijft. Nooit rechtstreeks
// snelstart_connections.client_key_secret_id ergens anders uitlezen — dan verschuift het
// geheim ongemerkt naar een route die het niet hoort te kennen.

import { createPipelineClient } from "@/lib/supabase-pipeline";
import { clearSnelStartTokenCache } from "@/lib/snelstart-client";
import type { Database } from "@/types/database.types";

type ConnectionUpdate = Database["public"]["Tables"]["snelstart_connections"]["Update"];

export interface SnelStartConnectionMeta {
  id: string;
  userId: string;
  administrationLabel: string | null;
  inkoopGrootboekId: string | null;
  verkoopGrootboekId: string | null;
  status: "active" | "needs_reauth";
  connectedAt: string;
  lastPushAt: string | null;
  lastError: string | null;
}

const CONNECTION_SELECT =
  "id, user_id, administration_label, inkoop_grootboek_id, verkoop_grootboek_id, status, connected_at, last_push_at, last_error, client_key_secret_id" as const;

type ConnectionRow = {
  id: string;
  user_id: string;
  administration_label: string | null;
  inkoop_grootboek_id: string | null;
  verkoop_grootboek_id: string | null;
  status: string;
  connected_at: string;
  last_push_at: string | null;
  last_error: string | null;
  client_key_secret_id: string | null;
};

function toMeta(row: ConnectionRow): SnelStartConnectionMeta {
  return {
    id: row.id,
    userId: row.user_id,
    administrationLabel: row.administration_label,
    inkoopGrootboekId: row.inkoop_grootboek_id,
    verkoopGrootboekId: row.verkoop_grootboek_id,
    status: row.status === "needs_reauth" ? "needs_reauth" : "active",
    connectedAt: row.connected_at,
    lastPushAt: row.last_push_at,
    lastError: row.last_error,
  };
}

/** Status van de koppeling, ZONDER het geheim. Dit is wat de UI mag zien. */
export async function getSnelStartConnectionMeta(
  userId: string,
): Promise<SnelStartConnectionMeta | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("snelstart_connections")
    .select(CONNECTION_SELECT)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[SNELSTART] connectie lezen mislukt", { userId, error });
    return null;
  }
  return data ? toMeta(data as ConnectionRow) : null;
}

/** Koppeling MÉT maatwerksleutel uit Vault. Alleen aanroepen vlak voordat er echt naar
 *  SnelStart gepraat wordt. */
export async function getSnelStartConnection(
  userId: string,
): Promise<{ meta: SnelStartConnectionMeta; clientKey: string } | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("snelstart_connections")
    .select(CONNECTION_SELECT)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[SNELSTART] connectie lezen mislukt", { userId, error });
    return null;
  }
  const row = data as ConnectionRow;
  if (!row.client_key_secret_id) {
    console.error("[SNELSTART] connectie zonder Vault secret-id", { userId });
    return null;
  }

  const { data: secret, error: vaultErr } = await supabase.rpc("vault_read_secret", {
    p_secret_id: row.client_key_secret_id,
  });
  if (vaultErr || !secret) {
    console.error("[SNELSTART] Vault-lezing mislukt", { userId, vaultErr });
    return null;
  }

  return { meta: toMeta(row), clientKey: secret as string };
}

/**
 * Slaat een (nieuwe of vervangende) maatwerksleutel op en zet de koppeling op 'active'.
 *
 * Bestaat er al een rij, dan wordt HETZELFDE Vault-geheim overschreven in plaats van een
 * nieuw geheim aangemaakt: anders blijft de oude sleutel eeuwig in Vault staan (dat is
 * precies het lek dat de e-mailkoppeling ooit had).
 */
export async function saveSnelStartConnection(params: {
  userId: string;
  clientKey: string;
  administrationLabel?: string | null;
  inkoopGrootboekId?: string | null;
  verkoopGrootboekId?: string | null;
}): Promise<{ success: true; meta: SnelStartConnectionMeta } | { success: false; error: string }> {
  const supabase = createPipelineClient();

  const { data: existing } = await supabase
    .from("snelstart_connections")
    .select("id, client_key_secret_id")
    .eq("user_id", params.userId)
    .maybeSingle();

  const existingRow = existing as { id: string; client_key_secret_id: string | null } | null;

  const { data: secretId, error: vaultErr } = await supabase.rpc(
    "vault_update_or_create_secret",
    {
      p_secret_id: (existingRow?.client_key_secret_id ?? null) as unknown as string,
      p_value: params.clientKey,
      p_name: `snelstart_clientkey_${existingRow?.id ?? "new"}_${Date.now()}`,
    },
  );
  if (vaultErr || !secretId) {
    console.error("[SNELSTART] Vault-schrijven mislukt", { userId: params.userId, vaultErr });
    return { success: false, error: vaultErr?.message ?? "Vault write failed" };
  }

  const now = new Date().toISOString();
  const { data: saved, error: upsertErr } = await supabase
    .from("snelstart_connections")
    .upsert(
      {
        user_id: params.userId,
        client_key_secret_id: secretId as string,
        key_stored_at: now,
        administration_label: params.administrationLabel ?? null,
        inkoop_grootboek_id: params.inkoopGrootboekId ?? null,
        verkoop_grootboek_id: params.verkoopGrootboekId ?? null,
        status: "active",
        connected_at: now,
        last_error: null,
        updated_at: now,
      },
      { onConflict: "user_id" },
    )
    .select(CONNECTION_SELECT)
    .single();

  if (upsertErr || !saved) {
    console.error("[SNELSTART] connectie opslaan mislukt", { userId: params.userId, upsertErr });
    return { success: false, error: upsertErr?.message ?? "Opslaan mislukt" };
  }

  return { success: true, meta: toMeta(saved as ConnectionRow) };
}

/** Alleen de standaard-grootboeken bijwerken (koppeling blijft staan). */
export async function updateSnelStartDefaults(params: {
  userId: string;
  administrationLabel?: string | null;
  inkoopGrootboekId?: string | null;
  verkoopGrootboekId?: string | null;
}): Promise<boolean> {
  const supabase = createPipelineClient();
  const patch: ConnectionUpdate = { updated_at: new Date().toISOString() };
  if (params.administrationLabel !== undefined)
    patch.administration_label = params.administrationLabel;
  if (params.inkoopGrootboekId !== undefined) patch.inkoop_grootboek_id = params.inkoopGrootboekId;
  if (params.verkoopGrootboekId !== undefined)
    patch.verkoop_grootboek_id = params.verkoopGrootboekId;

  const { error } = await supabase
    .from("snelstart_connections")
    .update(patch)
    .eq("user_id", params.userId);

  if (error) {
    console.error("[SNELSTART] standaardinstellingen bijwerken mislukt", {
      userId: params.userId,
      error,
    });
    return false;
  }
  return true;
}

/** SnelStart wees de sleutel af (401/403): de koppeling markeren zodat de UI om een
 *  nieuwe sleutel vraagt in plaats van elke push stil te laten falen. */
export async function markSnelStartNeedsReauth(userId: string, reason: string): Promise<void> {
  const supabase = createPipelineClient();
  const { error } = await supabase
    .from("snelstart_connections")
    .update({
      status: "needs_reauth",
      last_error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) console.error("[SNELSTART] needs_reauth zetten mislukt", { userId, error });
}

/** Laatste push-moment + eventuele fout vastleggen. */
export async function recordSnelStartPushResult(
  userId: string,
  lastError: string | null,
): Promise<void> {
  const supabase = createPipelineClient();
  await supabase
    .from("snelstart_connections")
    .update({
      last_push_at: new Date().toISOString(),
      last_error: lastError ? lastError.slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

/**
 * Ontkoppelen: Vault-geheim weg, rij weg, token uit het geheugen.
 *
 * Het duw-logboek (snelstart_exports) blijft bewust staan: dat is de administratieve
 * geschiedenis van wat er ooit naar SnelStart is gegaan. Zou je dat wissen, dan zou
 * opnieuw koppelen alles nogmaals boeken.
 */
export async function deleteSnelStartConnection(userId: string): Promise<boolean> {
  const supabase = createPipelineClient();

  const { data } = await supabase
    .from("snelstart_connections")
    .select("client_key_secret_id")
    .eq("user_id", userId)
    .maybeSingle();

  const secretId = (data as { client_key_secret_id: string | null } | null)?.client_key_secret_id;

  // Eerst het geheim: als de rij-delete straks faalt houden we een rij zonder sleutel over
  // (die de code al als "kapot" behandelt) in plaats van een sleutel zonder rij, die
  // niemand meer kan opruimen.
  if (secretId) {
    const { error } = await supabase.rpc("vault_delete_secret", { p_secret_id: secretId });
    if (error) console.warn("[SNELSTART] Vault-geheim verwijderen mislukt", { userId, error });
  }

  const { error: delErr } = await supabase
    .from("snelstart_connections")
    .delete()
    .eq("user_id", userId);

  if (delErr) {
    console.error("[SNELSTART] connectie verwijderen mislukt", { userId, delErr });
    return false;
  }

  // Een ingetrokken sleutel mag geen levend token achterlaten in deze instantie.
  clearSnelStartTokenCache();
  return true;
}
