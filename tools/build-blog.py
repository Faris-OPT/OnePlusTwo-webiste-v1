#!/usr/bin/env python3
"""Build the blog from the Markdown files in content/blog/.

Run from the repository root after adding or changing an article:

    python3 tools/build-blog.py

Each article is a Markdown file with a header block like this:

    ---
    title: How much does an EPOS system cost in the UK?
    slug: epos-system-cost-uk           (the address: /blog/epos-system-cost-uk)
    date: 2026-11-05                    (YYYY-MM-DD)
    category: tips                      (tips, updates, stories or news)
    image: /assets/img/illustrations/till.svg
    image_alt: Touchscreen till on a counter
    description: One sentence for Google and social sharing.
    summary: One or two sentences shown on the blog listing.
    answer: A direct 40 to 60 word answer, shown in the "Quick answer" box.
    draft: true                         (optional: leaves the article unpublished)
    featured: true                      (optional: shows it first, as the large card on /blog)
    seo_title: Shorter title           (optional: used in the browser tab and Google when the title is long)
    related: /takeaways, /caller-id     (optional: root pages that show this article in a "From the blog" section)
    ---

The body supports ## headings, ### headings, paragraphs, - bullet lists, 1. numbered
lists, **bold** and [links](/page).

The script writes blog/<slug>.html for every article, rebuilds the listing inside
<main> of blog.html, and updates the blog entries in sitemap.xml and llms.txt.
No dependencies beyond Python 3.
"""
import datetime
import glob
import html
import json
import os
import re

SITE = 'https://www.oneplustwo.co.uk'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTHOR = 'Admin'
WORDS_PER_MINUTE = 220
CATEGORIES = {
    'tips': 'Tips for venues',
    'updates': 'Product updates',
    'stories': 'Customer stories',
    'news': 'Company news',
}


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def write(path, content):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(content)


def esc(value):
    return html.escape(value, quote=True)


# ---------- Markdown ----------

def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)

    def link(m):
        label, url = m.group(1), m.group(2)
        external = url.startswith('http') and 'oneplustwo.co.uk' not in url
        extra = ' target="_blank" rel="noopener"' if external else ''
        return f'<a href="{esc(url)}"{extra}>{label}</a>'
    return re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, text)


def markdown(body):
    out, para, items, kind = [], [], [], None

    def flush():
        nonlocal para, items, kind
        if para:
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            para = []
        if items:
            out.append(f'<{kind}>' + ''.join(f'<li>{inline(i)}</li>' for i in items) + f'</{kind}>')
            items, kind = [], None

    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            flush()
        elif stripped.startswith('### '):
            flush()
            out.append('<h3>' + inline(stripped[4:]) + '</h3>')
        elif stripped.startswith('## '):
            flush()
            out.append('<h2>' + inline(stripped[3:]) + '</h2>')
        elif re.match(r'^[-*] ', stripped):
            if para:
                flush()
            if kind not in (None, 'ul'):
                flush()
            kind = 'ul'
            items.append(stripped[2:])
        elif re.match(r'^\d+\. ', stripped):
            if para:
                flush()
            if kind not in (None, 'ol'):
                flush()
            kind = 'ol'
            items.append(re.sub(r'^\d+\. ', '', stripped))
        else:
            if items:
                flush()
            para.append(stripped)
    flush()
    return '\n'.join(out)


