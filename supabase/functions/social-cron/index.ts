// social-cron — staggered weekly automation. Gated by CRON_KEY (a secret only
// the scheduler knows, not the admin dashboard key). Each scheduled run posts
// ONE position of the latest week:
//   Sunday  ?generate=1&position=0  -> build this week's 3 approved drafts, post the lead
//   Tuesday ?position=1             -> post story #2
//   Thursday?position=2             -> post story #3
// No review step (the user opted into full auto). The manual dashboard still works.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_KEY = Deno.env.get("VEIL_ADMIN_KEY") ?? "";
const CRON_KEY = Deno.env.get("VEIL_CRON_KEY") ?? "";
const FN = `${SUPABASE_URL}/functions/v1`;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function sb(path: string): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = req.headers.get("x-cron-key") ?? url.searchParams.get("key") ?? "";
  if (!CRON_KEY || key !== CRON_KEY) return json({ error: "unauthorized" }, 401);

  const position = Number(url.searchParams.get("position") ?? "0");
  const doGenerate = url.searchParams.get("generate") === "1";

  let gen: unknown = null;
  if (doGenerate) {
    try {
      const gr = await fetch(`${FN}/social-generate?autopost=1&key=${encodeURIComponent(ADMIN_KEY)}`, { method: "POST" });
      gen = await gr.json();
      if (!gr.ok) return json({ ok: false, step: "generate", detail: gen }, 502);
    } catch (e) {
      return json({ ok: false, step: "generate", error: String(e) }, 502);
    }
  }

  // Find the latest week's row at this position that is still approved (not yet posted).
  const r = await sb(`social_posts?select=id,week_of,position,status&order=week_of.desc,position.asc&limit=24`);
  if (!r.ok) return json({ ok: false, step: "lookup", detail: await r.text(), generate: gen }, 502);
  const rows = await r.json() as Array<{ id: string; week_of: string; position: number; status: string }>;
  if (!rows.length) return json({ ok: false, step: "lookup", reason: "no_rows", generate: gen }, 404);

  const week = rows[0].week_of;
  const target = rows.find((x) => x.week_of === week && x.position === position);
  if (!target) return json({ ok: true, posted: 0, reason: "no_row_at_position", week, position, generate: gen });
  if (target.status === "posted") return json({ ok: true, posted: 0, reason: "already_posted", week, position, generate: gen });
  if (target.status !== "approved") return json({ ok: true, posted: 0, reason: `status_${target.status}`, week, position, generate: gen });

  // Post exactly this row.
  let post: unknown = null;
  try {
    const pr = await fetch(`${FN}/social-post?key=${encodeURIComponent(ADMIN_KEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: target.id }),
    });
    post = await pr.json();
  } catch (e) {
    return json({ ok: false, step: "post", error: String(e), generate: gen }, 502);
  }

  return json({ ok: true, ran_at: new Date().toISOString(), week, position, generate: gen, post });
});
