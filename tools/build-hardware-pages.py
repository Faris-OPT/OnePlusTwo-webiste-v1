#!/usr/bin/env python3
"""Build one page per hardware model at /hardware/<slug> from content/hardware.json.

Run from the repository root after changing content/hardware.json:

    python3 tools/build-hardware-pages.py

Pages copy the header and footer from hardware.html. Like the Hardware page, they show
no prices: each "Order now" button deep-links to the right product in the shop.
tools/build-structured-data.py only reads root pages, so this script writes each page's
Product, FAQ and breadcrumb structured data itself.
"""
import html
import json
import os
import re
from urllib.parse import quote

SITE = 'https://www.oneplustwo.co.uk'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICK = ('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#036B45" stroke-width="2.5" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>')


def esc(v):
    return html.escape(v, quote=True)


def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()


def write(p, c):
    full = os.path.join(ROOT, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(c)


def shell(template, title, desc, canonical):
    hs, me = template.index('<main id="main">'), template.index('</main>') + len('</main>')
    head, foot = template[:hs], template[me:]
    head = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', head, flags=re.S)
    for attr in ('name="description"', 'property="og:description"'):
        head = re.sub(rf'<meta {attr} content="[^"]*">', f'<meta {attr} content="{esc(desc)}">', head)
    head = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{esc(title)}">', head)
    head = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{canonical}">', head)
    head = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{canonical}">', head)
    head = re.sub(r'<script type="application/ld\+json"[^>]*>.*?</script>\n?', '', head, flags=re.S)
    return head, foot


def page(template, d, all_models):
    canonical = f'{SITE}/hardware/{d["slug"]}'
    head, foot = shell(template, d['title'], d['description'], canonical)
    first = d['images'][0]
    buttons = ''
    if len(d['images']) > 1:
        buttons = '<div class="variant-switch" role="group" aria-label="' + esc(d['name']) + ' views">' + ''.join(
            f'<button type="button" class="variant-btn" data-src="{esc(src)}" data-alt="{esc(alt)}" aria-pressed="{"true" if i == 0 else "false"}">{esc(label)}</button>'
            for i, (label, src, alt) in enumerate(d['images'])) + '</div>'
    shop_url = d['shop']
    features = '<ul class="ticklist">' + ''.join(f'<li>{TICK}<span>{esc(f)}</span></li>' for f in d['features']) + '</ul>'
    kit = ''
    if d.get('kit_includes'):
        kit = ('<div class="card"><h3>In the complete till kit</h3><ul class="ticklist">'
               + ''.join(f'<li>{TICK}<span>{esc(i)}</span></li>' for i in [d['name']] + d['kit_includes'])
               + '</ul><p class="small">Also available as the system on its own. Software is billed separately.</p></div>')
    faqs = d['faqs'] + [
        [f'Does the {d["name"]} work with OnePlusTwo?', f'Yes. We supply the {d["name"]} set up and ready to use with OnePlusTwo, and we make sure it works with the rest of your hardware from day one.'],
        ['How quickly is it delivered?', 'Orders placed online come with next day delivery by courier. Delivery is a flat £9.95, or £19.95 if your order includes a self-service kiosk.'],
    ]
    faq_html = ''.join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faqs)
    others = [m for m in all_models if m['slug'] != d['slug']]
    more = ''.join(f'<a class="pill" href="/hardware/{m["slug"]}">{esc(m["name"])}</a>' for m in others)
    schema = [
        {'@context': 'https://schema.org', '@type': 'Product', 'name': d['name'], 'description': d['lead'],
         'brand': {'@type': 'Brand', 'name': d['brand']}, 'image': SITE + first[1], 'url': canonical,
         'category': d['category']},
        {'@context': 'https://schema.org', '@type': 'FAQPage', 'url': canonical, 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faqs]},
        {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Hardware', 'item': SITE + '/hardware'},
            {'@type': 'ListItem', 'position': 3, 'name': d['name'], 'item': canonical}]},
    ]
    head = head.replace('</head>', ''.join(
        f'<script type="application/ld+json" data-schema="hardware-{i}">{json.dumps(s, ensure_ascii=False, separators=(",", ":"))}</script>\n'
        for i, s in enumerate(schema)) + '</head>', 1)
    main = f'''<main id="main">
<section class="hero"><div class="container grid grid-2">
<div class="stack"><a class="breadcrumb" href="/hardware">Hardware</a><span class="label">{esc(d["kind"])}</span><h1 class="h1--page">{esc(d["h1"])}</h1><p class="lead">{esc(d["lead"])}</p><div class="btn-row"><a class="btn btn--primary " href="{esc(shop_url)}">Order now</a><a class="btn btn--outline " href="/book-a-demo">Book a demo</a></div><p class="small">{esc(d["warranty"])}</p></div>
<div class="hw-visual" data-variants><div class="till-img till-img--lg"><img src="{esc(first[1])}" alt="{esc(first[2])}" loading="eager"></div>{buttons}</div>
</div></section>
<section class="section section--mint"><div class="container grid grid-2 grid--top">
<div class="stack"><h2 class="h2--sm">Key features</h2>{features}</div>
<div class="stack">{kit}<div class="card"><h3>Best for</h3><p>{esc(d["best_for"])}</p></div></div>
</div></section>
<section class="section"><div class="container grid grid-3 grid--top grid--wide-gap">
<div class="stack"><h2 class="h2--sm">{esc(d["name"])} questions</h2><p>Anything else you'd like to know? Book a call and we'll talk it through.</p><div><a class="btn btn--outline " href="/book-a-demo">Book a call</a></div></div>
<div class="faq span-2">{faq_html}</div></div></section>
<section class="section section--flush-top"><div class="container stack stack--sm"><h2 class="h2--sm">Other hardware we stock</h2><div class="jump-links">{more}<a class="pill" href="/hardware">All hardware</a></div></div></section>
<section class="section section--flush-top" style="padding-top: var(--section);">
  <div class="container">
    <div class="cta-band">
      <div class="stack stack--sm"><h2>Not sure which till is right for you?</h2><p>Book a free demo and we'll recommend the right setup for your venue. No jargon, no pressure.</p></div>
      <a class="btn btn--dark btn--lg" href="/book-a-demo">Book a demo</a>
    </div>
  </div>
</section>
</main>'''
    return head + main + foot


def main():
    models = json.loads(read('content/hardware.json'))
    template = read('hardware.html')
    slugs = []
    for d in models:
        write(f'hardware/{d["slug"]}.html', page(template, d, models))
        slugs.append(d['slug'])
    sitemap = read('sitemap.xml')
    sitemap = re.sub(r'\s*<url><loc>https://www\.oneplustwo\.co\.uk/hardware/[^<]*</loc>.*?</url>', '', sitemap)
    sitemap = sitemap.replace('</urlset>', ''.join(
        f'  <url><loc>{SITE}/hardware/{s}</loc><lastmod>{models[0].get("updated", "2026-11-12")}</lastmod><priority>0.6</priority></url>\n' for s in slugs) + '</urlset>')
    write('sitemap.xml', sitemap)
    print('Built hardware pages:', ', '.join(slugs))


if __name__ == '__main__':
    main()
