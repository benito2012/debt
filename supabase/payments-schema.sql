-- ============================================================
-- DEBTAGENT PAYMENTS SCHEMA — Add to existing schema.sql
-- ============================================================

-- ── Payout accounts (Stripe Connect per client) ──────────────
create table payout_accounts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade unique,
  -- Stripe Connect
  stripe_account_id text,           -- acct_xxxxx (Express account)
  stripe_onboarding_complete boolean default false,
  stripe_payouts_enabled boolean default false,
  -- M-Pesa
  mpesa_paybill text,               -- their business paybill
  mpesa_till text,                  -- or till number
  -- Bank (manual payout)
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  bank_routing text,
  -- Preferred payout method
  preferred_method text check (preferred_method in ('stripe','mpesa','bank','flutterwave')) default 'stripe',
  -- Flutterwave
  flutterwave_recipient_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Payment links (one per debtor, reusable) ─────────────────
create table payment_links (
  id uuid primary key default uuid_generate_v4(),
  debtor_id uuid references debtors(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  amount numeric(15,2) not null,
  currency text not null,
  -- Stripe Payment Intent
  stripe_payment_intent_id text,
  stripe_payment_link_url text,
  -- M-Pesa
  mpesa_checkout_request_id text,
  -- Status
  status text check (status in ('active','paid','expired','cancelled')) default 'active',
  -- Tracking
  times_viewed integer default 0,
  last_viewed_at timestamptz,
  paid_at timestamptz,
  amount_paid numeric(15,2),
  payment_method_used text,         -- card, mpesa, bank
  -- Payout
  payout_status text check (payout_status in ('pending','processing','sent','failed')) default 'pending',
  payout_amount numeric(15,2),      -- amount after commission
  payout_sent_at timestamptz,
  payout_reference text,            -- Stripe transfer ID or M-Pesa ref
  expires_at timestamptz default now() + interval '30 days',
  created_at timestamptz default now()
);

-- ── Transactions (every payment in) ──────────────────────────
create table transactions (
  id uuid primary key default uuid_generate_v4(),
  payment_link_id uuid references payment_links(id),
  debtor_id uuid references debtors(id),
  org_id uuid references organizations(id),
  -- Amounts
  gross_amount numeric(15,2) not null,    -- what debtor paid
  currency text not null,
  gross_amount_usd numeric(15,2),         -- normalized
  commission_rate numeric(5,2) not null,
  commission_amount numeric(15,2) not null,
  net_amount numeric(15,2) not null,      -- what client receives
  -- Processing fees (Stripe takes ~2.9% + 30c)
  processing_fee numeric(15,2) default 0,
  -- Source
  payment_method text,                    -- card, mpesa, bank
  stripe_payment_intent_id text,
  stripe_charge_id text,
  mpesa_receipt text,
  -- Payout
  payout_status text default 'pending',
  payout_id text,                         -- Stripe Transfer ID
  payout_sent_at timestamptz,
  created_at timestamptz default now()
);

-- ── Payouts (money sent to clients) ──────────────────────────
create table payouts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id),
  -- What's included in this payout
  transaction_ids uuid[] not null,
  total_gross numeric(15,2) not null,
  total_commission numeric(15,2) not null,
  total_net numeric(15,2) not null,        -- amount client receives
  currency text not null,
  -- Execution
  method text,                             -- stripe, mpesa, bank
  stripe_transfer_id text,
  mpesa_reference text,
  bank_reference text,
  status text check (status in ('pending','processing','sent','failed')) default 'pending',
  failure_reason text,
  sent_at timestamptz,
  created_at timestamptz default now()
);

-- ── RLS ──────────────────────────────────────────────────────
alter table payout_accounts enable row level security;
alter table payment_links enable row level security;
alter table transactions enable row level security;
alter table payouts enable row level security;

create policy "Org owner sees own payout account" on payout_accounts
  for all using (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "Org owner sees own payment links" on payment_links
  for all using (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "Org owner sees own transactions" on transactions
  for all using (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "Org owner sees own payouts" on payouts
  for all using (org_id in (select id from organizations where owner_id = auth.uid()));

-- ── Payment links are public (debtor visits without auth) ────
-- Allow anonymous read on payment_links by token
create policy "Public read payment link by token" on payment_links
  for select using (true);   -- token validation happens in app logic

-- ── Useful view ──────────────────────────────────────────────
create or replace view commission_summary as
select
  o.id as org_id,
  o.name as org_name,
  count(t.id) as total_transactions,
  sum(t.gross_amount) as total_collected,
  sum(t.commission_amount) as total_commission,
  sum(t.net_amount) as total_paid_out,
  sum(case when t.payout_status = 'pending' then t.net_amount else 0 end) as pending_payout
from transactions t
join organizations o on o.id = t.org_id
group by o.id, o.name;
