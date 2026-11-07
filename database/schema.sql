    begin;

-- This table stores the one record shape queried by backend/server.js.
-- JSON arrays are used for participants and extracted insights; no related
-- tables or foreign-key relationships are currently required by the app.
create table if not exists public.meetings (
  id text primary key default gen_random_uuid()::text,
  title text not null default '',
  date timestamptz,
  end_date timestamptz,
  mode text not null default '',
  participants jsonb not null default '[]'::jsonb,
  transcript text not null default '',
  summary text not null default '',
  action_items jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  clarifications jsonb not null default '[]'::jsonb,
  topics jsonb not null default '[]'::jsonb,
  pending_tasks integer not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add columns absent from a pre-existing meetings table without dropping,
-- replacing, or updating existing column values.
alter table public.meetings
  add column if not exists id text default gen_random_uuid()::text,
  add column if not exists title text not null default '',
  add column if not exists date timestamptz,
  add column if not exists end_date timestamptz,
  add column if not exists mode text not null default '',
  add column if not exists participants jsonb not null default '[]'::jsonb,
  add column if not exists transcript text not null default '',
  add column if not exists summary text not null default '',
  add column if not exists action_items jsonb not null default '[]'::jsonb,
  add column if not exists decisions jsonb not null default '[]'::jsonb,
  add column if not exists clarifications jsonb not null default '[]'::jsonb,
  add column if not exists topics jsonb not null default '[]'::jsonb,
  add column if not exists pending_tasks integer not null default 0,
  add column if not exists notes text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Match the server's ordering and ensure IDs can be used as stable API keys.
create unique index if not exists meetings_id_uidx
  on public.meetings (id);

create index if not exists meetings_date_created_at_idx
  on public.meetings (date desc nulls last, created_at desc);

-- The server uses SUPABASE_SECRET_KEY. Do not expose meeting data or writes
-- directly to anonymous/authenticated browser clients.
alter table public.meetings enable row level security;
revoke all on table public.meetings from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.meetings to service_role;

commit;