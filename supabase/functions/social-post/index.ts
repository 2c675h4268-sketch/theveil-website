// social-post — post approved drafts from public.social_posts to X.
// Admin-key gated. Posts either one draft {id} or all status='approved' {all:true}.
// Uses OAuth 1.0a user-context (HMAC-SHA1) against POST https://api.x.com/2/tweets.
// The JSON body is NOT part of the OAuth signature base (X signs only the oauth_*
// params for a JSON-body v2 tweet), which is the documented/working approach.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_KEY = Deno.env.get("VEIL_ADMIN_KEY") ?? "";

const X_API_KEY = Deno.env.get("X_API_KEY") ?? "";
const X_API_SECRET = Deno.env.get("X_API_SECRET") ?? "";
const X_ACCESS_TOKEN = Deno.env.get("X_ACCESS_TOKEN") ?? "";
const X_ACCESS_SECRET = Deno.env.get("X_ACCESS_SECRET") ?? "";

const TWEET_URL = "https://api.x.com/2/tweets";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// RFC 3986 percent-encoding (encodeURIComponent misses ! * ' ( )).
function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function authHeader(method: string, url: string): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(oauth).sort()
    .map((k) => `${pct(k)}=${pct(oauth[k])}`).join("&");
  const base = `${method.toUpperCase()}&${pct(url)}&${pct(paramStr)}`;
  const signingKey = `${pct(X_API_SECRET)}&${pct(X_ACCESS_SECRET)}`;
  oauth.oauth_signature = await hmacSha1Base64(signingKey, base);
  const header = Object.keys(oauth).sort()
    .map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
  return `OAuth ${header}`;
}

async function postTweet(text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const auth = await authHeader("POST", TWEET_URL);
  const r = await fetch(TWEET_URL, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const bodyText = await r.text();
  if (!r.ok) return { ok: false, error: `x_${r.status}: ${bodyText.slice(0, 300)}` };
  try {
    const d = JSON.parse(bodyText);
    return { ok: true, id: d?.data?.id };
  } catch {
    return { ok: false, error: "bad_x_response" };
  }
}

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRK, Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const key = req.headers.get("x-admin-key") ?? url.searchParams.get("key") ?? "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) return json({ error: "unauthorized" }, 401);

  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
    return json({ error: "x_credentials_missing" }, 500);
  }

  let input: { id?: string; all?: boolean } = {};
  try { input = await req.json(); } catch { /* allow query-only */ }
  const one = input.id ?? url.searchParams.get("id") ?? undefined;
  const all = input.all ?? url.searchParams.get("all") === "true";

  // Only ever post rows the user explicitly approved.
  let q = "social_posts?status=eq.approved&order=position.asc";
  if (one) q = `social_posts?id=eq.${one}&status=eq.approved`;
  const res = await sb(q);
  if (!res.ok) return json({ error: "fetch_failed", detail: await res.text() }, 502);
  const rows = await res.json() as Array<Record<string, unknown>>;
  if (!rows.length) return json({ error: "nothing_approved" }, 404);
  const toPost = one ? rows.slice(0, 1) : (all ? rows : rows.slice(0, 1));

  const results: Array<Record<string, unknown>> = [];
  for (const row of toPost) {
    const id = row.id as string;
    const text = String(row.text || "");
    const out = await postTweet(text);
    if (out.ok) {
      await sb(`social_posts?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "posted", tweet_id: out.id ?? null, error: null, posted_at: new Date().toISOString() }),
      });
      results.push({ id, status: "posted", tweet_id: out.id });
    } else {
      await sb(`social_posts?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "failed", error: out.error ?? "unknown" }),
      });
      results.push({ id, status: "failed", error: out.error });
    }
  }

  return json({ ok: true, posted: results.filter((r) => r.status === "posted").length, results });
});
