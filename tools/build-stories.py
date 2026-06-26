#!/usr/bin/env python3
"""
The Veil — static story-page generator.

Reads the current week's scored articles from Supabase (public anon key, read-only)
and writes one shareable, SEO-friendly HTML page per story into /story/, plus an
/archive.html index. Pages are keyed by <week_of>-<slug> so prior weeks are never
overwritten: the accumulated files ARE the archive (Supabase only retains the
current week).

Run locally:  python3 tools/build-stories.py
In CI:        see .github/workflows/build-stories.yml (weekly, after the Sunday pipeline)
"""
import json, os, re, html, urllib.request

SUPABASE_URL  = "https://zujxdvzvcyzpyfqininu.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1anhkdnp2Y3l6cHlmcWluaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNTYyNjIsImV4cCI6MjA5NzgzMjI2Mn0.ljS8POA6SpLAmd5Al7sdWduXbQpfUq0v8LTWCGv2cAU"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY_DIR = os.path.join(ROOT, "story")

# dimension display + max points (mirrors the scoring rubric)
DIMS = [
    ("source_tier_points",   30, "Quality of the original source"),
    ("corroboration_points", 25, "Independent corroboration"),
    ("specificity_points",   20, "Verifiable details"),
    ("track_record_points",  15, "Outlet's UAP track record"),
    ("consistency_points",   10, "Consistency with the record"),
]

def esc(s): return html.escape(str(s or ""), quote=True)

def head(title, desc, fname, ogtitle, ogimg):
    return (CHROME_HEAD.replace("@@TITLE@@", esc(title)[:90]).replace("@@DESC@@", esc(desc))
            .replace("@@FNAME@@", esc(fname)).replace("@@OGTITLE@@", esc(ogtitle)[:110])
            .replace("@@OGIMG@@", esc(ogimg)))

def slugify(title):
    s = (title or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:70].rstrip("-") or "story"

