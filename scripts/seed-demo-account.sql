-- scripts/seed-demo-account.sql
-- [DEMO-SEED] A self-contained demo tenant, for store screenshots and for Play Console review.
--
-- WHY THIS FILE EXISTS
-- docs/PLAY_STORE_LISTING.md asks for two things that turn out to be the same thing: five phone
-- screenshots of the /dashboard screens (§2), and "a throwaway demo account seeded with a few
-- invoices" for Google's reviewers (§3). Screenshotting a REAL tenant would put a real business's
-- suppliers, IBANs and bank descriptions on a public store page, and redacting them by hand is
-- both ugly on a store listing and one missed pixel away from being permanent. A tenant of its own
-- is the cheaper answer: RLS already isolates it, so the screenshots are clean by construction
-- rather than by review.
--
-- EVERY NAME AND NUMBER BELOW IS INVENTED. The IBAN is the documentation example IBAN; the KvK and
-- BTW numbers follow the Dutch format without belonging to anyone.
--
-- SAFETY: strictly additive and scoped. Every statement is keyed to DEMO_USER_ID and no statement
-- touches a row that does not belong to it. Re-running replaces the demo tenant's own rows only.
--
-- Apply:  psql "$DATABASE_URL" -f scripts/seed-demo-account.sql
-- Remove: delete from auth.users where id = 'd3d3d3d3-0000-4000-8000-000000000001';
--         (the foreign keys cascade the rest away)

begin;

do $$
declare
  demo_id  uuid := 'd3d3d3d3-0000-4000-8000-000000000001';
  demo_pw  text := 'BoekBrugDemo2026!';
  c_bakker uuid := 'd3d3d3d3-0000-4000-8000-00000000c001';
  c_praktijk uuid := 'd3d3d3d3-0000-4000-8000-00000000c002';
  c_cafe   uuid := 'd3d3d3d3-0000-4000-8000-00000000c003';
  s_groot  uuid := 'd3d3d3d3-0000-4000-8000-00000000e001';
  s_tank   uuid := 'd3d3d3d3-0000-4000-8000-00000000e002';
  s_telecom uuid := 'd3d3d3d3-0000-4000-8000-00000000e003';
