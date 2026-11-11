-- Each user chooses how a forgotten password is handled:
--   recovery code  -> wrapped_key_recovery is set, escrow_key is null (only the user can ever open their data)
--   reset by email -> escrow_key is set (data key locked by the key-escrow function's secret)
alter table public.profiles alter column wrapped_key_recovery drop not null;
alter table public.profiles add column escrow_key text check (char_length(escrow_key) < 400);
alter table public.profiles add constraint profiles_has_recovery check (wrapped_key_recovery is not null or escrow_key is not null);

-- Needed for "I lost my code: erase my data and start again".
create policy "profiles: delete own" on public.profiles for delete to authenticated
  using ((select auth.uid()) = user_id);