def fetch(path):
    req = urllib.request.Request(SUPABASE_URL + "/rest/v1/" + path,
        headers={"apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def strength(points, mx):
    r = points / mx if mx else 0
    if r >= 0.75: return "Strong"
    if r >= 0.45: return "Moderate"
    return "Limited"

def cred_color(n):
    return "#7FD8A6" if n >= 80 else "#E2A24B" if n >= 55 else "#E08A8A"

def cred_label(n):
    return ("Very High" if n >= 85 else "High" if n >= 70 else "Moderate" if n >= 55
            else "Low" if n >= 35 else "Unverified")

def fmt_date(s):
    if not s: return ""
    return s[:10]

CHROME_HEAD = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>@@TITLE@@ — The Veil</title>
<meta name="description" content="@@DESC@@">
<link rel="canonical" href="https://theveil.media/story/@@FNAME@@">
<meta property="og:type" content="article"><meta property="og:site_name" content="The Veil">
<meta property="og:title" content="@@OGTITLE@@">
<meta property="og:description" content="@@DESC@@">
<meta property="og:url" content="https://theveil.media/story/@@FNAME@@">
<meta property="og:image" content="@@OGIMG@@">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="@@OGTITLE@@"><meta name="twitter:description" content="@@DESC@@">
<meta name="twitter:image" content="{ogimg}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/veil.css">
<style>
  .st-wrap{max-width:760px;margin:0 auto;padding:36px 24px 72px}
  .st-back{display:inline-block;font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);text-decoration:none;margin-bottom:24px}
  .st-back:hover{color:var(--amber)}
  .st-tag{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);background:rgba(226,162,75,0.07);border:1px solid rgba(226,162,75,0.3);border-radius:6px;padding:5px 11px;margin-bottom:18px}
  .st-h1{font-family:var(--sans);font-size:clamp(28px,4.6vw,46px);font-weight:600;line-height:1.12;letter-spacing:-0.025em;color:var(--text-primary);margin:0 0 18px}
  .st-meta{font-family:var(--mono);font-size:12px;letter-spacing:.04em;color:var(--text-muted);text-transform:uppercase;margin-bottom:26px}
  .st-hero-img{width:100%;border-radius:var(--radius);border:1px solid var(--border);margin-bottom:30px;display:block}
  .st-credrow{display:flex;align-items:center;gap:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 24px;margin-bottom:30px}
  .st-ring{width:64px;height:64px;border-radius:50%;border:2px solid var(--c);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:22px;font-weight:700;color:var(--c);flex-shrink:0}
  .st-credlab{font-size:17px;font-weight:600;color:var(--text-primary)}
  .st-credsub{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-top:3px}
  .st-sec{margin:0 0 30px}
  .st-sec h2{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin:0 0 12px}
  .st-sec p{font-size:17px;line-height:1.75;color:var(--text-secondary);margin:0}
  .sw-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .sw-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px}
  .sw-card h3{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px}
  .sw-up h3{color:var(--green)} .sw-down h3{color:var(--amber)}
  .sw-card ul{list-style:none;margin:0;padding:0}
  .sw-card li{position:relative;padding:0 0 10px 16px;font-size:14.5px;line-height:1.55;color:var(--text-secondary)}
  .sw-card li:last-child{padding-bottom:0}
  .sw-card li::before{content:"";position:absolute;left:0;top:8px;width:6px;height:6px;border-radius:50%}
  .sw-up li::before{background:var(--green)} .sw-down li::before{background:var(--amber)}
  .st-rows{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 22px}
  .st-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--border);font-size:14.5px}
  .st-row:last-child{border-bottom:none}
  .st-row .lab{color:var(--text-secondary)} .st-row .val{font-family:var(--mono);color:var(--text-primary);font-weight:700}
  .st-source{display:inline-flex;align-items:center;font-family:var(--sans);font-size:15px;font-weight:600;color:var(--amber);text-decoration:none}
  .st-cta{background:linear-gradient(160deg,var(--surface),var(--deep));border:1px solid var(--border);border-radius:20px;padding:34px;text-align:center;margin-top:8px}
  .st-cta h3{font-family:var(--serif);font-size:clamp(22px,3vw,30px);font-weight:700;color:var(--text-primary);margin:0 0 10px}
  .st-cta p{font-size:15px;color:var(--text-secondary);margin:0 auto 20px;max-width:440px;line-height:1.6}
  .st-cta a{display:inline-block;background:var(--amber);color:#0a0a0a;text-decoration:none;font-family:var(--sans);font-size:15px;font-weight:600;padding:14px 30px;border-radius:100px}
  @media(max-width:640px){.sw-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="classbar"><div class="ci"><span><span class="cdot"></span>UAP INTELLIGENCE BRIEF · OPEN SOURCE</span><span>CLEARANCE: <span class="redact" title="Public record">PUBLIC</span></span></div></div>
<header><div class="header-inner">
  <a class="logo" href="/"><div class="logo-mark"><svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="7" stroke="#000" stroke-width="1.5" stroke-dasharray="3 2"/><circle cx="9" cy="9" r="2.5" fill="#000"/></svg></div><div class="logo-text"><span class="logo-word">The Veil</span><span class="logo-sub">TheVeil.media</span></div></a>
  <div class="nav-links"><a href="/">Latest Issue</a><a href="/archive">Archive</a><a href="/new-to-uap">New to UAP?</a><a href="/#subscribe-cta" class="subscribe-btn">Subscribe Free</a></div>
</div></header>
"""

FOOTER = """
<footer>
  <div style="font-family:'Space Mono',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--amber-dim);margin-bottom:14px;">— END OF FILE · NO FURTHER PAGES —</div>
  <div class="footer-logo">The Veil</div>
  <div class="footer-copy">The Veil / TheVeil.media &nbsp;·&nbsp; Credibility scores reflect editorial assessment only<br>Not affiliated with any government program &nbsp;·&nbsp; Delivered every Sunday evening</div>
  <div style="margin-top:14px;font-size:13px;"><a href="/new-to-uap" style="color:var(--text-secondary);text-decoration:none;">New to UAP?</a> &nbsp;·&nbsp; <a href="/standards" style="color:var(--text-secondary);text-decoration:none;">Standards &amp; Corrections</a> &nbsp;·&nbsp; <a href="/archive" style="color:var(--text-secondary);text-decoration:none;">Archive</a></div>
  <div style="margin-top:12px;font-size:13.5px;color:var(--text-secondary);">Contact: <a href="mailto:contact@theveil.media" style="color:var(--amber);text-decoration:none;">contact@theveil.media</a></div>
  <div style="margin-top:14px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Powered by Atomic Media Group LLC</div>
</footer>
</body></html>"""

def render_story(a):
    score = a.get("credibility_score") or 0
    c = cred_color(score)
    cat = (a.get("category") or "Brief").strip().title()
    title = a.get("title") or "Untitled"
    summary = a.get("summary") or ""
    sowhat = a.get("so_what") or ""
    source = a.get("source") or ""
    url = a.get("url") or ""
    img = a.get("image_url") or "https://theveil.media/og-card.png"
    week = str(a.get("week_of") or "")
    fname = "%s-%s.html" % (week, slugify(title))
    desc = (sowhat or summary)[:180]
    bd = a.get("score_breakdown") or {}

    # supports / weakens from the dimension points
    supports, weakens = [], []
    for key, mx, label in DIMS:
        pts = bd.get(key)
        if pts is None: continue
        s = strength(pts, mx)
        line = "%s: %s (%d/%d)" % (label, s, pts, mx)
        (supports if s == "Strong" else weakens if s == "Limited" else None)
        if s == "Strong": supports.append(line)
        elif s == "Limited": weakens.append(line)
    if not supports: supports.append("No single factor scored in the strongest band.")
    if not weakens: weakens.append("No major weaknesses flagged in the rubric.")

    rationale = bd.get("rationale") or ""
    hard_rule = bd.get("hard_rule")
    if hard_rule and hard_rule != "none":
        weakens.insert(0, "Hard rule applied: %s." % hard_rule)

    rows = ""
    for key, mx, label in DIMS:
        pts = bd.get(key)
        if pts is None: continue
        rows += '<div class="st-row"><span class="lab">%s</span><span class="val">%d / %d</span></div>' % (esc(label), pts, mx)

    img_block = '<img class="st-hero-img" src="%s" alt="%s">' % (esc(img), esc(title)) if a.get("image_url") else ""
    source_block = ('<a class="st-source" href="%s" target="_blank" rel="noopener">Read the original at %s →</a>'
                    % (esc(url), esc(source or "the source"))) if url else ""
    why = ('<div class="st-sec"><h2>Why it matters</h2><p>%s</p></div>' % esc(sowhat)) if sowhat else ""
    summ = ('<div class="st-sec"><h2>The two-minute version</h2><p>%s</p></div>' % esc(summary)) if summary else ""
    rat = ('<div class="st-sec"><h2>Our assessment</h2><p>%s</p></div>' % esc(rationale)) if rationale else ""

    body = """
<div class="st-wrap">
  <a class="st-back" href="/">← The Latest Issue</a>
  <div class="st-tag">{cat}</div>
  <h1 class="st-h1">{title}</h1>
  <div class="st-meta">{source}{dot}{date}</div>
  {img}
  <div class="st-credrow">
    <div class="st-ring" style="--c:{c}">{score}</div>
    <div><div class="st-credlab">{clab} Credibility</div><div class="st-credsub">Score {score} / 100 · Tier {tier}</div></div>
  </div>
  {summ}
  {why}
  <div class="st-sec">
    <h2>What supports it · what weakens it</h2>
    <div class="sw-grid">
      <div class="sw-card sw-up"><h3>What supports it</h3><ul>{sup}</ul></div>
      <div class="sw-card sw-down"><h3>What weakens it</h3><ul>{weak}</ul></div>
    </div>
  </div>
  <div class="st-sec"><h2>The credibility breakdown</h2><div class="st-rows">{rows}</div></div>
  {rat}
  <div class="st-sec"><h2>Primary source</h2><p style="margin-bottom:14px;">We link to the original so you can judge it yourself.</p>@@SOURCELINK@@</div>
  <div class="st-cta">
    <h3>Get the full brief every Sunday.</h3>
    <p>Every major UAP development, scored and sourced, free in your inbox.</p>
    <a href="/#subscribe-cta">Get The Veil Free</a>
  </div>
</div>
""".format(
        cat=esc(cat), title=esc(title), source=esc(source), dot=(" · " if source else ""),
        date=esc(fmt_date(a.get("published_date") or a.get("created_at"))),
        img=img_block, c=c, score=score, clab=esc(cred_label(score)), tier=a.get("source_tier") or "-",
        summ=summ, why=why,
        sup="".join("<li>%s</li>" % esc(x) for x in supports),
        weak="".join("<li>%s</li>" % esc(x) for x in weakens),
        rows=rows, rat=rat,
    ).replace('@@SOURCELINK@@', source_block)

    return fname, head(title, desc, fname, title, img) + body + FOOTER, {
        "fname": fname, "title": title, "score": score, "cat": cat, "week": week,
        "source": source, "img": img, "sowhat": (sowhat or summary)[:160]
    }

def render_archive(index):
    # group by week desc
    weeks = {}
    for it in index:
        weeks.setdefault(it["week"], []).append(it)
    cards = ""
    for wk in sorted(weeks.keys(), reverse=True):
        items = sorted(weeks[wk], key=lambda x: -x["score"])
        cards += '<div class="ar-week"><div class="ar-wk-label">Week of %s</div><div class="ar-grid">' % esc(wk)
        for it in items:
            c = cred_color(it["score"])
            cards += ('<a class="ar-card" href="/story/%s">'
                      '<span class="ar-score" style="--c:%s">%d</span>'
                      '<span class="ar-tag">%s</span>'
                      '<span class="ar-title">%s</span>'
                      '<span class="ar-sub">%s</span></a>') % (
                esc(it["fname"]), c, it["score"], esc(it["cat"]), esc(it["title"]), esc(it["sowhat"]))
        cards += '</div></div>'
    head_html = head("Archive", "Every story The Veil has covered, with its credibility score. Browse the full UAP record week by week.",
        "../archive", "The Veil — Story Archive", "https://theveil.media/og-card.png")
    body = """
<div class="scoring-hero"><div class="hero-eyebrow">The Record</div>
<h1 class="hero-headline" style="font-size:clamp(32px,5vw,56px);">Story Archive</h1>
<p class="hero-sub">Every story we have covered, with its credibility score. Browse the full UAP record, week by week.</p></div>
<div style="max-width:1100px;margin:0 auto;padding:20px 24px 72px">
<style>
 .ar-week{margin-bottom:48px}
 .ar-wk-label{font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin:0 0 18px;padding-bottom:10px;border-bottom:1px solid var(--border)}
 .ar-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
 .ar-card{display:block;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;text-decoration:none;transition:border-color .2s,transform .2s}
 .ar-card:hover{border-color:var(--line2);transform:translateY(-2px)}
 .ar-score{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:2px solid var(--c);font-family:var(--mono);font-size:14px;font-weight:700;color:var(--c);margin-bottom:12px}
 .ar-tag{display:block;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px}
 .ar-title{display:block;font-family:var(--sans);font-size:16px;font-weight:600;color:var(--text-primary);line-height:1.3;margin-bottom:8px}
 .ar-sub{display:block;font-size:13.5px;color:var(--text-secondary);line-height:1.5}
 @media(max-width:820px){.ar-grid{grid-template-columns:1fr}}
</style>
""" + cards + "</div>"
    return head_html + body + FOOTER

def main():
    os.makedirs(STORY_DIR, exist_ok=True)
    arts = fetch("articles?select=*&credibility_score=not.is.null&order=credibility_score.desc")
    index = []
    for a in arts:
        fname, html_out, meta = render_story(a)
        with open(os.path.join(STORY_DIR, fname), "w") as f:
            f.write(html_out)
        index.append(meta)
    # merge with any already-generated weeks (archive accumulates as files)
    existing = {}
    idx_path = os.path.join(STORY_DIR, "_index.json")
    if os.path.exists(idx_path):
        try: existing = {it["fname"]: it for it in json.load(open(idx_path))}
        except Exception: pass
    for it in index: existing[it["fname"]] = it
    all_items = list(existing.values())
    json.dump(all_items, open(idx_path, "w"), indent=0)
    with open(os.path.join(ROOT, "archive.html"), "w") as f:
        f.write(render_archive(all_items))
    print("generated %d story pages; archive lists %d total" % (len(index), len(all_items)))

if __name__ == "__main__":
    main()
