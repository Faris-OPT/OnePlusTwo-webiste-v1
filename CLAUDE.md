# OnePlusTwo website: notes for Claude

Read this before making any changes. It records decisions made while designing and building the site.

## The business

- OnePlusTwo sells cloud-based point of sale (EPOS) software and hardware across the whole UK.
- Main customers: hospitality (restaurants, cafes, takeaways, events and festivals). Retail is served too, but always shown second.
- Based at Business Innovation Centre, Binley, Coventry, CV3 2TX. Phone +44 24 7775 2650, email hello@oneplustwo.co.uk.
- Social: instagram.com/oneplustwoepos, facebook.com/oneplustwoepos, linkedin.com/company/oneplustwo, tiktok.com/@oneplustwoepos
- History: first restaurant in Coventry in 1998; started building its own POS in 2005; limited company in 2013; OnePlusTwo founded as a sister company in 2023; self-service kiosk app launched in 2024. "Nearly 20 years" in POS software.

## How the site works

- Plain HTML, CSS and JavaScript. No framework and no build step. Hosted on Vercel, which deploys automatically from GitHub.
- `vercel.json` sets clean URLs (`pricing.html` is served at `/pricing`) and redirects old Squarespace addresses. Add a redirect whenever a page is renamed or removed.
- All styling is in `assets/css/styles.css`. Colours and fonts are CSS variables in `:root`. Reuse existing classes rather than adding inline styles.
- Pages load `styles.css?v=N (currently 6)` and `main.js?v=N`. After changing either file, increase N in every HTML page so browsers pick up the new version.
- `assets/js/main.js` handles the mobile menu, the enquiry form, the blog filter, the option pickers and the Why us? timeline.
- The header and footer are copied into every HTML page. A change to either must be made in every page file.
- When adding a page: copy an existing page, update the `<title>`, meta description, `canonical` link and `og:` tags, add it to `sitemap.xml`, and link it from the header or footer if needed.
- Photo placeholders are `<div class="photo ...">Photo: ...</div>`. Replace them with `<img class="photo-img" ...>` with a descriptive `alt`, `width`, `height` and `loading="lazy"`.
- Anything in `[square brackets]` is placeholder text awaiting real content.

## Brand and design

- Colours: green `#04D98B` (buttons, highlights), dark green `#036B45` (links and text on light backgrounds, since the bright green is too pale for text), black `#161616`, off-white background `#FCFBF7`, mint section tint `#E4F8EE`.
- Buttons are pill-shaped: green with black text for primary actions, black outline for secondary.
- Fonts: Bricolage Grotesque for headings, Figtree for body text. Both are self-hosted in `assets/fonts/`.
- Logos: `assets/img/logo-dark.png` on light backgrounds, `logo-white.png` on dark ones.
- The design should stay warm, friendly and uncluttered.

## Tone of writing

- Warm, friendly, plain UK English. Short sentences, no jargon, no hype.
- Write for busy venue owners: lead with the benefit to them.
- Never copy text word for word from the old site or other sources; rewrite it in this tone.
- Sentence case for headings and buttons.

## Pricing (keep consistent everywhere)

- Plans, all per month + VAT: Starter £49, Essentials £79 (marked "Most popular"), Premium £109.
- Extra licences for existing customers: £19 a month + VAT each, for any additional till, kitchen display screen, collection screen or self-service kiosk.
- Self-service kiosk: £59 a month + VAT software (£19 if already on a plan), hardware from £649 + VAT one-off.
- All prices, including hardware, are shown + VAT.
- Every plan includes 7-day support.
- Enquiries are answered within 2 hours.
- Short-term options are available for one-off events and festivals.
- Complete till kit: £499 + VAT one-off (Sunmi or tablet terminal, 80mm printer, cash drawer, integrated card machine).
- Kitchen display screens: included in Essentials and Premium.
- Online ordering website: included in Essentials and Premium (branded site, collection, delivery, online payments, QR code table ordering, orders straight to till and kitchen).
- Collection display screens: £19 a month + VAT per screen. Customers supply their own TV or monitor.

## Do not put on the site

- Anything about contracts or contract length (there is a 12-month rolling contract, deliberately not mentioned).
- Set-up fees (one exists, deliberately not mentioned).
- Specific card processing rates. Say rates vary by payment provider.
- "No contracts", "free trial" or "commission-free" claims.
- The old site's "3 steps" hardware layout.

## Hidden for now

- The blog (`/blog` temporarily redirects to the homepage) and the team names, roles and photos on Why us? are hidden until content is ready.

## Products and partners

- Products: self-service kiosks, point of sale, integrated payments, kitchen display screens, collection display screens, online ordering website. Each has its own page, linked from `/products`.
- Hardware brands stocked: Sunmi, iMin (tills) and PAX (card terminals). Keep hardware at brand level, not specific models.
- Payment providers: Dojo, Viva.com, DNA Payments, Paynt.
- Delivery apps: Uber Eats, Deliveroo, Just Eat. Accounting: Xero.
- Partner logos are in `assets/img/partners/`.

## Connected services

- Enquiry form: Formspree, form ID `xrpbkykb`, on `/book-a-demo`.
- Demo bookings: Calendly, `https://calendly.com/hello-oneplustwo/oneplustwo-website-inquiry-demo`, embedded on `/book-a-demo`. Demos are 30 minutes.
- Analytics: Vercel Web Analytics.

## Before finishing any change

- Check the page on a narrow (phone) screen as well as desktop, with no sideways scrolling.
- Keep headings in order (one `h1` per page), links working, and images with `alt` text.
- Keep prices and claims consistent with the lists above.
