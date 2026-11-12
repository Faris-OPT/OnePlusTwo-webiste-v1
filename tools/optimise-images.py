#!/usr/bin/env python3
"""Small page-speed fixes for every page. Safe to run again and again.

Run from the repository root, after the other build scripts:

    python3 tools/optimise-images.py

- Adds width and height to any <img> that lacks them (read from the image file), so the
  page doesn't jump about while images load.
- Adds loading="lazy" and decoding="async" to images below the first section of <main>,
  so off-screen images don't slow down the first view. Images in the header, the footer
  and the first section keep loading straight away.
Needs Python 3 with Pillow (pip install pillow).
"""
import glob
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sizes = {}


def size_of(src):
    if src in _sizes:
        return _sizes[src]
    path = os.path.join(ROOT, src.lstrip('/').split('?')[0])
    result = None
    if os.path.exists(path):
        if path.endswith('.svg'):
            with open(path, encoding='utf-8') as f:
                head = f.read(600)
            vb = re.search(r'viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"', head)
            if vb:
                result = (round(float(vb.group(1))), round(float(vb.group(2))))
        else:
            try:
                with Image.open(path) as im:
                    result = im.size
            except OSError:
                result = None
    _sizes[src] = result
    return result


def fix_tag(tag, lazy):
    src = re.search(r'src="([^"]+)"', tag)
    if not src:
        return tag
    new = tag
    if 'width=' not in new and 'height=' not in new:
        dims = size_of(src.group(1))
        if dims:
            new = new.replace('<img ', f'<img width="{dims[0]}" height="{dims[1]}" ', 1)
    if lazy and 'loading=' not in new:
        new = new.replace('<img ', '<img loading="lazy" ', 1)
    if lazy and 'decoding=' not in new:
        new = new.replace('<img ', '<img decoding="async" ', 1)
    return new


def fix_page(page):
    start = page.find('<main')
    end = page.find('</main>')
    if start == -1 or end == -1:
        return re.sub(r'<img [^>]*>', lambda m: fix_tag(m.group(0), False), page)
    first_section_end = page.find('</section>', start)
    if first_section_end == -1 or first_section_end > end:
        first_section_end = start
    parts = [
        (page[:first_section_end], False),
        (page[first_section_end:end], True),
        (page[end:], False),
    ]
    return ''.join(re.sub(r'<img [^>]*>', lambda m, lz=lz: fix_tag(m.group(0), lz), text) for text, lz in parts)


def main():
    changed = []
    for path in sorted(glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'blog', '*.html'))
                       + glob.glob(os.path.join(ROOT, 'hardware', '*.html'))):
        with open(path, encoding='utf-8') as f:
            page = f.read()
        new = fix_page(page)
        if new != page:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
            changed.append(os.path.relpath(path, ROOT))
    print(f'Updated {len(changed)} pages')


if __name__ == '__main__':
    main()
