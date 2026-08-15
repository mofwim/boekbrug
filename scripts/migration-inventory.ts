// scripts/migration-inventory.ts
// [MIGRATIE-JOURNAAL] Genereert de inventarisquery uit supabase/migrations/ zelf.
//
// Run: npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql
//
// ── WAAROM DIT BESTAAT ──
//
// docs/WELKE_MIGRATIES_STAAN_ER.sql beantwoordde de goede vraag ("wat staat er ÉCHT in de
// database?") met een lijst die iemand met de hand bijhield. De kop van dat bestand zegt zelf wat
// daar mis mee is, en het zegt het twee keer, want het is twee keer gebeurd:
//
//     "Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de hand in. Een migratie
//      die er niet in staat, kan dit bestand ook niet 'OPEN' noemen."
//
// De ene keer gaf de lijst een schoon "alles toegepast" terug terwijl hij over 17 van de 71
// migraties op schijf ging — en de vier waar de hele betaalkant op leunt stonden er niet in.
// Vandaag dekte hij er 28 van de 104.
//
// Een handmatige lijst OVER een handmatige lijst schiet niet op. Dus wordt de vraag hier
// AFGELEID uit de migratiebestanden, en kan hij per definitie niet achterlopen op de map.
//
// ── WAT EEN "VINGERAFDRUK" IS ──
//
// Per migratie wordt gezocht naar objecten die zij AANMAAKT: een tabel, een kolom, een functie,
// een index, een constraint, een policy. Bestaat dat object, dan is de migratie gedraaid.
//
// Dat is bewust zwakker geformuleerd dan "de migratie liep foutloos". Het CONTROLE-blok onderaan
// elk migratiebestand blijft de plek voor die vraag. Wat hier wordt beantwoord is het verschil
// tussen "ik denk het" en "ik zie het" — en dat is precies wat er ontbrak.
//
// ── DRIE DINGEN DIE DE GENERATOR NIET MAG DOEN ──
//
// 1. GOKKEN. Een migratie die alleen intrekt, hernoemt of commentaar zet (rpc_anon_revoke.sql,
//    function_search_path.sql) maakt niets aan. Die krijgt GEEN verzonnen vingerafdruk maar komt
//    apart te staan als "niet vast te stellen". Een lijst die zwijgt over wat ze niet weet, is de
//    lijst waar dit bestand tegen is geschreven.
//
// 2. LIEGEN OVER OPGERUIMDE OBJECTEN. creditnota_one_per_original.sql maakt de index
//    invoices_one_creditnota_per_original — en creditnota_partial.sql GOOIT DIE WEG. Een naïeve
//    probe noemt de eerste migratie dan 'OPEN' terwijl ze allang gedraaid heeft.
//
//    Maar "wordt ergens gedropt" is als regel te grof, en dat is gemeten: hij haalde drie
//    migraties onterecht onderuit. `DROP POLICY IF EXISTS x; CREATE POLICY x` in ÉÉN bestand is
//    namelijk de gewone idempotente vorm — die policy staat er daarna gewoon. Alleen een DROP
//    door een ANDER bestand dan het bestand dat het object aanmaakt telt als opruimen.
//
// 3. COMMENTAAR MEETELLEN. Uitgecommentarieerde DDL is geen DDL, en dit is geen theorie:
//    accountant_clients_insert_consent.sql draagt een uitgeschreven `CREATE POLICY` in zijn
//    toelichting en maakt zelf niets aan. Zonder het strippen zou die migratie een vingerafdruk
//    krijgen van een voorbeeld en voor altijd als OPEN worden gemeld.

import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";

