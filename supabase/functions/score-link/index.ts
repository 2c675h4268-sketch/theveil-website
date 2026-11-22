// POST /score-link  { url, email, company?(honeypot) }
// Subscriber-gated, UAP-scoped on-demand credibility scorer. Mirrors The Veil's
// newsletter rubric (5 dimensions + hard rules). Caches per URL; soft daily cap
// per subscriber. Secrets: BREVO_API_KEY, VEIL_ANTHROPIC_KEY.
const BREVO = "https://api.brevo.com/v3";
const LIST_ID = 4;                 // The Veil Subscribers (gate)
const DAILY_CAP = 20;              // scores per subscriber per day
const MODEL = "claude-opus-4-8";
const SUPABASE_URL = "https://zujxdvzvcyzpyfqininu.supabase.co";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RUBRIC = `You are the credibility editor for The Veil (TheVeil.media), a UAP news intelligence publication. Score ONE item that a reader submitted, using the exact rubric below. The current year is 2026.

First decide: is this content about UAP / UFO / unidentified anomalous phenomena / related government, science, or sighting topics? If NOT, set is_uap=false and still return the object (category "Off-topic", credibility_score 0, a one-line so_what saying it's outside The Veil's scope).

If it IS UAP-related, score it 0-100 by SUMMING five dimensions, then apply the hard rules.
1. SOURCE TIER (up to 30): 28-30 official government document (DoD, AARO, NASA, congressional record); 22-26 named senior official on record; 18-24 named researcher/academic or peer-reviewed; 18-22 established UAP investigative outlet (The Debrief, Liberation Times); 15-20 mainstream national press (NYT, WaPo, Reuters); 8-12 single anonymous source; 2-6 blogger/YouTuber/forum/social post; 0-3 sensationalist/fabrication-prone.
2. CORROBORATION (up to 25): 22-25 three+ independent credible sources; 15-18 two independent; 10-13 single source with documentary evidence; 4-7 single source no docs; 0-2 no sourcing.
3. SPECIFICITY & VERIFIABILITY (up to 20): 17-20 specific dates/locations/named individuals/document refs; 10-14 partial; 3-7 vague; 0-2 unfalsifiable.
4. OUTLET TRACK RECORD (up to 15, UAP-specific): 13-15 strong verified UAP record; 8-11 reputable generally, limited UAP history; 4-6 new/unknown; 0-3 prior credibility issues.
5. CONSISTENCY WITH KNOWN RECORD (up to 10): 8-10 consistent with and builds on verified prior disclosures; 5-7 neutral; 1-3 contradicts without explanation; 0-1 directly contradicts verified official statements.
HARD RULES (after summing): SOCIAL CEILING - if sourced exclusively from social media (e.g. an X/Twitter post), cap credibility_score at 60. FABRICATION FLOOR - if the outlet has a documented fabrication history, set credibility_score to 0.

source_tier (1-3): 1 = official/major; 2 = established independent; 3 = unverified/social.
category (exactly one): "Disclosure" (Congress/whistleblower/legislation/oversight), "Government" (agency action/release/document outside legislation), "Science" (peer-reviewed/academic analysis), "Sighting" (reported observation/footage/radar). For off-topic use "Off-topic".
summary: 1-2 sentences, neutral, max 360 chars. State what is reported, not whether it is true.
so_what: The Veil's editorial layer. 1-3 sentences, max 240 chars. Why it matters and what to watch next; if credibility is low, say what corroboration to wait for. No hype.

STYLE: never use em/en dashes; write plain and direct; do not use AI-tell words (delve, tapestry, realm, landscape, underscore, pivotal, robust, leverage, testament, "dive into", "cut through the noise", moreover, furthermore, "sheds light", "game-changer").

Return ONLY a raw JSON object (no markdown, no backticks) with EXACTLY these keys:
title (the item's title), source (clean publication name from the domain, e.g. nypost.com->New York Post; for an X/Twitter post use "X (@handle)"), category, credibility_score (int 0-100 = sum adjusted by hard rule), source_tier (int 1-3), is_uap (boolean), summary, so_what, score_breakdown (object with: source_tier_points, corroboration_points, specificity_points, track_record_points, consistency_points (ints), hard_rule (one of: none, social_ceiling_60, fabrication_floor_0), rationale (one sentence)).`;

