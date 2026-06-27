#!/usr/bin/env python3
"""The Veil — slow social promo (1080x1920 MP4) showing the actual weekly brief."""
import json, io, math, urllib.request
from PIL import Image, ImageDraw, ImageFont
import numpy as np, imageio

W, H = 1080, 1920
FPS = 30
SUP = "/System/Library/Fonts/Supplemental/"
def F(name, size): return ImageFont.truetype(SUP+name, size)
SERIF   = lambda s: F("Georgia Bold.ttf", s)
SERIFR  = lambda s: F("Georgia.ttf", s)
SANS_B  = lambda s: F("Arial Bold.ttf", s)
SANS    = lambda s: F("Arial.ttf", s)
MONO    = lambda s: F("Courier New Bold.ttf", s)

# palette (matches the site)
BG=(6,7,11); SURF=(18,21,28); SURF2=(22,25,33); LINE=(34,36,44)
AMBER=(226,162,75); AMBERD=(138,100,32); T1=(245,245,247); T2=(169,170,180); T3=(116,117,127)
GREEN=(127,216,166); RED=(224,138,138)
def cred_color(n): return GREEN if n>=80 else AMBER if n>=55 else RED
def cred_label(n): return "Very High" if n>=85 else "High" if n>=70 else "Moderate" if n>=55 else "Low" if n>=35 else "Unverified"

# fetch the current week's stories (public anon key)
import re as _re
def _fetch_stories():
    U="https://zujxdvzvcyzpyfqininu.supabase.co/rest/v1/articles?select=title,source,credibility_score,so_what,category,image_url,week_of&order=week_of.desc,credibility_score.desc&limit=24"
    A="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1anhkdnp2Y3l6cHlmcWluaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNTYyNjIsImV4cCI6MjA5NzgzMjI2Mn0.ljS8POA6SpLAmd5Al7sdWduXbQpfUq0v8LTWCGv2cAU"
    rq=urllib.request.Request(U,headers={"apikey":A,"Authorization":"Bearer "+A})
    rows=json.load(urllib.request.urlopen(rq,timeout=30))
    wk=rows[0]["week_of"]; issue=[r for r in rows if r["week_of"]==wk]
    seen=[]; pool=[]
    for r in issue:
        k=_re.sub(r"[^a-z0-9]+"," ",(r["title"] or "").lower()).strip()[:55]
        if k and k not in seen: seen.append(k); pool.append(r)
    return {"week":wk,"stories":pool[:5]}
data=_fetch_stories()
stories = data["stories"]

def wrap(draw, text, font, maxw):
    words=text.split(); lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        if draw.textlength(t, font=font)<=maxw: cur=t
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    return lines

def dl_image(url):
    try:
        req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
        b=urllib.request.urlopen(req, timeout=15).read()
        return Image.open(io.BytesIO(b)).convert("RGB")
    except Exception:
        return None

def cover(img, bw, bh):
    iw,ih=img.size; s=max(bw/iw, bh/ih)
    img=img.resize((max(1,int(iw*s)),max(1,int(ih*s))), Image.LANCZOS)
    x=(img.width-bw)//2; y=(img.height-bh)//2
    return img.crop((x,y,x+bw,y+bh))

def rounded(img, rad):
    m=Image.new("L", img.size, 0); d=ImageDraw.Draw(m)
    d.rounded_rectangle([0,0,img.width-1,img.height-1], rad, fill=255)
    out=img.copy(); out.putalpha(m); return out

def ring(draw, cx, cy, r, score, base):
    col=cred_color(score)
    draw.ellipse([cx-r,cy-r,cx+r,cy+r], outline=col, width=5)
    f=MONO(int(r*0.95)); s=str(score)
    tw=draw.textlength(s,font=f); asc,desc=f.getmetrics()
    draw.text((cx-tw/2, cy-(asc+desc)/2+2), s, font=f, fill=col)

# ---------- build the tall BRIEF canvas ----------
M=72            # side margin
CW=W-2*M        # content width
canvas_h=4200
brief=Image.new("RGB",(W,canvas_h),BG)
d=ImageDraw.Draw(brief)
def center(text,font,y,fill):
    tw=d.textlength(text,font=font); d.text(((W-tw)/2,y),text,font=font,fill=fill);