type Soort = "table" | "column" | "function" | "index" | "constraint" | "policy";
interface Probe {
  soort: Soort;
  /** De naam waarop de catalogus wordt bevraagd. Bij een kolom: de kolomnaam. */
  object: string;
  /** Alleen bij een kolom: de tabel waar hij op zit. */
  tabel?: string;
  /**
   * Het schema. Bijna altijd 'public' — en die "bijna" was een echte fout.
   *
   * documents_shared_and_storage_policies.sql zet drie policies op `storage.objects`, want dat is
   * waar de bestanden staan. Een probe die alleen in `public` keek noemde die migratie voor
   * eeuwig GEDEELTELIJK, hoe goed ze ook gedraaid had — en dat is de duurste soort meting: een
   * alarm dat altijd afgaat, leert iedereen om het weg te klikken.
   */
  schema: string;
}

/**
 * Objecten die WEL worden aangemaakt maar NIETS bewijzen — met de reden erbij.
 *
 * Dit is de enige plek waar met de hand iets aan het oordeel wordt toegevoegd, en dat is met
 * opzet krap gehouden: elke regel hier is een meting die niet meer gedaan wordt, dus hij moet
 * verdiend zijn. De reden staat in de gegenereerde SQL, zodat wie de lijst leest ziet WAAROM er
 * niet naar gekeken wordt, in plaats van dat het object stilletjes verdwijnt.
 *
 * Wat hier NIET thuishoort: een object dat gewoon ontbreekt. Dat hoort OPEN te heten.
 */
const NIETS_BEWIJZEND: Record<string, { object: string; reden: string }[]> = {
  "documents_content_hash_unique.sql": [
    {
      object: "document_is_referenced",
      reden:
        "Steiger, geen fundament. Deze functie bestaat alleen om binnen DEZE migratie de " +
        "eenmalige dedup-DELETE te rangschikken; geen enkele regel in src/ roept haar aan. Het " +
        "blijvende resultaat is de unieke index uq_documents_user_content_hash, en die staat er. " +
        "Haar afwezigheid betekent dus dat iemand de steiger heeft opgeruimd, niet dat de " +
        "migratie niet liep.",
    },
  ],
  "documents_shared_and_storage_policies.sql": [
    {
      object: "idx_documents_user_content_hash",
      reden:
        "Achterhaald door een LATERE beslissing, en niet door een DROP — daarom ziet de " +
        "supersessie-regel hem niet. Deze niet-unieke index op (user_id, content_hash) is er " +
        "gekomen met het argument dat een UNIQUE de 'nog een keer uploaden'-functie zou breken; " +
        "documents_content_hash_unique.sql heeft die afweging later omgedraaid en zet " +
        "uq_documents_user_content_hash op dezelfde kolommen. Die dekt dezelfde lookups. Hem " +
        "alsnog aanmaken zou een tweede index op dezelfde twee kolommen zijn: schrijfkosten " +
        "zonder leeswinst.",
    },
  ],
};

/** SQL-commentaar eraf. Uitgecommentarieerde DDL is geen DDL. */
function stripSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Alles wat dit bestand AANMAAKT. */
function probesOf(sql: string): Probe[] {
  const out: Probe[] = [];
  const push = (p: Probe) => {
    if (!out.some((q) => q.soort === p.soort && q.object === p.object && q.tabel === p.tabel)) out.push(p);
  };

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?/gi)) {
    push({ soort: "table", object: m[2], schema: m[1] ?? "public" });
  }
  // Een ALTER TABLE kan meerdere ADD COLUMNs dragen; de tabelnaam geldt tot de volgende ALTER.
  for (const blok of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?([\s\S]*?)(?=alter\s+table|create\s+|do\s+\$\$|$)/gi)) {
    const schema = blok[1] ?? "public";
    const tabel = blok[2];
    for (const kol of blok[3].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)) {
      push({ soort: "column", object: kol[1], tabel, schema });
    }
    for (const con of blok[3].matchAll(/add\s+constraint\s+"?([a-z0-9_]+)"?/gi)) {
      push({ soort: "constraint", object: con[1], schema });
    }
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
    push({ soort: "function", object: m[2], schema: m[1] ?? "public" });
  }
  // `... ON [schema.]tabel` bepaalt het schema van een index, niet de indexnaam zelf.
  for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:([a-z0-9_]+)\.)?"?[a-z0-9_]+"?/gi)) {
    push({ soort: "index", object: m[1], schema: m[2] ?? "public" });
  }
  // Idem voor een policy — en juist hier zat de fout: drie policies staan op storage.objects.
  for (const m of sql.matchAll(/create\s+policy\s+"?([a-z0-9_ ]+?)"?\s+on\s+(?:([a-z0-9_]+)\.)?"?([a-z0-9_]+)"?/gi)) {
    push({ soort: "policy", object: m[1].trim(), tabel: m[3], schema: m[2] ?? "public" });
  }
  return out;
}

