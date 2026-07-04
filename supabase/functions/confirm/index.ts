// The Veil — double opt-in confirmation handler.
// User clicks the link from the confirmation email: ?t=<signed token>. We verify the
// HMAC signature, then add the contact to Brevo list 4 (create-or-update, with
// REGION + timezone attributes), and redirect to the branded confirmed page.
// Links do NOT expire — the signature is what makes them safe. Invalid -> error state.
const BREVO = "https://api.brevo.com/v3";
const SITE = "https://theveil.media";
const LIST_ID = 4; // The Veil Subscribers

const b64urlToBytes = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function verify(token: string): Promise<{ e: string; r: string; z: string; t: number } | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const p = token.slice(0, dot), sig = token.slice(dot + 1);
  const secret = Deno.env.get("VEIL_FN_SECRET")!;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expect = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(p)));
  if (expect !== sig) return null;
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (!obj?.e) return null;
    return obj;
  } catch { return null; }
}
const redir = (path: string) => new Response(null, { status: 302, headers: { Location: `${SITE}${path}` } });

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") || "";
  const claim = await verify(token);
  if (!claim) return redir("/confirmed?status=expired");

  const region = (claim.r || "ET").toUpperCase();

  const r = await fetch(`${BREVO}/contacts`, {
    method: "POST",
    headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      email: claim.e,
      attributes: { REGION: region, CONTACT_TIMEZONE: claim.z || region, OPT_IN: true },
      listIds: [LIST_ID],
      updateEnabled: true, // idempotent: re-clicking just re-adds, no error
    }),
  });
  if (r.status >= 200 && r.status < 300) return redir("/confirmed");
  const txt = await r.text();
  // 400 "already in list" style responses still mean they're confirmed.
  if (r.status === 400 && /already|exist/i.test(txt)) return redir("/confirmed");
  console.error("brevo add error", r.status, txt);
  return redir("/confirmed?status=error");
});
