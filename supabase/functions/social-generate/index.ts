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
    const deep = `${SITE}/story/${week}-${slugify(title)}.html`;
    try {
      const r = await fetch(deep, { method: "HEAD" });
      if (r.ok) return deep;
    } catch { /* fall through */ }
    return `${SITE}/`;
  }

  const drafts = await Promise.all(selected.map(async (a, i) => {
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
      status: "draft",
    };
  }));

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
