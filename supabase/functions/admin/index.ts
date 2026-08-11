// /functions/v1/admin?key=<secret> — JSON aggregates for The Veil's private growth
// dashboard (rendered by /admin on theveil.media). Subscribers live in Brevo (list 4),
// so everything is pulled from Brevo at request time. Key-gated (VEIL_ADMIN_KEY).
// Aggregates only — no PII returned. Served as JSON so the static /admin page can fetch it.
const BREVO = "https://api.brevo.com/v3";
const LIST_ID = 4;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

const CONSUMER: Record<string, string> = {
  "gmail.com": "Gmail", "googlemail.com": "Gmail",
  "outlook.com": "Outlook", "hotmail.com": "Outlook / Hotmail", "hotmail.co.uk": "Outlook / Hotmail",
  "live.com": "Outlook / Live", "msn.com": "Outlook / MSN",
  "icloud.com": "Apple (iCloud)", "me.com": "Apple (iCloud)", "mac.com": "Apple (iCloud)",
  "yahoo.com": "Yahoo", "ymail.com": "Yahoo", "yahoo.co.uk": "Yahoo",
  "proton.me": "Proton", "protonmail.com": "Proton", "aol.com": "AOL", "gmx.com": "GMX",
};
const isPersonal = (d: string) => !!CONSUMER[d];
const domainLabel = (d: string) => CONSUMER[d] || d;
const REGION_LABEL: Record<string, string> = {
  ET: "US Eastern", CT: "US Central", MT: "US Mountain", PT: "US Pacific",
  AKT: "Alaska", HT: "Hawaii", UK: "UK / Ireland", EU: "Europe", APAC: "Asia / Pacific",
};

async function brevoContacts(bkey: string) {
  const out: any[] = [];
  let offset = 0;
  for (let guard = 0; guard < 40; guard++) {
    const r = await fetch(`${BREVO}/contacts?listIds=${LIST_ID}&limit=500&offset=${offset}&sort=desc`, {
      headers: { "api-key": bkey, accept: "application/json" },
    });
    if (!r.ok) break;
    const j = await r.json();
    const batch = j.contacts || [];
    out.push(...batch);
    if (batch.length < 500) break;
    offset += 500;
  }
  return out;
}

async function engagement(bkey: string) {
  try {
    const r = await fetch(`${BREVO}/emailCampaigns?status=sent&type=classic&limit=50&sort=desc`, {
      headers: { "api-key": bkey, accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const camps = (j.campaigns || []).filter((c: any) => (c.sender?.email || "") === "brief@theveil.media");
    // Brevo leaves globalStats zeroed for these campaigns; the real numbers are the
    // per-list rows in campaignStats. Sum those across all sent issues.
    let delivered = 0, opens = 0, clicks = 0, sends = 0;
    for (const c of camps) {
      const rows = c.statistics?.campaignStats || [];
      let cDelivered = 0;
      for (const s of rows) {
        delivered += s.delivered || 0;
        cDelivered += s.delivered || 0;
        opens += s.uniqueViews || 0;
        clicks += s.uniqueClicks || 0;
      }
      if (cDelivered > 0) sends += 1;
    }
    const rate = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
    return { campaigns: sends, delivered, open: rate(opens, delivered), click: rate(clicks, delivered) };
  } catch (_e) { return null; }
}

const dayStr = (iso: string) => (iso || "").slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!key || key !== Deno.env.get("VEIL_ADMIN_KEY")) return json({ ok: false }, 401);
  const bkey = Deno.env.get("BREVO_API_KEY")!;

  const [contacts, eng] = await Promise.all([brevoContacts(bkey), engagement(bkey)]);

  const active = contacts.filter((c) => !c.emailBlacklisted);
  const blacklisted = contacts.filter((c) => c.emailBlacklisted);
  const unsub = blacklisted.length;
  const now = Date.now();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const unsubToday = blacklisted.filter((c) => (c.modifiedAt || "").slice(0, 10) === todayStr).length;
  const nameOf = (c: any) => {
    const a = c.attributes || {};
    return [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ").trim();
  };
  const recentUnsubs = blacklisted
    .slice()
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 5)
    .map((c) => ({ email: c.email, name: nameOf(c), at: (c.modifiedAt || "").slice(0, 16).replace("T", " ") }));
  const within = (c: any, days: number) => (now - new Date(c.createdAt).getTime()) <= days * 864e5;
  const new7 = active.filter((c) => within(c, 7)).length;
  const new30 = active.filter((c) => within(c, 30)).length;
  const recentSignups = active
    .filter((c) => within(c, 30))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((c) => ({ email: c.email, name: nameOf(c), region: (c.attributes?.REGION || "").toString(), at: (c.createdAt || "").slice(0, 10) }));

  const domCount: Record<string, number> = {};
  for (const c of active) {
    const dom = (c.email || "").split("@")[1] || "?";
    domCount[dom] = (domCount[dom] || 0) + 1;
  }
  const domainsSorted = Object.entries(domCount).map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n);
  const personalN = domainsSorted.filter((x) => isPersonal(x.domain)).reduce((s, x) => s + x.n, 0);
  const companyN = active.length - personalN;
  const companyOrgs = domainsSorted.filter((x) => !isPersonal(x.domain)).length;
  const domainRows = domainsSorted.map((x) => ({ nm: domainLabel(x.domain), n: x.n }));

  const regCount: Record<string, number> = {};
  const tzCount: Record<string, number> = {};
  for (const c of active) {
    const reg = (c.attributes?.REGION || "?").toString();
    regCount[reg] = (regCount[reg] || 0) + 1;
    const tz = (c.attributes?.CONTACT_TIMEZONE || "?").toString();
    tzCount[tz] = (tzCount[tz] || 0) + 1;
  }
  const regionRows = Object.entries(regCount).map(([r, n]) => ({ nm: REGION_LABEL[r] || r, n })).sort((a, b) => b.n - a.n);
  const tzRows = Object.entries(tzCount).map(([tz, n]) => ({ nm: tz.replace("America/", "").replace("Europe/", "").replace("_", " "), n })).sort((a, b) => b.n - a.n);

  const startDay = new Date(now - 29 * 864e5).toISOString().slice(0, 10);
  const base = active.filter((c) => dayStr(c.createdAt) < startDay).length;
  const perDay: Record<string, number> = {};
  for (const c of active) {
    const d = dayStr(c.createdAt);
    if (d >= startDay) perDay[d] = (perDay[d] || 0) + 1;
  }
  const daily: { d: string; n: number; cum: number }[] = [];
  let cum = base;
  for (let i = 0; i < 30; i++) {
    const d = new Date(now - (29 - i) * 864e5).toISOString().slice(0, 10);
    const n = perDay[d] || 0;
    cum += n;
    daily.push({ d, n, cum });
  }

  return json({
    ok: true,
    generated_at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    totals: { active: active.length, new7, new30, regions: Object.keys(regCount).length, unsub, unsub_today: unsubToday },
    recent_unsubs: recentUnsubs,
    recent_signups: recentSignups,
    engagement: eng,
    daily,
    domains: { companyN, personalN, companyOrgs, rows: domainRows },
    regions: regionRows,
    timezones: tzRows,
  });
});