// --- X / Twitter: read a public post via the syndication endpoint (no API key) ---
function tweetId(u: string): string | null {
  const m = u.match(/(?:twitter\.com|x\.com)\/[^\/?#]+\/status(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}
async function fetchTweet(id: string): Promise<string | null> {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  try {
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", accept: "application/json" },
    });
    if (!r.ok) return null;
    const t = await r.json();
    if (!t || !t.text) return null;
    const u = t.user || {};
    const handle = u.screen_name ? "@" + u.screen_name : "";
    const verified = (u.verified || u.is_blue_verified || u.isBlueVerified) ? "yes" : "no";
    let body = t.text as string;
    if (t.quoted_tweet && t.quoted_tweet.text) {
      const qu = t.quoted_tweet.user || {};
      body += `\n\n[Quoted post by @${qu.screen_name || ""}]: ${t.quoted_tweet.text}`;
    }
    return `SOURCE TYPE: X / Twitter post (social media).\nAuthor: ${u.name || ""} (${handle}). Account verified: ${verified}. Date: ${(t.created_at || "").slice(0, 10)}.\n\nPOST TEXT:\n${body}`;
  } catch (_e) { return null; }
}

async function isSubscriber(bkey: string, email: string): Promise<boolean> {
  try {
    const r = await fetch(`${BREVO}/contacts/${encodeURIComponent(email)}`, { headers: { "api-key": bkey, accept: "application/json" } });
    if (!r.ok) return false;
    const c = await r.json();
    return !c.emailBlacklisted && Array.isArray(c.listIds) && c.listIds.includes(LIST_ID);
  } catch (_e) { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let data: any = {};
  try {
    const ct = req.headers.get("content-type") || "";
    data = ct.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch { return json({ ok: false, error: "bad_request" }, 400); }

  if ((data.company || "").toString().trim() !== "") return json({ ok: true, cached: true }); // honeypot
  const email = (data.email || "").toString().trim().toLowerCase();
  let url = (data.url || "").toString().trim();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 422);
  if (!/^https?:\/\/\S+\.\S+/.test(url)) return json({ ok: false, error: "invalid_url" }, 422);
  url = url.slice(0, 2048);

  const bkey = Deno.env.get("BREVO_API_KEY")!;
  const akey = Deno.env.get("VEIL_ANTHROPIC_KEY")!;
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // auto-injected; server-side only, bypasses RLS
  const sbHeaders = { apikey: srk, Authorization: `Bearer ${srk}`, "content-type": "application/json" };

  // gate: subscribers only
  if (!(await isSubscriber(bkey, email))) {
    return json({ ok: false, reason: "not_subscriber" }, 403);
  }

  // cache: already scored this URL?
  try {
    const c = await fetch(`${SUPABASE_URL}/rest/v1/link_scores?url=eq.${encodeURIComponent(url)}&select=*&limit=1`, { headers: sbHeaders });
    const rows = await c.json();
    if (Array.isArray(rows) && rows.length) return json({ ok: true, cached: true, result: rows[0] });
  } catch (_e) { /* ignore cache miss */ }

  // soft daily cap per subscriber
  try {
    const since = new Date(Date.now() - 864e5).toISOString();
    const cnt = await fetch(`${SUPABASE_URL}/rest/v1/link_scores?scored_by_email=eq.${encodeURIComponent(email)}&created_at=gte.${since}&select=id`, { headers: { ...sbHeaders, Prefer: "count=exact" } });
    const total = parseInt((cnt.headers.get("content-range") || "0-0/0").split("/")[1] || "0", 10);
    if (total >= DAILY_CAP) return json({ ok: false, reason: "daily_cap", cap: DAILY_CAP }, 429);
  } catch (_e) { /* ignore */ }

  // get readable content: X posts via syndication, everything else via direct fetch
  let content = "";
  const tid = tweetId(url);
  const isX = !!tid;
  if (isX) {
    const tw = await fetchTweet(tid!);
    if (!tw) return json({ ok: false, reason: "could_not_read", error: "Could not read that X post. It may be deleted, from a protected account, or age-restricted." }, 422);
    content = `URL: ${url}\n${tw}`.slice(0, 9000);
  } else {
    try {
      const rr = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36", accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      if (rr.ok) {
        let html = await rr.text();
        const grab = (re: RegExp) => (html.match(re) || [, ""])[1] || "";
        const title = grab(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const desc = grab(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([^"']+)/i);
        const main = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [])[0] || html;
        const body = main
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z#0-9]+;/gi, " ")
          .replace(/\s+/g, " ").trim();
        content = `URL: ${url}\nTITLE: ${title.replace(/\s+/g, " ").trim()}\nDESCRIPTION: ${desc}\n\nPAGE TEXT:\n${body}`.slice(0, 9000);
      }
    } catch (_e) { /* fall through */ }
    if (!content || content.replace(/URL:.*TITLE:\s*|DESCRIPTION:\s*|PAGE TEXT:/g, "").trim().length < 60) {
      return json({ ok: false, reason: "could_not_read", error: "Could not read that link. It may be paywalled, require a login, or be blocking automated readers." }, 422);
    }
  }

  // score with Claude
  let obj: any;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: RUBRIC + `\n\nSUBMITTED URL: ${url}\n\nREADER CONTENT:\n${content}` }] }),
    });
    if (!r.ok) return json({ ok: false, error: "score_failed", status: r.status }, 502);
    let txt = (await r.json()).content[0].text.trim();
    if (txt.startsWith("```")) txt = txt.split("```")[1].replace(/^json/, "").trim();
    obj = JSON.parse(txt);
  } catch (e) { return json({ ok: false, error: "score_parse" }, 502); }

  const sb = obj.score_breakdown || {};
  // Make the headline score equal the sum of the shown dimensions (adjusted by any
  // hard rule), so the breakdown bars always add up to the ring on the page.
  if (obj.is_uap !== false) {
    const pts = (sb.source_tier_points || 0) + (sb.corroboration_points || 0) + (sb.specificity_points || 0) + (sb.track_record_points || 0) + (sb.consistency_points || 0);
    let score = Math.max(0, Math.min(100, pts));
    if (sb.hard_rule === "social_ceiling_60") score = Math.min(score, 60);
    if (sb.hard_rule === "fabrication_floor_0") score = 0;
    // X posts are social media: enforce the 60 ceiling per the rubric even if the model missed it
    if (isX && sb.hard_rule !== "fabrication_floor_0" && score > 60) {
      score = 60;
      if (!sb.hard_rule || sb.hard_rule === "none") sb.hard_rule = "social_ceiling_60";
    }
    obj.credibility_score = score;
  } else {
    obj.credibility_score = 0;
  }
  const row = {
    url, title: obj.title || "", source: obj.source || "", category: obj.category || "",
    credibility_score: obj.credibility_score ?? null, source_tier: obj.source_tier ?? null,
    summary: obj.summary || "", so_what: obj.so_what || "", rationale: sb.rationale || "",
    score_breakdown: sb, is_uap: obj.is_uap !== false, scored_by_email: email,
  };
  // store (best-effort; ignore conflict if another request raced)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/link_scores`, { method: "POST", headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
  } catch (_e) { /* ignore */ }

  return json({ ok: true, cached: false, result: row });
});
