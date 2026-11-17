#!/usr/bin/env python3
"""Rebuild the structured data (JSON-LD) that helps Google and AI search tools read the site.

Run from the repository root after changing FAQs, plan prices or shop products:

    python3 tools/build-structured-data.py

It reads what is visible on each page, so the structured data always matches the page:
- FAQPage: every root page with an FAQ list (<div class="faq ..."> of <details>).
- Pricing (pricing.html): the monthly plans and the POS and kiosk bundle.
- Shop (shop.html): each product card and its options, with prices before VAT.
- Breadcrumbs: every root page whose <main> has a breadcrumb link (Home > section > page).
- WebSite on the homepage, and the glossary terms (DefinedTermSet) on glossary.html.

Each block is written just before </head> as <script type="application/ld+json" data-schema="...">
and is replaced in place on later runs. No dependencies beyond Python 3.
"""
import glob
import html
import json
import os
import re

SITE = 'https://www.oneplustwo.co.uk'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def text(fragment):
    """Visible text of an HTML fragment, on one line."""
    fragment = re.sub(r'<[^>]+>', ' ', fragment)
    return re.sub(r'\s+', ' ', html.unescape(fragment)).strip()


def put_block(page, name, data):
    """Insert or replace one JSON-LD block in the page's <head>. Returns the new page."""
    tag = f'<script type="application/ld+json" data-schema="{name}">'
    pattern = re.compile(re.escape(tag) + r'.*?</script>\n?', re.S)
    page = pattern.sub('', page)
    if data is None:
        return page
    block = tag + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '</script>\n'
    return page.replace('</head>', block + '</head>', 1)


def faq_schema(page, slug):
    main = page[page.find('<main'):page.find('</main>')]
    pairs = re.findall(r'<details[^>]*>\s*<summary[^>]*>(.*?)</summary>(.*?)</details>', main, re.S)
    hidden_faq = re.search(r'<section[^>]*\bhidden\b[^>]*>(?:(?!</section>).)*class="faq', main, re.S)
    if not pairs or hidden_faq:
        return None
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'url': f'{SITE}/{slug}' if slug != 'index' else f'{SITE}/',
        'mainEntity': [
            {'@type': 'Question', 'name': text(q),
             'acceptedAnswer': {'@type': 'Answer', 'text': text(a)}}
            for q, a in pairs
        ],
    }


def gbp(pence):
    return f'{int(pence) / 100:.2f}'


def price_spec(amount, monthly=False):
    spec = {'@type': 'UnitPriceSpecification' if monthly else 'PriceSpecification',
            'price': amount, 'priceCurrency': 'GBP', 'valueAddedTaxIncluded': False}
    if monthly:
        spec.update({'unitCode': 'MON', 'unitText': 'per month', 'referenceQuantity': {
            '@type': 'QuantitativeValue', 'value': 1, 'unitCode': 'MON'}})
    return spec


def pricing_schema(page):
    offers = []
    for block in re.findall(r'<article class="plan[^"]*">(.*?)</article>', page, re.S):
        name = text(re.search(r'<h2>(.*?)</h2>', block, re.S).group(1))
        amount = re.search(r'plan-amount">£([\d.,]+)<', block).group(1).replace(',', '')
        desc = text(re.search(r'</h2>\s*<p>(.*?)</p>', block, re.S).group(1))
        features = [text(f) for f in re.findall(r'<li>(.*?)</li>', block, re.S)]
        offers.append({'@type': 'Offer', 'name': f'{name} plan', 'description': desc + ' Includes: ' + ', '.join(features) + '.',
                       'price': amount, 'priceCurrency': 'GBP', 'url': f'{SITE}/pricing',
                       'priceSpecification': price_spec(amount, monthly=True)})
    bundle = re.search(r'id="kiosk-bundle">(.*?)</div></div>', page, re.S)
    if bundle:
        amount = re.search(r'plan-amount">£([\d.,]+)<', bundle.group(1)).group(1)
        desc = ' '.join(text(p) for p in re.findall(r'<p[^>]*>(.*?)</p>', bundle.group(1), re.S))
        offers.append({'@type': 'Offer', 'name': 'POS and kiosk bundle (software licences only)', 'description': desc,
                       'price': amount, 'priceCurrency': 'GBP', 'url': f'{SITE}/pricing#kiosk-bundle',
                       'priceSpecification': price_spec(amount, monthly=True)})
    if not offers:
        return None
    return {
        '@context': 'https://schema.org',
        '@type': 'Service',
        'serviceType': 'Point of sale (EPOS) software',
        'provider': {'@type': 'Organization', 'name': 'OnePlusTwo', 'url': SITE + '/'},
        'name': 'OnePlusTwo POS software',
        'description': 'Cloud-based point of sale (EPOS) software for hospitality and retail businesses in the UK. Prices are per month and exclude VAT. Hardware is a separate one-off cost.',
        'areaServed': 'GB',
        'url': f'{SITE}/pricing',
        'offers': offers,
    }


def attr(tag, name):
    m = re.search(name + r"""=(['"])(.*?)\1""", tag, re.S)
    return html.unescape(m.group(2)) if m else None


BRANDS = ['Sunmi', 'iMin', 'Honor', 'Artech', 'PAX', 'Zebra']
DELIVERY, DELIVERY_KIOSK = '9.95', '19.95'


def brand_for(*texts):
    """The one manufacturer named in the option's text, or None when none or several are named."""
    found = {b for b in BRANDS for t in texts if t and re.search(r'\b' + b + r'\b', t, re.I)}
    return found.pop() if len(found) == 1 else None