def parse(path):
    raw = read(path)
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', raw, re.S)
    if not m:
        raise SystemExit(f'{path}: missing the --- header block')
    meta = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            key, value = line.split(':', 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                value = value[1:-1]
            meta[key.strip()] = value
    for key in ('title', 'slug', 'date', 'category', 'description', 'summary', 'answer', 'image'):
        if not meta.get(key):
            raise SystemExit(f'{path}: "{key}" is missing')
    if meta['category'] not in CATEGORIES:
        raise SystemExit(f'{path}: category must be one of {", ".join(CATEGORIES)}')
    meta['date_obj'] = datetime.date.fromisoformat(meta['date'])
    meta['body_md'] = m.group(2)
    words = len(re.findall(r'\w+', m.group(2) + ' ' + meta['answer']))
    meta['minutes'] = max(1, round(words / WORDS_PER_MINUTE))
    meta['url'] = f'/blog/{meta["slug"]}'
    return meta


def nice_date(d):
    return f'{d.day} {d.strftime("%B %Y")}'


def image_html(post, extra=''):
    src, alt = post['image'], esc(post.get('image_alt', ''))
    if src.endswith('.svg') and '/illustrations/' in src:
        return f'<div class="photo photo--illus {extra}"><img src="{esc(src)}" alt="" width="400" height="300" loading="lazy"></div>'
    return f'<div class="photo-frame {extra}"><img class="photo-img" src="{esc(src)}" alt="{alt}" loading="lazy"></div>'


# ---------- Pages ----------

def page_shell(template, title, description, canonical, og_type='website', extra_head=''):
    head_end = template.index('<main id="main">')
    main_end = template.index('</main>') + len('</main>')
    before, after = template[:head_end], template[main_end:]
    before = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', before, flags=re.S)
    before = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{esc(description)}">', before)
    before = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{canonical}">', before)
    before = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{esc(title)}">', before)
    before = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{esc(description)}">', before)
    before = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{canonical}">', before)
    before = re.sub(r'<meta property="og:type" content="[^"]*">', f'<meta property="og:type" content="{og_type}">', before)
    before = re.sub(r'<script type="application/ld\+json"[^>]*>.*?</script>\n?', '', before, flags=re.S)
    before = re.sub(r' aria-current="page"', '', before)
    before = mark_blog_current(before)
    if extra_head:
        before = before.replace('</head>', extra_head + '</head>', 1)
    return before, after


def mark_blog_current(page):
    """Underline Blog in the header menu only (never the footer link)."""
    end = page.find('</header>')
    if end == -1:
        return page
    head = page[:end].replace('<li><a href="/blog">Blog</a></li>', '<li><a href="/blog" aria-current="page">Blog</a></li>', 1)
    return head + page[end:]


def card(post):
    label = CATEGORIES[post['category']]
    return (f'<article class="post" data-category="{post["category"]}"><a class="post-link" href="{post["url"]}">'
            f'{image_html(post)}<span class="label">{label}</span><h3>{esc(post["title"])}</h3>'
            f'<p>{esc(post["summary"])}</p>'
            f'<span class="small post-meta">{nice_date(post["date_obj"])} · {post["minutes"]} min read</span></a></article>')


def article_page(template, post, others):
    canonical = SITE + post['url']
    image_abs = SITE + post['image']
    schema = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        'headline': post['title'],
        'description': post['description'],
        'datePublished': post['date'],
        'dateModified': post.get('updated', post['date']),
        'author': {'@type': 'Person', 'name': AUTHOR},
        'publisher': {'@type': 'Organization', 'name': 'OnePlusTwo', 'logo': {'@type': 'ImageObject', 'url': SITE + '/assets/img/logo-dark.png'}},
        'mainEntityOfPage': canonical,
        'image': image_abs,
        'articleSection': CATEGORIES[post['category']],
        'abstract': post['answer'],
    }
    head = f'<meta property="article:published_time" content="{post["date"]}">\n<script type="application/ld+json" data-schema="article">{json.dumps(schema, ensure_ascii=False, separators=(",", ":"))}</script>\n'
    before, after = page_shell(template, f'{post.get("seo_title") or post["title"]} | OnePlusTwo', post['description'], canonical, 'article', head)
    more = ''
    if others:
        more = ('<section class="section section--mint"><div class="container stack stack--lg"><div class="section-head"><h2 class="h2--sm">More from the blog</h2>'
                '<a class="text-link" href="/blog">See all articles</a></div><div class="grid grid-3 grid--top" style="gap: 40px 32px;">'
                + ''.join(card(o) for o in others[:3]) + '</div></div></section>\n')
    main = f'''<main id="main">
<section class="page-head article-head"><div class="container"><div class="stack article-intro"><a class="breadcrumb" href="/blog">Blog</a><span class="label">{CATEGORIES[post["category"]]}</span><h1 class="h1--page">{esc(post["title"])}</h1><p class="article-meta">By {AUTHOR} · <time datetime="{post["date"]}">{nice_date(post["date_obj"])}</time> · {post["minutes"]} min read</p></div></div></section>
<section class="section section--flush-top"><div class="container"><div class="article-wrap">
{image_html(post, "article-hero")}
<aside class="quick-answer"><span class="label">Quick answer</span><p>{esc(post["answer"])}</p></aside>
<div class="article-body">
{markdown(post["body_md"])}
</div>
</div></div></section>
{more}<section class="section section--flush-top" style="padding-top: var(--section);">
  <div class="container">
    <div class="cta-band">
      <div class="stack stack--sm"><h2>See OnePlusTwo working in your venue</h2><p>Book a free demo and we'll show you the setup we'd recommend. No obligation.</p></div>
      <a class="btn btn--dark btn--lg" href="/book-a-demo">Book a demo</a>
    </div>
  </div>
</section>
</main>'''
    return before + main + after