y=70
# classification strip
s="UAP INTELLIGENCE BRIEF  ·  OPEN SOURCE"; center(s,MONO(22),y,T3); y+=66
d.line([M,y,W-M,y], fill=LINE, width=2); y+=46
# header
center("The Veil", SERIF(72), y, T1); y+=96
center("T H E V E I L . M E D I A", MONO(24), y, AMBER); y+=70
d.line([M,y,W-M,y], fill=LINE, width=2); y+=60

def label(txt, y):
    f=MONO(28); d.text((M,y),txt,font=f,fill=T2)
    d.line([M, y+52, W-M, y+52], fill=LINE, width=2)
    return y+92

def tag(x,y,txt,col=AMBER):
    f=MONO(22); tw=d.textlength(txt,font=f)
    d.rounded_rectangle([x,y,x+tw+34,y+44], 8, outline=col, width=2)
    d.text((x+17,y+9),txt,font=f,fill=col); return tw+34

# THE LEAD
y=label("THE LEAD", y)
lead=stories[0]
card_x=M; card_w=CW
# lead image
img=dl_image(lead.get("image_url") or "")
imgh=420
cardtop=y
if img:
    ci=rounded(cover(img,card_w,imgh),18)
    brief.paste(ci,(card_x,y),ci)
else:
    d.rounded_rectangle([card_x,y,card_x+card_w,y+imgh],18,fill=SURF2)
y+=imgh+30
tag(card_x, y, (lead.get("category") or "Brief").upper()); y+=70
for ln in wrap(d, lead["title"], SANS_B(50), card_w):
    d.text((card_x,y),ln,font=SANS_B(50),fill=T1); y+=60
y+=14
# cred ring row
ring(d, card_x+44, y+44, 44, lead["credibility_score"], BG)
d.text((card_x+110,y+14), cred_label(lead["credibility_score"])+" Credibility", font=SANS_B(34), fill=T1)
d.text((card_x+110,y+58), (lead.get("source") or ""), font=MONO(24), fill=T3)
y+=120
# So What box
sw=(lead.get("so_what") or "")
if sw:
    box_y=y; lines=wrap(d, sw, SANS(32), card_w-56)
    boxh=40+ len("L") + 44 + len(lines)*44 + 30
    boxh=44+44+len(lines)*44+24
    d.rounded_rectangle([card_x,y,card_x+card_w,y+boxh],12, fill=(21,17,10), outline=(58,46,22), width=2)
    d.text((card_x+28,y+22),'THE "SO WHAT"',font=MONO(22),fill=AMBER)
    yy=y+62
    for ln in lines:
        d.text((card_x+28,yy),ln,font=SANS(32),fill=T2); yy+=44
    y+=boxh
y+=70

# THE CREDIBILITY BOARD
y=label("THE CREDIBILITY BOARD", y)
for st in stories[1:5]:
    row_top=y
    th=210
    d.rounded_rectangle([M,y,W-M,y+th],16, fill=SURF, outline=LINE, width=2)
    pad=30
    ring(d, M+pad+40, y+pad+40, 40, st["credibility_score"], SURF)
    tx=M+pad+110
    tag(tx, y+pad, (st.get("category") or "Brief").upper())
    yy=y+pad+62
    for ln in wrap(d, st["title"], SANS_B(36), (W-M)-tx-pad)[:2]:
        d.text((tx,yy),ln,font=SANS_B(36),fill=T1); yy+=46
    d.text((tx,y+th-46), (st.get("source") or "")+"  ·  "+cred_label(st["credibility_score"]), font=MONO(22), fill=T3)
    y+=th+24
y+=40
brief=brief.crop((0,0,W,y))
BH=brief.height