/**
 * Objecten die door een ANDER bestand worden weggegooid dan het bestand dat ze aanmaakt.
 *
 * Het onderscheid is de hele kunst hier. `DROP POLICY IF EXISTS x; CREATE POLICY x` in ÉÉN bestand
 * is de gewone idempotente vorm — die policy bestaat daarna gewoon, en meetellen als "opgeruimd"
 * zou drie migraties ten onrechte onvindbaar maken (dat gebeurde bij de eerste versie hiervan).
 *
 * Echt opgeruimd is alleen wat een ander bestand weggooit: creditnota_partial.sql laat de index
 * invoices_one_creditnota_per_original vallen die creditnota_one_per_original.sql aanmaakte. Die
 * index is er niet meer, en dat zegt niets over of die migratie ooit gedraaid heeft.
 */
function supersededNames(alle: { bestand: string; sql: string }[]): Set<string> {
  const gemaaktDoor = new Map<string, Set<string>>();
  const gedroptDoor = new Map<string, Set<string>>();
  const noteer = (kaart: Map<string, Set<string>>, naam: string, bestand: string) => {
    const k = naam.toLowerCase();
    if (!kaart.has(k)) kaart.set(k, new Set());
    kaart.get(k)!.add(bestand);
  };

  for (const { bestand, sql } of alle) {
    for (const p of probesOf(sql)) noteer(gemaaktDoor, p.object, bestand);
    for (const m of sql.matchAll(/drop\s+(?:table|index|function|policy)\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      noteer(gedroptDoor, m[1], bestand);
    }
    // DROP POLICY "naam" ON tabel — een policynaam mag spaties bevatten.
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"/gi)) {
      noteer(gedroptDoor, m[1], bestand);
    }
  }

  const weg = new Set<string>();
  for (const [naam, droppers] of gedroptDoor) {
    const makers = gemaaktDoor.get(naam) ?? new Set<string>();
    // Eén dropper die het object zelf niet aanmaakt, is genoeg.
    if ([...droppers].some((f) => !makers.has(f))) weg.add(naam);
  }
  return weg;
}

const bestanden = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const gelezen = bestanden.map((f) => ({ bestand: f, sql: stripSql(readFileSync(`${DIR}/${f}`, "utf8")) }));
const weggegooid = supersededNames(gelezen);

const rijen: string[] = [];
const zonderVingerafdruk: string[] = [];
const opgeruimd: string[] = [];

const nietsBewijzend: string[] = [];

for (const { bestand, sql } of gelezen) {
  const probes = probesOf(sql);
  const genegeerd = new Map((NIETS_BEWIJZEND[bestand] ?? []).map((o) => [o.object.toLowerCase(), o.reden]));
  const bruikbaar = probes.filter(
    (p) => !weggegooid.has(p.object.toLowerCase()) && !genegeerd.has(p.object.toLowerCase()),
  );
  const verloren = probes.filter((p) => weggegooid.has(p.object.toLowerCase()));
  for (const p of verloren) opgeruimd.push(`${bestand} → ${p.soort} ${p.object}`);
  for (const [obj, reden] of genegeerd) nietsBewijzend.push(`${bestand} → ${obj}\n--       ${reden}`);

  if (bruikbaar.length === 0) {
    zonderVingerafdruk.push(bestand);
    continue;
  }
  // Hooguit zes, en deterministisch gekozen, zodat de gegenereerde SQL niet wappert tussen runs.
  const gekozen = bruikbaar
    .slice()
    .sort((a, b) => (a.soort + a.object).localeCompare(b.soort + b.object))
    .slice(0, 6);
  for (const p of gekozen) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    rijen.push(
      `  (${q(bestand)}, ${q(p.soort)}, ${q(p.object)}, ${p.tabel ? q(p.tabel) : "null"}, ${q(p.schema)})`,
    );
  }
}

