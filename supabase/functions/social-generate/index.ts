// social-generate — compose this week's X drafts (lead + top stories) into
// public.social_posts as status='draft'. Idempotent per (week_of, position):
// existing rows are never clobbered, so manual edits in the queue survive a re-run.
// Admin-key gated. Nothing is posted here — posting is a separate, approved step.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_KEY = Deno.env.get("VEIL_ADMIN_KEY") ?? "";

const SITE = "https://theveil.media";
const TOP = 3; // total posts: lead + (TOP-1) top stories

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function slugify(t: string): string {
  const s = (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s.slice(0, 70).replace(/-+$/, "")) || "story";
}

function clip(s: string, n: number): string {
  s = (s || "").trim();
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

// Compose a post that stays within X's 280 weighted chars (URLs weigh 23).
function compose(pos: number, title: string, score: number, link: string): string {
  const header = pos === 0 ? "🛸 The week in UAP\n\n" : "";
  const scoreLine = `\n\nVeil credibility score: ${score}/100\n`;
  const t = clip(title, 180);
  return `${header}${t}${scoreLine}${link}`;
}

// Text-only credibility callouts (positions 10 & 11) — the week's most- and
// least-credible story. They run on the off-days (Mon/Wed) and deliberately
// carry NO link: cheaper to post and not downranked by X's link suppression.
function composeCallout(kind: "high" | "low", title: string, score: number): string {
  const header = kind === "high"
    ? "🛸 This week's most credible UAP story"
    : "⚠️ This week's least credible UAP story";
  const verdict = kind === "high"
    ? `Veil credibility score: ${score}/100 — the best-sourced story in this week's issue.`
    : `Veil credibility score: ${score}/100 — thin sourcing, so treat it with skepticism until it's corroborated.`;
  // No URL, so the full 280 weighted chars are available; keep margin for the
  // 2-weight emoji, curly quotes and newlines. Budget the title against the rest.
  const fixed = header.length + verdict.length + 8;
  const t = clip(title, Math.max(40, Math.min(190, 270 - fixed)));
  return `${header}\n\n“${t}”\n\n${verdict}`;
}

// Saturday promo (position 20) — an evergreen advertisement for the site, not
// tied to any story. Rotates across variants by ISO week so consecutive
// Saturdays never post identical text (X rejects duplicate tweets). Every
// variant hits the three pitches: free Sunday-night newsletter, 0-100
// credibility scoring, and the paste-a-link checker. Ends on the site URL.
function composePromo(weekOf: string, count: number): string {
  const site = `${SITE}/`;
  const n = count > 0 ? count : "";
  const variants = [
    `The UAP conversation is mostly noise. The Veil turns it into signal.\n\n🗞️ Free newsletter, every Sunday night\n🔎 Paste any article or X post → an instant 0–100 credibility read\n\n${site}`,
    `This week we scored ${n} UAP stories 0–100 for credibility — so you don't have to guess which ones are real.\n\n🗞️ Free, every Sunday night\n🔎 Check any article or X post yourself\n\n${site}`,
    `What's real in UAP, and what isn't?\n\nThe Veil scores every story 0–100. A free newsletter every Sunday night — plus a tool to paste any article or X post and get a credibility read.\n\n${site}`,
    `Stop doomscrolling UFO claims. Start scoring them.\n\nThe Veil puts a 0–100 credibility score on every UAP story.\n🗞️ Free Sunday-night newsletter\n🔎 Paste any link or X post to check it\n\n${site}`,
  ];
  const epochWeek = Math.floor(new Date(`${weekOf}T00:00:00Z`).getTime() / (7 * 24 * 3600 * 1000));
  const idx = ((epochWeek % variants.length) + variants.length) % variants.length;
  return variants[idx];
}

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const key = req.headers.get("x-admin-key") ?? url.searchParams.get("key") ?? "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Pull the latest week's scored stories, best first.
  const res = await sb("articles?select=title,url,credibility_score,category,week_of&credibility_score=not.is.null&order=week_of.desc,credibility_score.desc&limit=24");
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "fetch_failed", detail: await res.text() }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const rows = await res.json() as Array<Record<string, unknown>>;
  if (!rows.length) {
    return new Response(JSON.stringify({ error: "no_articles" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const week = rows[0].week_of as string;
  const issue = rows.filter((r) => r.week_of === week);

  // Dedupe by normalized title (same rule as the homepage bake).
  const seen = new Set<string>();
  const pool: Array<Record<string, unknown>> = [];
  for (const r of issue) {
    const k = String(r.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 55);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    pool.push(r);
  }
  const selected = pool.slice(0, TOP);
  if (!selected.length) {
    return new Response(JSON.stringify({ error: "no_selection", week }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Prefer the deep story page, but fall back to the homepage if it isn't live
  // yet (the weekly page-builder may lag the issue), so we never post a dead link.
  async function resolveLink(title: string): Promise<string> {
    // Clean (extensionless) canonical URL — the Worker serves it 200 directly.
    const deep = `${SITE}/story/${week}-${slugify(title)}`;
    try {
      const r = await fetch(deep, { method: "HEAD", redirect: "follow" });
      if (r.ok) return deep;
    } catch { /* fall through */ }
    return `${SITE}/`;
  }

  // autopost=1 inserts rows already approved, so the weekly cron can post them
  // straight away with no manual review step.
  const autopost = url.searchParams.get("autopost") === "1" || url.searchParams.get("autopost") === "true";
  const initialStatus = autopost ? "approved" : "draft";

  const storyDrafts = await Promise.all(selected.map(async (a, i) => {
    const title = String(a.title || "");
    const score = Number(a.credibility_score || 0);
    const link = await resolveLink(title);
    return {
      week_of: week,
      position: i,
      title,
      link,
      score,
      category: a.category ?? null,
      text: compose(i, title, score, link),
      status: initialStatus,
    };
  }));

  // Off-day text callouts. `pool` is ordered by credibility_score desc, so the
  // first element is the most credible story and the last is the least.
  const calloutDrafts: Array<Record<string, unknown>> = [];
  const highest = pool[0];
  if (highest) {
    const title = String(highest.title || "");
    const score = Number(highest.credibility_score || 0);
    calloutDrafts.push({
      week_of: week, position: 10, title, link: null, score,
      category: highest.category ?? null,
      text: composeCallout("high", title, score), status: initialStatus,
    });
  }
  // Only run the "least credible" callout when the issue is big enough that the
  // lowest story isn't already one of the top-3 link posts.
  const lowest = pool[pool.length - 1];
  if (lowest && pool.length >= 4 && lowest !== highest) {
    const title = String(lowest.title || "");
    const score = Number(lowest.credibility_score || 0);
    calloutDrafts.push({
      week_of: week, position: 11, title, link: null, score,
      category: lowest.category ?? null,
      text: composeCallout("low", title, score), status: initialStatus,
    });
  }

  // Saturday evergreen promo (position 20) — an ad for the site, not a story.
  const promoDrafts: Array<Record<string, unknown>> = [{
    week_of: week, position: 20, title: "Weekly promo", link: `${SITE}/`,
    score: null, category: "promo",
    text: composePromo(week, pool.length), status: initialStatus,
  }];

  const drafts = [...storyDrafts, ...calloutDrafts, ...promoDrafts];

  // Upsert, ignoring existing (week_of, position) so edited/approved drafts stick.
  const up = await sb("social_posts?on_conflict=week_of,position", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(drafts),
  });
  if (!up.ok) {
    return new Response(JSON.stringify({ error: "insert_failed", detail: await up.text() }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const inserted = await up.json();

  // Return the full current queue for this week (inserted + any pre-existing).
  const cur = await sb(`social_posts?week_of=eq.${week}&order=position.asc`);
  const queue = cur.ok ? await cur.json() : inserted;

  return new Response(JSON.stringify({ ok: true, week, generated: Array.isArray(inserted) ? inserted.length : 0, queue }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