# ---------- intro & outro cards ----------
def grid_bg():
    im=Image.new("RGB",(W,H),BG); dd=ImageDraw.Draw(im)
    for gx in range(0,W,72): dd.line([gx,0,gx,H],fill=(11,12,17),width=1)
    for gy in range(0,H,72): dd.line([0,gy,W,gy],fill=(11,12,17),width=1)
    # amber top glow
    glow=Image.new("L",(W,H),0); gd=ImageDraw.Draw(glow)
    gd.ellipse([W//2-560,-360,W//2+560,460],fill=70)
    glow=glow.filter(__import__("PIL.ImageFilter",fromlist=["GaussianBlur"]).GaussianBlur(120))
    am=Image.new("RGB",(W,H),AMBER); im=Image.composite(am,im,glow.point(lambda v:int(v*0.5)))
    return im

def card_intro():
    im=grid_bg(); dd=ImageDraw.Draw(im)
    cy=560
    # eyebrow pill
    f=MONO(26); s="WEEKLY UAP INTELLIGENCE"; tw=dd.textlength(s,font=f)
    px=(W-(tw+72))/2
    dd.rounded_rectangle([px,cy,px+tw+72,cy+62],100,outline=AMBERD,width=2)
    dd.ellipse([px+26,cy+27,px+34,cy+35],fill=AMBER)
    dd.text((px+48,cy+16),s,font=f,fill=AMBER); cy+=130
    sw=SERIF(60); s="The Veil"; dd.text(((W-dd.textlength(s,font=sw))/2,cy),s,font=sw,fill=T1); cy+=140
    f=SANS_B(82)
    for ln in ["UAP news,","scored for","credibility."]:
        dd.text(((W-dd.textlength(ln,font=f))/2,cy),ln,font=f,fill=T1); cy+=96
    cy+=26; f=SANS(40)
    for ln in ["What's real. What's credible.","What it means."]:
        dd.text(((W-dd.textlength(ln,font=f))/2,cy),ln,font=f,fill=T2); cy+=54
    f=MONO(26); s="THEVEIL.MEDIA"; dd.text(((W-dd.textlength(s,font=f))/2,1740),s,font=f,fill=AMBER)
    return im

def card_outro():
    im=grid_bg(); dd=ImageDraw.Draw(im)
    cy=520; f=SANS_B(64)
    for ln in ["Every story,","scored 0 to 100","for credibility."]:
        dd.text(((W-dd.textlength(ln,font=f))/2,cy),ln,font=f,fill=T1); cy+=80
    cy+=40; f=SANS(42)
    for ln in ["Free. One intelligent briefing","every Sunday evening."]:
        dd.text(((W-dd.textlength(ln,font=f))/2,cy),ln,font=f,fill=T2); cy+=58
    cy+=70
    # amber button
    bf=SANS_B(40); s="Get The Veil Free"; bw=dd.textlength(s,font=bf)+96; bx=(W-bw)/2
    dd.rounded_rectangle([bx,cy,bx+bw,cy+96],100,fill=AMBER)
    dd.text((bx+48,cy+24),s,font=bf,fill=(10,10,10)); cy+=170
    f=MONO(34); s="TheVeil.media"; dd.text(((W-dd.textlength(s,font=f))/2,cy),s,font=f,fill=AMBER)
    return im

intro=card_intro(); outro=card_outro()
briefnp=np.asarray(brief)

def brief_view(yoff):
    yoff=int(max(0,min(BH-H,yoff)))
    return Image.fromarray(briefnp[yoff:yoff+H])

# ---------- assemble frames (slow) ----------
frames=[]
def hold(img,sec):
    for _ in range(int(sec*FPS)): frames.append(img)
def fade_from_black(img,sec):
    n=int(sec*FPS)
    for i in range(n): frames.append(Image.blend(Image.new("RGB",(W,H),(0,0,0)),img,(i+1)/n))
def xfade(a,b,sec):
    n=int(sec*FPS)
    for i in range(n): frames.append(Image.blend(a,b,(i+1)/n))

fade_from_black(intro,0.7)
hold(intro,2.4)
top=brief_view(0)
xfade(intro,top,0.8)
# slow scroll
scroll_sec=11.5; n=int(scroll_sec*FPS); span=BH-H
for i in range(n):
    t=i/(n-1)
    # ease in/out for a smooth, deliberate feel
    e=0.5-0.5*math.cos(math.pi*t)
    frames.append(brief_view(e*span))
bottom=brief_view(span)
xfade(bottom,outro,0.8)
hold(outro,3.0)

dur=len(frames)/FPS
print("frames",len(frames),"duration %.1fs"%dur,"brief height",BH)

out="/Users/adamprice/theveil/theveil-promo.mp4"
w=imageio.get_writer(out, fps=FPS, codec="libx264", quality=8,
                     macro_block_size=8, ffmpeg_params=["-pix_fmt","yuv420p"])
for fr in frames: w.append_data(np.asarray(fr.convert("RGB")))
w.close()
print("wrote", out)
