-- Tadbir schema. The server stores only ciphertext: every record a user creates is
-- encrypted on their device, and row ids are opaque HMACs. Row level security limits
-- each signed-in user to their own rows.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  wrapped_key text not null check (char_length(wrapped_key) < 400),
  wrapped_key_recovery text not null check (char_length(wrapped_key_recovery) < 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  blob text not null check (char_length(blob) < 400000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.profiles enable row level security;
alter table public.items enable row level security;

create policy "profiles: read own" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "profiles: create own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "items: read own" on public.items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "items: create own" on public.items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "items: update own" on public.items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "items: delete own" on public.items for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.items from anon;

-- Lets a signed-in user erase their account and, by cascade, all of their rows.
create function public.delete_my_account() returns void
  language sql security definer set search_path = ''
  as $$ delete from auth.users where id = (select auth.uid()); $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
