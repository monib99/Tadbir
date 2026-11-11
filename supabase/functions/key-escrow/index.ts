// Easy recovery for users who chose "reset by email" at sign-up.
// wrap:   the signed-in user sends their data key; it comes back locked with ESCROW_SECRET.
// unwrap: the signed-in user gets their own data key back (used after an email password reset).
// ESCROW_SECRET lives only in this function's secrets, never in the database, so a copy of the
// database alone cannot open anyone's data. Changing the secret breaks recovery for existing users.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function secretKey(): Promise<CryptoKey | null> {
  const secret = Deno.env.get("ESCROW_SECRET") ?? "";
  if (secret.length < 32) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tadbir-escrow-v1:" + secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const apikey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const headers = { Authorization: auth, apikey };

  const who = await fetch(`${url}/auth/v1/user`, { headers });
  if (!who.ok) return json({ error: "not signed in" }, 401);
  const user = await who.json();
  if (!user?.id) return json({ error: "not signed in" }, 401);

  const key = await secretKey();
  if (!key) return json({ error: "recovery is not set up" }, 503);

  let body: { action?: string; key?: string };
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  if (body.action === "wrap") {
    let raw: Uint8Array;
    try { raw = unb64(body.key ?? ""); } catch { return json({ error: "bad key" }, 400); }
    if (raw.length !== 64) return json({ error: "bad key" }, 400);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(user.id);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, raw));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return json({ blob: b64(out) });
  }

  if (body.action === "unwrap") {
    const res = await fetch(`${url}/rest/v1/profiles?select=escrow_key&user_id=eq.${user.id}`, { headers });
    if (!res.ok) return json({ error: "lookup failed" }, 502);
    const rows = await res.json();
    const blob = rows?.[0]?.escrow_key;
    if (!blob) return json({ error: "no backup key for this account" }, 404);
    try {
      const all = unb64(blob);
      const aad = new TextEncoder().encode(user.id);
      const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12), additionalData: aad }, key, all.slice(12)));
      return json({ key: b64(raw) });
    } catch { return json({ error: "backup key could not be opened" }, 500); }
  }
  return json({ error: "unknown action" }, 400);
});