begin

  ----------------------------------------------------------------------------
  -- 1. The account. The on_auth_user_created trigger writes the profile row.
  ----------------------------------------------------------------------------
  if not exists (select 1 from auth.users where id = demo_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      demo_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'demo@boekbrug.nl', crypt(demo_pw, gen_salt('bf')),
      now(), now() - interval '5 months', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
    );
  else
    update auth.users
       set encrypted_password = crypt(demo_pw, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = demo_id;
  end if;

  -- GoTrue refuses a password sign-in for a user with no email identity, and inserting into
  -- auth.users does not create one — the account exists, the hash matches, and the login still
  -- comes back "Invalid login credentials". auth.identities.email is a generated column, so it is
  -- set through identity_data rather than named in the insert.
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), demo_id::text, demo_id,
         jsonb_build_object('sub', demo_id::text, 'email', 'demo@boekbrug.nl',
                            'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now()
   where not exists (
     select 1 from auth.identities where user_id = demo_id and provider = 'email');

  -- The demo company. onboarding_done matters: without it the middleware sends every
  -- /dashboard/* request to /onboarding and the screenshots are all of the wizard.
  insert into public.profiles (id, email) values (demo_id, 'demo@boekbrug.nl')
  on conflict (id) do nothing;

  update public.profiles set
    role = 'zzper',
    full_name = 'Sanne de Vries',
    company_name = 'De Vries Schoonmaak',
    kvk_number = '87654321',
    btw_number = 'NL876543210B01',
    iban = 'NL91ABNA0417164300',
    email = 'demo@boekbrug.nl',
    phone = '06 12 34 56 78',
    address = 'Vlampijpstraat 42',
    postal_code = '3534 AR',
    city = 'Utrecht',
    onboarding_step = 99,
    onboarding_done = true,
    preferred_language = 'nl',
    invoice_number_template = 'F{jaar}-{nummer}',
    invoice_number_padding = 3,
    reminders_enabled = true
  where id = demo_id;

  ----------------------------------------------------------------------------
  -- 2. Clear this tenant's own rows so the file can be re-run.
  ----------------------------------------------------------------------------
  delete from public.bank_tx_invoices  where user_id = demo_id;
  delete from public.bank_transactions where user_id = demo_id;
  delete from public.invoice_lines     where invoice_id in (
    select id from public.invoices where sender_id = demo_id or receiver_id = demo_id);
  delete from public.invoices          where sender_id = demo_id or receiver_id = demo_id;
  delete from public.clients           where user_id = demo_id;
  delete from public.suppliers         where user_id = demo_id;

  ----------------------------------------------------------------------------
  -- 3. Klanten en leveranciers — invented, Dutch-shaped.
  ----------------------------------------------------------------------------
  insert into public.clients (id, user_id, name, email, kvk_number, btw_number, address, postal_code, city) values
    (c_bakker,   demo_id, 'Bakkerij Hendriks',      'administratie@bakkerijhendriks.nl', '61234567', 'NL612345670B01', 'Amsterdamsestraatweg 118', '3513 AG', 'Utrecht'),
    (c_praktijk, demo_id, 'Fysiopraktijk Zonnehof', 'facturen@zonnehof-fysio.nl',        '62345678', 'NL623456780B01', 'Zonnehof 15',              '3811 ND', 'Amersfoort'),
    (c_cafe,     demo_id, 'Café De Brug',           'jan@cafedebrug.nl',                 '63456789', 'NL634567890B01', 'Oudegracht 201',           '3511 NG', 'Utrecht');

  insert into public.suppliers (id, user_id, name, name_key, iban) values
    (s_groot,   demo_id, 'Schoonmaakgroothandel Midden', 'schoonmaakgroothandel midden', 'NL18RABO0123459876'),
    (s_tank,    demo_id, 'Tankstation Noordpoort',       'tankstation noordpoort',       'NL39INGB0006543210'),
    (s_telecom, demo_id, 'Zakelijk Telecom Nederland',   'zakelijk telecom nederland',   'NL22ABNA0998877665');

  ----------------------------------------------------------------------------
  -- 4. Uitgaande facturen — Q3 2026, the quarter the screenshots are taken in.
  --    A mix of paid / sent / overdue, because a screen where everything is green
  --    shows none of the states the app exists to make visible.
  ----------------------------------------------------------------------------
  insert into public.invoices (
    id, sender_id, invoice_number, invoice_date, due_date, status, direction,
    total_ex_btw, btw_amount, total_inc_btw, client_id, client_name, client_email,
    client_address, client_postal_code, client_city, client_btw_number,
    source, invoice_type, payment_method, payment_date
  ) values
    (gen_random_uuid(), demo_id, 'F2026-001', '2026-07-03', '2026-07-17', 'paid',    'outgoing',  480.00, 100.80,  580.80, c_bakker,   'Bakkerij Hendriks',      'administratie@bakkerijhendriks.nl', 'Amsterdamsestraatweg 118', '3513 AG', 'Utrecht',    'NL612345670B01', 'created', 'factuur', 'bank', '2026-07-15'),
    (gen_random_uuid(), demo_id, 'F2026-002', '2026-07-10', '2026-07-24', 'paid',    'outgoing',  750.00, 157.50,  907.50, c_praktijk, 'Fysiopraktijk Zonnehof', 'facturen@zonnehof-fysio.nl',        'Zonnehof 15',              '3811 ND', 'Amersfoort', 'NL623456780B01', 'created', 'factuur', 'bank', '2026-07-22'),
    (gen_random_uuid(), demo_id, 'F2026-003', '2026-07-18', '2026-08-01', 'paid',    'outgoing',  320.00,  67.20,  387.20, c_cafe,     'Café De Brug',           'jan@cafedebrug.nl',                 'Oudegracht 201',           '3511 NG', 'Utrecht',    'NL634567890B01', 'created', 'factuur', 'bank', '2026-07-30'),
    (gen_random_uuid(), demo_id, 'F2026-004', '2026-07-31', '2026-08-14', 'paid',    'outgoing',  480.00, 100.80,  580.80, c_bakker,   'Bakkerij Hendriks',      'administratie@bakkerijhendriks.nl', 'Amsterdamsestraatweg 118', '3513 AG', 'Utrecht',    'NL612345670B01', 'created', 'factuur', 'bank', '2026-08-12'),
    (gen_random_uuid(), demo_id, 'F2026-005', '2026-08-07', '2026-08-21', 'paid',    'outgoing',  750.00, 157.50,  907.50, c_praktijk, 'Fysiopraktijk Zonnehof', 'facturen@zonnehof-fysio.nl',        'Zonnehof 15',              '3811 ND', 'Amersfoort', 'NL623456780B01', 'created', 'factuur', 'bank', '2026-08-19'),
    (gen_random_uuid(), demo_id, 'F2026-006', '2026-08-14', '2026-08-28', 'sent',    'outgoing',  400.00,  84.00,  484.00, c_cafe,     'Café De Brug',           'jan@cafedebrug.nl',                 'Oudegracht 201',           '3511 NG', 'Utrecht',    'NL634567890B01', 'created', 'factuur', null, null),
    (gen_random_uuid(), demo_id, 'F2026-007', '2026-08-21', '2026-09-04', 'sent',    'outgoing',  520.00, 109.20,  629.20, c_bakker,   'Bakkerij Hendriks',      'administratie@bakkerijhendriks.nl', 'Amsterdamsestraatweg 118', '3513 AG', 'Utrecht',    'NL612345670B01', 'created', 'factuur', null, null),
    (gen_random_uuid(), demo_id, 'F2026-008', '2026-07-08', '2026-07-22', 'overdue', 'outgoing',  640.00, 134.40,  774.40, c_praktijk, 'Fysiopraktijk Zonnehof', 'facturen@zonnehof-fysio.nl',        'Zonnehof 15',              '3811 ND', 'Amersfoort', 'NL623456780B01', 'created', 'factuur', null, null);

  ----------------------------------------------------------------------------
  -- 5. Inkomende facturen — the costs side, so the BTW screen has voorbelasting
  --    to subtract instead of showing turnover against nothing.
  ----------------------------------------------------------------------------
  insert into public.invoices (
    id, receiver_id, invoice_number, invoice_date, due_date, status, direction,
    total_ex_btw, btw_amount, total_inc_btw, supplier_id, client_name,
    source, invoice_type, payment_method, payment_date
  ) values
    (gen_random_uuid(), demo_id, '2026-4471',   '2026-07-04', '2026-07-18', 'paid', 'incoming', 210.00, 44.10, 254.10, s_groot,   'Schoonmaakgroothandel Midden', 'camera', 'factuur', 'bank', '2026-07-10'),
    (gen_random_uuid(), demo_id, '2026-4612',   '2026-07-19', '2026-08-02', 'paid', 'incoming', 186.50, 39.17, 225.67, s_groot,   'Schoonmaakgroothandel Midden', 'camera', 'factuur', 'bank', '2026-07-25'),
    (gen_random_uuid(), demo_id, '2026-4790',   '2026-08-06', '2026-08-20', 'paid', 'incoming', 243.80, 51.20, 295.00, s_groot,   'Schoonmaakgroothandel Midden', 'email',  'factuur', 'bank', '2026-08-12'),
    (gen_random_uuid(), demo_id, 'TNK-70118',   '2026-07-07', '2026-07-07', 'paid', 'incoming',  62.81, 13.19,  76.00, s_tank,    'Tankstation Noordpoort',       'camera', 'factuur', 'bank', '2026-07-07'),
    (gen_random_uuid(), demo_id, 'TNK-71904',   '2026-07-24', '2026-07-24', 'paid', 'incoming',  58.68, 12.32,  71.00, s_tank,    'Tankstation Noordpoort',       'camera', 'factuur', 'bank', '2026-07-24'),
    (gen_random_uuid(), demo_id, 'TNK-73566',   '2026-08-11', '2026-08-11', 'paid', 'incoming',  65.29, 13.71,  79.00, s_tank,    'Tankstation Noordpoort',       'camera', 'factuur', 'bank', '2026-08-11'),
    (gen_random_uuid(), demo_id, 'ZTN-2026-07', '2026-07-01', '2026-07-15', 'paid', 'incoming',  45.00,  9.45,  54.45, s_telecom, 'Zakelijk Telecom Nederland',   'email',  'factuur', 'bank', '2026-07-02'),
    (gen_random_uuid(), demo_id, 'ZTN-2026-08', '2026-08-01', '2026-08-15', 'paid', 'incoming',  45.00,  9.45,  54.45, s_telecom, 'Zakelijk Telecom Nederland',   'email',  'factuur', 'bank', '2026-08-03'),
    -- One still to process: the "te verwerken" state is half of what the bridge screen is for.
    (gen_random_uuid(), demo_id, '2026-4903',   '2026-08-22', '2026-09-05', 'received', 'incoming', 174.30, 36.60, 210.90, s_groot, 'Schoonmaakgroothandel Midden', 'camera', 'factuur', null, null);

  ----------------------------------------------------------------------------
  -- 6. Bankafschrift — the incoming side matches the paid sales invoices so the
  --    matching screen shows matches rather than an empty column.
  ----------------------------------------------------------------------------
  insert into public.bank_transactions (id, user_id, date, amount, description, counterpart_name, counterpart_iban, reference, status, source, category, category_source, category_confirmed) values
    (gen_random_uuid(), demo_id, '2026-07-15',  580.80, 'SEPA overboeking',        'Bakkerij Hendriks',            'NL44RABO0111222333', 'F2026-001', 'matched',   'import', 'omzet',        'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-22',  907.50, 'SEPA overboeking',        'Fysiopraktijk Zonnehof',       'NL77INGB0444555666', 'F2026-002', 'matched',   'import', 'omzet',        'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-30',  387.20, 'SEPA overboeking',        'Café De Brug',                 'NL12ABNA0777888999', 'F2026-003', 'matched',   'import', 'omzet',        'rule', true),
    (gen_random_uuid(), demo_id, '2026-08-12',  580.80, 'SEPA overboeking',        'Bakkerij Hendriks',            'NL44RABO0111222333', 'F2026-004', 'matched',   'import', 'omzet',        'rule', true),
    (gen_random_uuid(), demo_id, '2026-08-19',  907.50, 'SEPA overboeking',        'Fysiopraktijk Zonnehof',       'NL77INGB0444555666', 'F2026-005', 'matched',   'import', 'omzet',        'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-10', -254.10, 'Factuur 2026-4471',       'Schoonmaakgroothandel Midden', 'NL18RABO0123459876', '2026-4471', 'matched',   'import', 'inkoop',       'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-25', -225.67, 'Factuur 2026-4612',       'Schoonmaakgroothandel Midden', 'NL18RABO0123459876', '2026-4612', 'matched',   'import', 'inkoop',       'rule', true),
    (gen_random_uuid(), demo_id, '2026-08-12', -295.00, 'Factuur 2026-4790',       'Schoonmaakgroothandel Midden', 'NL18RABO0123459876', '2026-4790', 'matched',   'import', 'inkoop',       'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-07',  -76.00, 'Betaalautomaat',          'Tankstation Noordpoort',       'NL39INGB0006543210', null,        'matched',   'import', 'autokosten',   'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-24',  -71.00, 'Betaalautomaat',          'Tankstation Noordpoort',       'NL39INGB0006543210', null,        'matched',   'import', 'autokosten',   'rule', true),
    (gen_random_uuid(), demo_id, '2026-08-11',  -79.00, 'Betaalautomaat',          'Tankstation Noordpoort',       'NL39INGB0006543210', null,        'matched',   'import', 'autokosten',   'rule', true),
    (gen_random_uuid(), demo_id, '2026-07-02',  -54.45, 'Incasso abonnement',      'Zakelijk Telecom Nederland',   'NL22ABNA0998877665', null,        'matched',   'import', 'telefoon',     'rule', true),
    (gen_random_uuid(), demo_id, '2026-08-03',  -54.45, 'Incasso abonnement',      'Zakelijk Telecom Nederland',   'NL22ABNA0998877665', null,        'matched',   'import', 'telefoon',     'rule', true),
    -- Two the app has NOT resolved. An unmatched row is what makes the matching screen a screen.
    (gen_random_uuid(), demo_id, '2026-08-24',  484.00, 'SEPA overboeking',        'Café De Brug',                 'NL12ABNA0777888999', null,        'pending',   'import', null,           null,   false),
    (gen_random_uuid(), demo_id, '2026-08-18',  -34.95, 'Betaalautomaat 18-08',    'Bouwmarkt Overvecht',          'NL60INGB0333222111', null,        'not_found', 'import', null,           null,   false);

  ----------------------------------------------------------------------------
  -- 7. Link each matched bank row to the invoice it pays.
  ----------------------------------------------------------------------------
  insert into public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied, paid_on, method)
  select gen_random_uuid(), demo_id, bt.id, inv.id, abs(bt.amount), bt.date, 'bank'
    from public.bank_transactions bt
    join public.invoices inv
      on inv.invoice_number = bt.reference
     and (inv.sender_id = demo_id or inv.receiver_id = demo_id)
   where bt.user_id = demo_id and bt.reference is not null;

end $$;

commit;
