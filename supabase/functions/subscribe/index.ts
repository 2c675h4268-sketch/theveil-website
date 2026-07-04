// The Veil — public subscribe endpoint with self-hosted double opt-in.
// Site posts {email, region, tz, company?(honeypot)} here. We DO NOT add anyone to
// the list yet. We mint a signed token and email a confirmation link (Brevo template
// 119). Only after the user clicks does the `confirm` function add them to list 4.
// Bots that never click never touch the list.
const BREVO = "https://api.brevo.com/v3";
const CONFIRM_TEMPLATE_ID = 119;
const CONFIRM_BASE = "https://zujxdvzvcyzpyfqininu.supabase.co/functions/v1/confirm";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: string): Promise<string> {
  const secret = Deno.env.get("VEIL_FN_SECRET")!;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}
async function mintToken(email: string, region: string, tz: string): Promise<string> {
  const payload = JSON.stringify({ e: email, r: region, z: tz, t: Date.now() });
  const p = b64url(new TextEncoder().encode(payload));
  return `${p}.${await sign(p)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let email = "", region = "ET", tz = "", honeypot = "";
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const b = await req.json();
      email = b.email || ""; region = b.region || "ET"; tz = b.tz || ""; honeypot = b.company || b.honeypot || "";
    } else {
      const f = await req.formData();
      email = String(f.get("email") || ""); region = String(f.get("region") || "ET");
      tz = String(f.get("tz") || ""); honeypot = String(f.get("company") || f.get("honeypot") || "");
    }
  } catch { return json({ error: "bad body" }, 400); }

  // honeypot: real users leave it empty; bots fill every field. Pretend success.
  if (honeypot.trim()) return json({ ok: true });

  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "invalid email" }, 422);
  region = (region || "ET").toUpperCase();

  const token = await mintToken(email, region, tz);
  const confirmUrl = `${CONFIRM_BASE}?t=${encodeURIComponent(token)}`;

  const r = await fetch(`${BREVO}/smtp/email`, {
    method: "POST",
    headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      to: [{ email }],
      templateId: CONFIRM_TEMPLATE_ID,
      params: { confirm_url: confirmUrl },
    }),
  });
  if (r.status >= 200 && r.status < 300) return json({ ok: true, pending: true });
  const txt = await r.text();
  console.error("brevo send error", r.status, txt);
  return json({ error: "send failed", status: r.status }, 502);
});
