-- Run this in the Supabase SQL Editor (Project → SQL Editor) to create the shared storage table.
-- Then in Settings → API copy your Project URL and anon (public) key into supabase-config.js.

create table if not exists app_data (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Allow anonymous read/write so everyone with the app URL can share data.
-- For a department-only app this is usually fine. To restrict later, enable RLS and add policies.
alter table app_data enable row level security;

create policy "Allow anon read and write app_data"
  on app_data
  for all
  to anon
  using (true)
  with check (true);
