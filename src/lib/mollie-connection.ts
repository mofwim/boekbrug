// src/lib/mollie-connection.ts
// [MOLLIE] Opslag van de koppeling — server-only — augustus 2026
//
// De Mollie API-sleutel is een langlevend geheim met GELDWAARDE: wie hem heeft kan
// betaallinks aanmaken en terugbetalingen starten op het account van de eigenaar. Hij gaat
// daarom door dezelfde deur als de SnelStart-maatwerksleutel en de e-mail OAuth-tokens:
// Supabase Vault, met alleen de secret-id in de tabel (supabase/migrations/mollie.sql).
//
// Deze helpers zijn de ENIGE plek die de sleutel leest of schrijft. Nooit rechtstreeks
// mollie_connections.api_key_secret_id ergens anders uitlezen — dan verschuift het geheim
// ongemerkt naar een route die het niet hoort te kennen.

import { createPipelineClient as createTypedPipelineClient } from "@/lib/supabase-pipeline";

// mollie_connections komt uit mollie.sql (met de hand toegepast) en staat niet in de
// gegenereerde typen — zelfde ontspannen client als intake_claims, om dezelfde reden.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createPipelineClient(): any {
  return createTypedPipelineClient();
}

export interface MollieConnectionMeta {
  id: string;
  userId: string;
  status: "active" | "error";
  connectedAt: string;
  lastError: string | null;
}

const CONNECTION_SELECT = "id, user_id, status, connected_at, last_error, api_key_secret_id" as const;

type ConnectionRow = {
  id: string;
  user_id: string;
  status: string;
  connected_at: string;
  last_error: string | null;
  api_key_secret_id: string | null;
};

function toMeta(row: ConnectionRow): MollieConnectionMeta {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status === "error" ? "error" : "active",
    connectedAt: row.connected_at,
    lastError: row.last_error,
  };
}

/** Status van de koppeling, ZONDER het geheim. Dit is wat de UI mag zien.
 *  [DEPLOY-SAFE] Een database waar mollie.sql nog open staat (42P01) antwoordt null —
 *  de functie is dan gewoon donker, nooit een kapotte instellingenpagina. */
export async function getMollieConnectionMeta(userId: string): Promise<MollieConnectionMeta | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("mollie_connections")
    .select(CONNECTION_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (!/42P01|relation .* does not exist/i.test(error.message ?? "")) {
      console.error("[MOLLIE] connectie lezen mislukt", { userId, error });
    }
    return null;
  }
  return data ? toMeta(data as ConnectionRow) : null;
}

/** Koppeling MÉT API-sleutel uit Vault. Alleen aanroepen vlak voordat er echt met
 *  Mollie gepraat wordt. */
export async function getMollieConnection(
  userId: string,
): Promise<{ meta: MollieConnectionMeta; apiKey: string } | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("mollie_connections")
    .select(CONNECTION_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    if (error && !/42P01|relation .* does not exist/i.test(error.message ?? "")) {
      console.error("[MOLLIE] connectie lezen mislukt", { userId, error });
    }
    return null;
  }
  const row = data as ConnectionRow;
  if (!row.api_key_secret_id) {
    console.error("[MOLLIE] connectie zonder Vault secret-id", { userId });
    return null;
  }
  const { data: secret, error: vaultErr } = await supabase.rpc("vault_read_secret", {
    p_secret_id: row.api_key_secret_id,
  });
  if (vaultErr || !secret) {
    console.error("[MOLLIE] Vault-lezing mislukt", { userId, vaultErr });
    return null;
  }
  return { meta: toMeta(row), apiKey: secret as string };
}

/**
 * Slaat een (nieuwe of vervangende) API-sleutel op en zet de koppeling op 'active'.
 * Bestaat er al een rij, dan wordt HETZELFDE Vault-geheim overschreven in plaats van een
 * nieuw geheim aangemaakt — anders blijft de oude sleutel eeuwig in Vault staan (het lek
 * dat de e-mailkoppeling ooit had; zie snelstart-connection.ts).
 */
export async function saveMollieConnection(params: {
  userId: string;
  apiKey: string;
}): Promise<{ success: true; meta: MollieConnectionMeta } | { success: false; error: string }> {
  const supabase = createPipelineClient();

  const { data: existing, error: readErr } = await supabase
    .from("mollie_connections")
    .select("id, api_key_secret_id")
    .eq("user_id", params.userId)
    .maybeSingle();
  if (readErr && /42P01|relation .* does not exist/i.test(readErr.message ?? "")) {
    return { success: false, error: "De Mollie-tabellen bestaan nog niet — pas supabase/migrations/mollie.sql toe." };
  }
  const existingRow = existing as { id: string; api_key_secret_id: string | null } | null;

  const { data: secretId, error: vaultErr } = await supabase.rpc("vault_update_or_create_secret", {
    p_secret_id: (existingRow?.api_key_secret_id ?? null) as unknown as string,
    p_value: params.apiKey,
    p_name: `mollie_api_key_${params.userId}`,
  });
  if (vaultErr || !secretId) {
    console.error("[MOLLIE] Vault-schrijven mislukt", { userId: params.userId, vaultErr });
    return { success: false, error: "De sleutel kon niet veilig worden opgeslagen. Probeer het zo opnieuw." };
  }

  const { data: saved, error: upsertErr } = await supabase
    .from("mollie_connections")
    .upsert(
      {
        user_id: params.userId,
        api_key_secret_id: secretId as string,
        status: "active",
        last_error: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select(CONNECTION_SELECT)
    .single();
  if (upsertErr || !saved) {
    console.error("[MOLLIE] connectie opslaan mislukt", { userId: params.userId, upsertErr });
    return { success: false, error: "De koppeling kon niet worden opgeslagen. Probeer het zo opnieuw." };
  }
  return { success: true, meta: toMeta(saved as ConnectionRow) };
}

/** Verbreekt de koppeling en wist het geheim uit Vault (niet alleen de verwijzing). */
export async function deleteMollieConnection(userId: string): Promise<boolean> {
  const supabase = createPipelineClient();
  const { data } = await supabase
    .from("mollie_connections")
    .select("id, api_key_secret_id")
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { id: string; api_key_secret_id: string | null } | null;
  if (!row) return true;
  if (row.api_key_secret_id) {
    const { error: vaultErr } = await supabase.rpc("vault_delete_secret", {
      p_secret_id: row.api_key_secret_id,
    });
    if (vaultErr) console.error("[MOLLIE] Vault-geheim wissen mislukt", { userId, vaultErr });
  }
  const { error } = await supabase.from("mollie_connections").delete().eq("id", row.id);
  if (error) {
    console.error("[MOLLIE] koppeling verwijderen mislukt", { userId, error });
    return false;
  }
  return true;
}
