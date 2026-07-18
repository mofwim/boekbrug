// [SUPPLIER-REGISTRY] Reconciliation test — run: npx tsx src/lib/supplier-registry.reconcile.test.ts
// Locks the IBAN↔KVK cross-key reconciliation in resolveSupplierForImport against a fake Supabase
// that enforces the SAME two partial unique indexes the real DB has:
//   suppliers_user_iban_uidx  ON (user_id, iban)       WHERE iban IS NOT NULL
//   suppliers_user_kvk_uidx   ON (user_id, kvk_number) WHERE kvk_number IS NOT NULL
// These are the exact scenarios the strong-monitoring control flagged (duplicate supplier / a
// permanent null resolution) when one company's invoices carry disjoint strong keys.
import { resolveSupplierForImport } from './supplier-registry'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

type Row = {
  id: string; user_id: string; name: string; name_key: string | null
  iban: string | null; kvk_number: string | null; btw_number: string | null
  created_at: number
}

// A tiny query builder mimicking the subset of supabase-js the resolver uses.
function makeClient(seed: Row[]) {
  const rows: Row[] = seed.map((r) => ({ ...r }))
  let seq = rows.length

  class Query {
    filters: Array<{ col: keyof Row; val: unknown; isNull?: boolean }> = []
    orderAsc = true
    mode: 'select' | 'insert' | 'update' = 'select'
    pending: Partial<Row> | null = null

    select() { return this }
    eq(col: keyof Row, val: unknown) { this.filters.push({ col, val }); return this }
    is(col: keyof Row, val: null) { void val; this.filters.push({ col, val: null, isNull: true }); return this }
    order(_col: keyof Row, opts: { ascending: boolean }) { this.orderAsc = opts.ascending; return this }
    limit() { return this }

    insert(obj: Partial<Row>) { this.mode = 'insert'; this.pending = obj; return this }
    update(obj: Partial<Row>) { this.mode = 'update'; this.pending = obj; return this }

    private match(): Row[] {
      const out = rows.filter((r) =>
        this.filters.every((f) => (f.isNull ? r[f.col] == null : r[f.col] === f.val)),
      )
      out.sort((a, b) => (this.orderAsc ? a.created_at - b.created_at : b.created_at - a.created_at))
      return out
    }

    // unique-index enforcement on insert
    private violates(obj: Partial<Row>): boolean {
      if (obj.iban != null && rows.some((r) => r.user_id === obj.user_id && r.iban === obj.iban)) return true
      if (obj.kvk_number != null && rows.some((r) => r.user_id === obj.user_id && r.kvk_number === obj.kvk_number)) return true
      return false
    }

    async maybeSingle() {
      const m = this.match()
      return { data: m[0] ?? null, error: null }
    }
    async single() {
      if (this.mode === 'insert' && this.pending) {
        if (this.violates(this.pending)) return { data: null, error: { code: '23505' } }
        const row: Row = {
          id: `id${++seq}`, user_id: '', name: '', name_key: null,
          iban: null, kvk_number: null, btw_number: null, created_at: seq,
          ...this.pending,
        }
        rows.push(row)
        return { data: row, error: null }
      }
      const m = this.match()
      return { data: m[0] ?? null, error: m[0] ? null : { code: 'PGRST116' } }
    }
    // `await supabase...update(...).eq('id', x)` — the builder itself is awaited.
    then(resolve: (v: { data: null; error: null }) => void) {
      if (this.mode === 'update' && this.pending) {
        const m = this.match()
        for (const r of m) Object.assign(r, this.pending)
      }
      resolve({ data: null, error: null })
    }
  }

  return {
    _rows: rows,
    from(table: string) { void table; return new Query() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const U = 'user-1'
function seedRow(p: Partial<Row>): Row {
  return {
    id: p.id ?? 'seed', user_id: U, name: p.name ?? 'Seed', name_key: p.name_key ?? null,
    iban: p.iban ?? null, kvk_number: p.kvk_number ?? null, btw_number: p.btw_number ?? null,
    created_at: p.created_at ?? 1,
  }
}

async function run() {
  // ── Bug 2: KVK-only row exists (iban NULL). A NEW invoice for the same company prints IBAN + the
  // same KVK but a DIFFERENT name spelling (so name_key won't match). Must resolve to the existing
  // row (not null), and attach the IBAN — not create a second supplier / return null forever. ────
  {
    const client = makeClient([
      seedRow({ id: 'kvkrow', name: 'Hocaoglu', name_key: 'hocaoglu', kvk_number: '12345678' }),
    ])
    const res = await resolveSupplierForImport(client, U, {
      name: 'Silifke Groothandel', iban: 'NL37BNGH0123456789', kvk: '12345678',
    })
    check('Bug2: IBAN+KVK invoice resolves to the existing KVK-only row', res?.id === 'kvkrow')
    check('Bug2: the IBAN got attached to that row (future IBAN-only invoices resolve here)',
      client._rows.find((r: Row) => r.id === 'kvkrow')?.iban === 'NL37BNGH0123456789')
    check('Bug2: no duplicate supplier was created', client._rows.length === 1)
  }

  // ── Bug 1: IBAN-keyed row exists with kvk NULL. A NEW KVK-only invoice (no IBAN) for the same
  // company (same name_key) must adopt that row and tag it with the KVK — not create a duplicate. ─
  {
    const client = makeClient([
      seedRow({ id: 'ibanrow', name: 'Atapack B.V.', name_key: 'atapack', iban: 'NL11RABO0111111111' }),
    ])
    const res = await resolveSupplierForImport(client, U, {
      name: 'Atapack', kvk: '87654321',
    })
    check('Bug1: KVK-only invoice adopts the existing IBAN row', res?.id === 'ibanrow')
    check('Bug1: the KVK got tagged onto that row', client._rows.find((r: Row) => r.id === 'ibanrow')?.kvk_number === '87654321')
    check('Bug1: no duplicate supplier was created', client._rows.length === 1)
  }

  // ── Correctness guard: two DIFFERENT companies that share a printed name but have DIFFERENT KVK
  // must stay SEPARATE (the whole reason KVK is a key). Existing row already has a KVK. ───────────
  {
    const client = makeClient([
      seedRow({ id: 'jansenA', name: 'Jansen', name_key: 'jansen', kvk_number: '11111111' }),
    ])
    const res = await resolveSupplierForImport(client, U, { name: 'Jansen', kvk: '22222222' })
    check('Distinct KVK, same name → NOT merged (new supplier created)', res?.id !== 'jansenA')
    check('Distinct KVK → two separate rows now', client._rows.length === 2)
  }

  // ── Same company, differently spelled, same KVK → united by the KVK tier. ──────────────────────
  {
    const client = makeClient([
      seedRow({ id: 'foo', name: 'Foo', name_key: 'foo', kvk_number: '33333333' }),
    ])
    const res = await resolveSupplierForImport(client, U, { name: 'Foo Bar Trading', kvk: '33333333' })
    check('Same KVK, different spelling → united to existing row', res?.id === 'foo')
    check('Same KVK → still one row', client._rows.length === 1)
  }

  // ── 23505 catch path: the KVK row already carries a DIFFERENT IBAN, so the IBAN-tier KVK-adoption
  // (.is iban null) MISSES → the create hits the (user,kvk) index → 23505 → the catch re-reads by
  // kvk and returns the existing row WITHOUT clobbering its IBAN. ────────────────────────────────
  {
    const client = makeClient([
      seedRow({ id: 'kvkiban', name: 'Bal', name_key: 'bal', kvk_number: '44444444', iban: 'NL22INGB0999999999' }),
    ])
    const res = await resolveSupplierForImport(client, U, {
      name: 'M.H. Bal Groothandel', iban: 'NL99ABNA0888888888', kvk: '44444444',
    })
    check('23505 catch: IBAN+KVK invoice resolves to the existing KVK row', res?.id === 'kvkiban')
    check('23505 catch: existing IBAN was NOT overwritten', client._rows.find((r: Row) => r.id === 'kvkiban')?.iban === 'NL22INGB0999999999')
    check('23505 catch: no duplicate created', client._rows.length === 1)
  }

  // ── Pure no-op sanity: no iban, no kvk, junk name → returns null, creates nothing. ─────────────
  {
    const client = makeClient([])
    const res = await resolveSupplierForImport(client, U, { name: 'Onbekende afzender' })
    check('No key + junk name → null, no supplier manufactured', res === null && client._rows.length === 0)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run()