def listing_main(posts):
    used = [c for c in CATEGORIES if any(p['category'] == c for p in posts)]
    buttons = '<button type="button" class="pill" data-filter="all" aria-pressed="true">All</button>' + ''.join(
        f'<button type="button" class="pill" data-filter="{c}" aria-pressed="false">{CATEGORIES[c]}</button>' for c in used)
    featured, rest = posts[0], posts[1:]
    feat = (f'<article class="featured-post grid grid-2" data-category="{featured["category"]}">'
            f'<a class="featured-link" href="{featured["url"]}" aria-label="{esc(featured["title"])}">{image_html(featured)}</a>'
            f'<div class="stack stack--sm"><span class="label">{CATEGORIES[featured["category"]]}</span>'
            f'<h2 class="h2--sm"><a class="post-title-link" href="{featured["url"]}">{esc(featured["title"])}</a></h2>'
            f'<p>{esc(featured["summary"])}</p><span class="small post-meta">{nice_date(featured["date_obj"])} · {featured["minutes"]} min read</span>'
            f'<div><a class="btn btn--primary " href="{featured["url"]}">Read the article</a></div></div></article>')
    grid = ''
    if rest:
        grid = ('<section class="section section--flush-top"><div class="container"><div class="grid grid-3 grid--top" style="gap: 40px 32px;">\n'
                + '\n'.join(card(p) for p in rest) + '\n</div></div></section>\n')
    return f'''<main id="main">
<section class="page-head">
  <div class="container"><div class="stack"><h1 class="h1--page">News and tips</h1><p class="lead">Product updates, company news and practical advice for running a busier, smoother venue.</p><div class="jump-links" role="group" aria-label="Filter articles by category">{buttons}</div></div></div>
</section><section class="section section--flush-top"><div class="container">
{feat}
</div></section>
{grid}</main>'''


def update_sitemap(posts):
    sitemap = read('sitemap.xml')
    sitemap = re.sub(r'\s*<url><loc>https://www\.oneplustwo\.co\.uk/blog[^<]*</loc>.*?</url>', '', sitemap)
    newest = max(p['date'] for p in posts)
    entries = f'  <url><loc>{SITE}/blog</loc><lastmod>{newest}</lastmod><priority>0.7</priority></url>\n' + ''.join(
        f'  <url><loc>{SITE}{p["url"]}</loc><lastmod>{p.get("updated", p["date"])}</lastmod><priority>0.6</priority></url>\n' for p in posts)
    sitemap = sitemap.replace('</urlset>', entries + '</urlset>')
    write('sitemap.xml', sitemap)


def update_llms(posts):
    text = read('llms.txt')
    block = '## Blog\n\n' + ''.join(f'- [{p["title"]}]({SITE}{p["url"]}): {p["answer"]}\n' for p in posts)
    start, end = '<!-- blog:start -->', '<!-- blog:end -->'
    section = f'{start}\n{block}{end}\n'
    if start in text:
        text = re.sub(re.escape(start) + r'.*?' + re.escape(end) + r'\n?', section, text, flags=re.S)
    else:
        text = text.rstrip('\n') + '\n\n' + section
    write('llms.txt', text)


def update_related_pages(posts):
    """Add or refresh a "From the blog" section on each root page an article lists under related:."""
    by_page = {}
    for p in posts:
        for path in [x.strip() for x in p.get('related', '').split(',') if x.strip()]:
            by_page.setdefault(path.strip('/'), []).append(p)
    pattern = re.compile(r'<section class="[^"]*" data-blog-links>.*?</section>\n?', re.S)
    for full in glob.glob(os.path.join(ROOT, '*.html')):
        slug = os.path.basename(full)[:-5]
        if slug == 'blog':
            continue
        page = read(os.path.basename(full))
        new = pattern.sub('', page)
        items = by_page.get(slug)
        if items:
            block = ('<section class="section" data-blog-links><div class="container stack stack--lg"><div class="section-head">'
                     '<h2 class="h2--sm">From the blog</h2><a class="text-link" href="/blog">See all articles</a></div>'
                     '<div class="grid grid-3 grid--top" style="gap: 40px 32px;">' + ''.join(card(p) for p in items[:3]) + '</div></div></section>\n')
            main_start, main_end = new.index('<main id="main">'), new.index('</main>')
            last = new.rfind('<section', main_start, main_end)
            new = new[:last] + block + new[last:]
        if new != page:
            write(os.path.basename(full), new)


def main():
    posts = [parse(os.path.relpath(p, ROOT)) for p in glob.glob(os.path.join(ROOT, 'content', 'blog', '*.md'))]
    posts = [p for p in posts if p.get('draft', '').lower() != 'true']
    if not posts:
        raise SystemExit('No published articles in content/blog/')
    posts.sort(key=lambda p: (p.get('featured', '').lower() == 'true', p['date'], p['title']), reverse=True)
    slugs = [p['slug'] for p in posts]
    if len(slugs) != len(set(slugs)):
        raise SystemExit('Two articles share the same slug')

    template = read('blog.html')
    for old in glob.glob(os.path.join(ROOT, 'blog', '*.html')):
        if os.path.basename(old)[:-5] not in slugs:
            os.remove(old)
    for post in posts:
        others = [p for p in posts if p is not post]
        write(f'blog/{post["slug"]}.html', article_page(template, post, others))

    start, end = template.index('<main id="main">'), template.index('</main>') + len('</main>')
    listing = template[:start] + listing_main(posts) + template[end:]
    listing = mark_blog_current(listing.replace(' aria-current="page"', ''))
    write('blog.html', listing)
    update_sitemap(posts)
    update_llms(posts)
    update_related_pages(posts)
    print(f'Built {len(posts)} articles:', ', '.join(slugs))


if __name__ == '__main__':
    main()