def shipping(amount):
    """Next day courier delivery in the UK at a flat rate (see the terms of sale)."""
    day = lambda lo, hi: {'@type': 'QuantitativeValue', 'minValue': lo, 'maxValue': hi, 'unitCode': 'DAY'}
    return {'@type': 'OfferShippingDetails',
            'shippingRate': {'@type': 'MonetaryAmount', 'value': amount, 'currency': 'GBP'},
            'shippingDestination': {'@type': 'DefinedRegion', 'addressCountry': 'GB'},
            'deliveryTime': {'@type': 'ShippingDeliveryTime', 'handlingTime': day(0, 1), 'transitTime': day(1, 1)}}


def shop_schema(page):
    """One Product per shop option (each model is its own product, with its own brand, image and price)."""
    products = []
    for card in re.findall(r'(<article class="shop-card".*?</article>)', page, re.S):
        head = card[:card.index('>') + 1]
        pid, name = attr(head, 'data-product'), attr(head, 'data-name')
        img_tag = re.search(r'<img[^>]*data-shop-img[^>]*>', card) or re.search(r'<img[^>]*>', card)
        card_image = attr(img_tag.group(0), 'src') if img_tag else None
        desc_m = re.search(r'</h3>\s*<p>(.*?)</p>', card, re.S)
        card_desc = text(desc_m.group(1)) if desc_m else ''
        rate = DELIVERY_KIOSK if pid.startswith('kiosk') else DELIVERY
        options = re.findall(r'<option ([^>]*)>(.*?)</option>', card, re.S) or [('', name)]
        for opt, label in options:
            value = attr(opt, 'value') if opt else None
            amount = gbp((attr(opt, 'data-price') if opt else None) or attr(head, 'data-price'))
            opt_desc = attr(opt, 'data-desc') if opt else None
            image = (attr(opt, 'data-img') if opt else None) or card_image
            title = f'{name}: {value.replace("Desktop POS: ", "")}' if value else name
            url = (f'{SITE}/shop?product={pid}&option={value}#product-{pid}' if value else f'{SITE}/shop#product-{pid}').replace(' ', '%20')
            product = {'@type': 'Product', 'name': title, 'description': ' '.join(x for x in (card_desc, opt_desc) if x),
                       'url': url, 'offers': {
                           '@type': 'Offer', 'price': amount, 'priceCurrency': 'GBP', 'url': url,
                           'priceSpecification': price_spec(amount),
                           'availability': 'https://schema.org/InStock',
                           'itemCondition': 'https://schema.org/NewCondition',
                           'shippingDetails': shipping(rate),
                           'seller': {'@type': 'Organization', 'name': 'OnePlusTwo'}}}
            brand = brand_for(value, opt_desc, name if not value else None)
            if brand:
                product['brand'] = {'@type': 'Brand', 'name': brand}
            if image:
                product['image'] = SITE + image if image.startswith('/') else image
            products.append(product)
    if not products:
        return None
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'name': 'OnePlusTwo POS hardware',
        'description': 'POS hardware sold online by OnePlusTwo. Prices exclude VAT and do not include software.',
        'url': f'{SITE}/shop',
        'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'item': p} for i, p in enumerate(products)],
    }


def breadcrumb_schema(page, slug):
    main = page[page.find('<main'):page.find('</main>')]
    crumb = re.search(r'<a class="breadcrumb" href="(/[^"]*)">(.*?)</a>', main, re.S)
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', main, re.S)
    if not crumb or not h1:
        return None
    title = re.search(r'<title>(.*?)</title>', page, re.S)
    name = text(title.group(1)).split(' | ')[0] if title else text(h1.group(1))
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': text(crumb.group(2)), 'item': SITE + crumb.group(1)},
        {'@type': 'ListItem', 'position': 3, 'name': name, 'item': f'{SITE}/{slug}'}]}


def website_schema():
    return {'@context': 'https://schema.org', '@type': 'WebSite', 'name': 'OnePlusTwo', 'url': SITE + '/',
            'inLanguage': 'en-GB', 'publisher': {'@type': 'Organization', 'name': 'OnePlusTwo', 'url': SITE + '/'}}


def glossary_schema(page):
    items = re.findall(r'<div class="glossary-item" id="([^"]+)"><dt>(.*?)</dt><dd>(.*?)<a class="text-link"', page, re.S)
    if not items:
        return None
    return {'@context': 'https://schema.org', '@type': 'DefinedTermSet', 'name': 'EPOS and POS glossary',
            'url': f'{SITE}/glossary', 'hasDefinedTerm': [
                {'@type': 'DefinedTerm', 'name': text(n), 'description': text(d), 'url': f'{SITE}/glossary#{i}'}
                for i, n, d in items]}


def main():
    changed = []
    for path in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
        slug = os.path.basename(path)[:-5]
        with open(path, encoding='utf-8') as f:
            page = f.read()
        new = put_block(page, 'faq', faq_schema(page, slug))
        new = put_block(new, 'breadcrumb', breadcrumb_schema(new, slug))
        if slug == 'index':
            new = put_block(new, 'website', website_schema())
        if slug == 'glossary':
            new = put_block(new, 'glossary', glossary_schema(new))
        if slug == 'pricing':
            new = put_block(new, 'pricing', pricing_schema(new))
        if slug == 'shop':
            new = put_block(new, 'products', shop_schema(new))
        if new != page:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
            changed.append(os.path.basename(path))
    print('Updated:', ', '.join(changed) if changed else 'nothing')


if __name__ == '__main__':
    main()
