# Tadbir تدبير

A private organiser for bills and deadlines, money in and out, a diary, private loans, and an optional
daily Ibadah checklist. Each person chooses which sections they use.

Tadbir is a static web app (no build step) that installs to a phone's home screen. Data is stored in
Supabase, but **everything a user enters is encrypted on their own device before upload**.

## How the encryption works

- The password never leaves the device. It is stretched with PBKDF2 (600,000 rounds) into two halves:
  one is sent to Supabase as the login password, the other is a key that stays on the device.
- Each account has a random data key. The server holds it only in wrapped (encrypted) form: once under
  the password key and once under a recovery code shown to the user at sign-up.
- Every record is encrypted with AES-256-GCM. Row ids are HMACs, so the server cannot tell a bill from
  a diary entry.
- The server can still see: the account email, how many rows an account has, their sizes, and when they
  were last changed.
- A forgotten password can only be recovered with the recovery code. Nobody running Tadbir can reset it.

Code: `js/crypto.js` (encryption), `js/app.js` (app and accounts), `supabase/migrations` (database).

## Setup

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` in it.
2. In Supabase Auth settings, add the site address to the allowed redirect URLs.
3. Put the project URL and publishable key in `js/config.js`. With both empty the app runs in demo
   mode and saves nothing.
4. Host the folder on any static host (GitHub Pages works: Settings > Pages > deploy from `main`).

## Status

Working: accounts, encryption, recovery code, password reset with recovery code, section picker, bills,
money, diary, loans, Ibadah checklist, data export, account deletion, offline shell.

Not built yet: shared households (partner sees the same bills), phone notifications, App Store and
Google Play packaging, privacy policy and terms.

Before public launch: independent security review, and legal review of the privacy policy.
