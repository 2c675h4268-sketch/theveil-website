#!/usr/bin/env python3
"""
The Veil — homepage pre-renderer ("baker").

Fetches the current week's stories from Supabase (public anon key) and writes the
real lead + tiles + issue meta INTO index.html, between marker comments, so the
served HTML contains the actual stories (for crawlers, social cards, AI readers,
and no-JS visitors). The page's own JavaScript still re-renders the same content
on load for interactivity, so JS users see no change.

Mirrors the in-page renderLead / renderTiles / renderMeta / loadFeed logic exactly
so there is no flash between the baked HTML and the hydrated HTML.

Run:  python3 tools/bake-home.py   (run alongside tools/build-stories.py weekly)
"""
import json, os, re, urllib.request
from datetime import datetime

SUPABASE_URL  = "https://zujxdvzvcyzpyfqininu.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1anhkdnp2Y3l6cHlmcWluaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNTYyNjIsImV4cCI6MjA5NzgzMjI2Mn0.ljS8POA6SpLAmd5Al7sdWduXbQpfUq0v8LTWCGv2cAU"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")

def esc(s):
    s = "" if s is None else str(s)
    return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")

def cat_key(c): return (c or "").lower()
def cat_label(c): return c or "Brief"
def cred_class(n): n=n or 0; return "cred-high" if n>=80 else "cred-mid" if n>=55 else "cred-low"
def cred_label(n):
    n = n if n is not None else 0
    return ("Very High Credibility" if n>=85 else "High Credibility" if n>=70 else
            "Moderate Credibility" if n>=55 else "Low Credibility" if n>=35 else "Unverified")
def fmt_date(iso):
    if not iso: return ""
    try: return datetime.fromisoformat(str(iso).replace("Z","+00:00")).strftime("%b %-d")
    except Exception: return ""
def bg(url):
    if url: return "background-image:url('%s');" % str(url).replace("'","%27")
    return "background:linear-gradient(135deg,#1A1A26,#0F0F18);"
def so_what(a):
    if a.get("so_what"):
        return ('<div class="so-what"><div class="so-what-label">The “So What”</div>'
                '<p class="so-what-text">%s</p></div>' % esc(a["so_what"]))
    return ""
def tier_label(t):
    return {1:"Tier 1 · Official / Major source", 2:"Tier 2 · Established independent",
            3:"Tier 3 · Unverified / social"}.get(t, "")

def fetch():
    req = urllib.request.Request(
        SUPABASE_URL + "/rest/v1/articles?select=*&order=week_of.desc,credibility_score.desc&limit=24",
        headers={"apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def select(rows):
    if not rows: return None, [], None, 0
    week = rows[0].get("week_of")
    issue = [r for r in rows if r.get("week_of") == week]
    seen, pool = set(), []
    for r in issue:
        k = re.sub(r"[^a-z0-9]+", " ", (r.get("title") or "").lower()).strip()[:55]
        if not k or k in seen: continue
        seen.add(k); pool.append(r)
    selected = pool[:13]
    if not selected: return week, [], None, 0
    return week, selected[1:], selected[0], len(selected)

def render_lead(a):
    cs = a.get("credibility_score")
    return ('<div class="featured-tile" onclick="openModal(\'%s\')">' % a.get("id")
        + '<div class="featured-bg" style="%s"></div>' % bg(a.get("image_url"))
        + '<div class="featured-overlay"></div>'
        + '<div class="featured-body">'
        +   '<div class="featured-badge">This Week’s Lead Story</div>'
        +   '<div class="tag tag-%s" style="margin-bottom:12px;">%s</div>' % (cat_key(a.get("category")), esc(cat_label(a.get("category"))))
        +   '<h2 class="featured-headline">%s</h2>' % esc(a.get("title"))
        +   '<p class="featured-summary">%s</p>' % esc(a.get("summary") or "")
        +   '<div class="featured-footer">'
        +     '<div class="credibility">'
        +       '<div class="cred-ring %s">%s</div>' % (cred_class(cs), cs if cs is not None else "-")
        +       '<div class="cred-label"><strong>%s</strong>%s</div>' % (cred_label(cs), esc(tier_label(a.get("source_tier"))))
        +     '</div>'
        +     '<div class="tile-source-meta">%s &nbsp;·&nbsp; %s</div>' % (esc(a.get("source") or ""), fmt_date(a.get("published_date")))
        +   '</div>'
        +   so_what(a)
        + '</div></div>')

def render_tile(a):
    cs = a.get("credibility_score")
    return ('<div class="tile" onclick="openModal(\'%s\')">' % a.get("id")
        + '<div class="tile-img" style="%s">' % bg(a.get("image_url"))
        +   '<div class="tile-img-overlay"></div>'
        +   '<div class="tile-img-tag"><div class="tag tag-%s">%s</div></div>' % (cat_key(a.get("category")), esc(cat_label(a.get("category"))))
        + '</div>'
        + '<div class="tile-body">'
        +   '<p class="tile-headline">%s</p>' % esc(a.get("title"))
        +   '<div class="credibility">'
        +     '<div class="cred-ring %s">%s</div>' % (cred_class(cs), cs if cs is not None else "-")
        +     '<div class="cred-label"><strong>%s</strong>%s</div>' % (cred_label(cs), esc(a.get("source") or ""))
        +   '</div>'
        +   so_what(a)
        +   '<div class="tile-footer">'
        +     '<span class="tile-source">%s · %s</span>' % (esc(a.get("source") or ""), fmt_date(a.get("published_date")))
        +     '<div class="read-arrow">→</div>'
        +   '</div>'
        + '</div>'
        + '</div>')

def render_meta(week, count):
    try: label = datetime.fromisoformat(week + "T00:00:00").strftime("%B %-d, %Y")
    except Exception: label = week or ""
    noun = "Story" if count == 1 else "Stories"
    return 'Week of %s <span>|</span> %s %s <span>|</span> New issue every Sunday evening' % (label, count, noun)

def replace_between(html, start, end, content):
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    return pat.sub(start + content + end, html, count=1)

def main():
    rows = fetch()
    week, tiles, lead, count = select(rows)
    if not lead:
        print("no stories to bake"); return
    html = open(INDEX, encoding="utf-8").read()
    for mk in ("<!--LEAD:START-->","<!--TILES:START-->","<!--META:START-->"):
        if mk not in html:
            print("ERROR: marker %s not found in index.html" % mk); return
    html = replace_between(html, "<!--LEAD:START-->", "<!--LEAD:END-->", render_lead(lead))
    html = replace_between(html, "<!--TILES:START-->", "<!--TILES:END-->", "".join(render_tile(t) for t in tiles))
    html = replace_between(html, "<!--META:START-->", "<!--META:END-->", render_meta(week, count))
    open(INDEX, "w", encoding="utf-8").write(html)
    print("baked: week=%s lead=%r tiles=%d" % (week, (lead.get("title") or "")[:50], len(tiles)))

if __name__ == "__main__":
    main()