const lijnen: string[] = [];
const zeg = (s = "") => lijnen.push(s);

zeg("-- =====================================================================");
zeg("-- WELKE MIGRATIES STAAN ER ÉCHT? — één query, het echte antwoord.");
zeg("-- BoekBrug · automatisch gegenereerd, NIET met de hand bijwerken.");
zeg("-- =====================================================================");
zeg("--");
zeg("-- GEGENEREERD DOOR: scripts/migration-inventory.ts");
zeg("--   npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql");
zeg("--");
zeg("-- Handmatige wijzigingen gaan bij de eerstvolgende run verloren, en een poort in");
zeg("-- lifecycle-gates.test.ts faalt zodra dit bestand niet meer overeenkomt met de map.");
zeg("--");
zeg("-- ── WAAROM GEGENEREERD ──");
zeg("--");
zeg("-- De vorige versie stelde de goede vraag met een lijst die iemand met de hand bijhield, en");
zeg("-- zei daar zelf over: \"Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de");
zeg("-- hand in. Een migratie die er niet in staat, kan dit bestand ook niet 'OPEN' noemen.\" Dat is");
zeg("-- twee keer misgegaan — één keer dekte de lijst 17 van 71 migraties en gaf een schoon \"alles");
zeg("-- toegepast\" terug, met de vier waar de betaalkant op leunt er niet in.");
zeg("--");
zeg("-- Nu wordt de vraag AFGELEID uit supabase/migrations/, en kan hij niet achterlopen op de map.");
zeg("--");
zeg("-- ── WAT DE UITKOMST BETEKENT ──");
zeg("--");
zeg("--   TOEGEPAST     elk object dat deze migratie aanmaakt, bestaat.");
zeg("--   GEDEELTELIJK  sommige wel, sommige niet. Dit is het gevaarlijke geval: de migratie is");
zeg("--                 halverwege gestopt. Lees het CONTROLE-blok onderaan dát migratiebestand.");
zeg("--   OPEN          geen enkel object bestaat.");
zeg("--");
zeg("-- \"TOEGEPAST\" bewijst dat de migratie GEDRAAID heeft, niet dat ze FOUTLOOS liep. Daarvoor is");
zeg("-- het CONTROLE-blok onderaan het migratiebestand zelf.");
zeg("--");
zeg("-- Leest alleen de catalogus. Verandert niets. Draai hem als service_role in de SQL-editor.");
zeg("-- =====================================================================");
zeg();
zeg("with probe(bestand, soort, object, tabel, schema) as (values");
zeg(rijen.join(",\n"));
zeg("),");
zeg("bevonden as (");
zeg("  select p.*,");
zeg("    case p.soort");
zeg("      when 'table' then exists (select 1 from information_schema.tables");
zeg("             where table_schema = p.schema and table_name = p.object)");
zeg("      when 'column' then exists (select 1 from information_schema.columns");
zeg("             where table_schema = p.schema and table_name = p.tabel and column_name = p.object)");
zeg("      when 'function' then exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace");
zeg("             where n.nspname = p.schema and f.proname = p.object)");
zeg("      when 'index' then exists (select 1 from pg_indexes");
zeg("             where schemaname = p.schema and indexname = p.object)");
zeg("      when 'constraint' then exists (select 1 from pg_constraint where conname = p.object)");
zeg("      -- Een policy staat lang niet altijd in public: de bestandspolicies zitten op");
zeg("      -- storage.objects. Op het verkeerde schema zoeken gaf een alarm dat nooit uitging.");
zeg("      when 'policy' then exists (select 1 from pg_policies");
zeg("             where schemaname = p.schema and tablename = p.tabel and policyname = p.object)");
zeg("    end as aanwezig");
zeg("  from probe p");
zeg(")");
zeg("select");
zeg("  case when bool_and(aanwezig) then 'TOEGEPAST'");
zeg("       when bool_or(aanwezig)  then 'GEDEELTELIJK  <-- KIJK HIER'");
zeg("       else 'OPEN' end                                        as stand,");
zeg("  bestand,");
zeg("  count(*) filter (where aanwezig) || ' / ' || count(*)       as objecten_gevonden,");
zeg("  string_agg(case when not aanwezig then soort || ' ' || schema || '.' || object end, ', ') as ontbreekt");
zeg("from bevonden");
zeg("group by bestand");
zeg("-- GEDEELTELIJK eerst, dan OPEN, dan de rest: de regels waar iets aan te doen is, bovenaan.");
zeg("order by case when bool_and(aanwezig) then 3 when bool_or(aanwezig) then 1 else 2 end, bestand;");
zeg();
zeg("-- =====================================================================");
zeg(`-- NIET VAST TE STELLEN — ${zonderVingerafdruk.length} van de ${bestanden.length} migraties`);
zeg("-- =====================================================================");
zeg("--");
zeg("-- Deze maken niets aan: ze trekken rechten in, gooien iets weg, zetten commentaar of");
zeg("-- wijzigen alleen bestaande objecten. Er is dus geen object waarvan het BESTAAN iets");
zeg("-- bewijst. Ze krijgen met opzet GEEN verzonnen vingerafdruk — een lijst die zwijgt over wat");
zeg("-- ze niet weet, is precies de lijst waar dit bestand tegen is geschreven.");
zeg("--");
zeg("-- Controleer deze met het CONTROLE-blok onderaan het migratiebestand zelf.");
zeg("--");
for (const f of zonderVingerafdruk) zeg(`--   ${f}`);
zeg("--");
zeg("-- =====================================================================");
zeg("-- OBJECTEN DIE LATER ZIJN OPGERUIMD — tellen niet mee in het oordeel");
zeg("-- =====================================================================");
zeg("--");
zeg("-- Deze objecten worden door een LATERE migratie weer weggegooid. Hun afwezigheid bewijst");
zeg("-- niets over de migratie die ze aanmaakte — die kan allang gedraaid hebben. Meetellen zou");
zeg("-- een toegepaste migratie als OPEN aanmerken, en dat is de duurste soort fout die deze");
zeg("-- lijst kan maken: hem nog een keer draaien.");
zeg("--");
for (const r of opgeruimd) zeg(`--   ${r}`);
zeg("--");
zeg("-- =====================================================================");
zeg("-- WEL AANGEMAAKT, MAAR BEWIJST NIETS — met de reden erbij");
zeg("-- =====================================================================");
zeg("--");
zeg("-- Deze objecten worden door hun migratie aangemaakt, maar hun bestaan zegt niets over of");
zeg("-- die migratie gedraaid heeft. Ze staan hier MET reden in plaats van stilletjes te");
zeg("-- verdwijnen — wie de lijst leest hoort te zien waarom er niet naar gekeken wordt.");
zeg("--");
zeg("-- Ze staan in NIETS_BEWIJZEND in scripts/migration-inventory.ts. Een object dat gewoon");
zeg("-- ontbreekt hoort daar NIET in: dat hoort OPEN te heten.");
zeg("--");
for (const r of nietsBewijzend) zeg(`--   ${r}`);
zeg();

process.stdout.write(lijnen.join("\n") + "\n");
