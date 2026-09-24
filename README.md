# OnePlusTwo website

The OnePlusTwo website, built as plain HTML and hosted on Vercel. Any change committed to this repository goes live automatically within about a minute.

## What's where

| File or folder | What it is |
|---|---|
| `index.html` | Homepage |
| `who-we-serve.html`, `restaurants.html`, `cafes.html`, `takeaways.html`, `events-and-festivals.html`, `retail.html` | Sector pages |
| `products.html` | Products overview |
| `self-service-kiosks.html`, `point-of-sale.html`, `integrated-payments.html`, `kitchen-display-screens.html`, `collection-display-screens.html`, `online-ordering.html` | Individual product pages |
| `software.html`, `hardware.html`, `pricing.html`, `integrations.html` | Software, hardware, pricing and integrations |
| `customers.html`, `why-us.html`, `blog.html` | Company pages (Why us? includes the scrolling timeline) |
| `book-a-demo.html` | Calendly booking calendar and enquiry form |
| `privacy-policy.html`, `404.html` | Privacy policy and "page not found" page |
| `assets/css/styles.css` | All colours, fonts and layout (colours are at the top, under `:root`) |
| `assets/js/main.js` | Mobile menu, enquiry form and blog filter |
| `assets/img/` | Logos, icons and the social sharing image. Put new photos here. |
| `assets/img/partners/` | Payment, delivery and accounting partner logos |
| `sitemap.xml`, `robots.txt` | Help Google find every page |
| `vercel.json` | Clean page addresses, redirects and security settings |

Page addresses drop the `.html`, so `pricing.html` is live at `/pricing`.

## Making common changes

**Editing text.** Open the page's file in GitHub, click the pencil icon, find the text (Ctrl + F helps), change it, and click **Commit changes**. The header and footer are repeated in every page file, so a change there (such as a new phone number) needs making in each file.

**Filling in placeholders.** Anything in `[square brackets]` is placeholder text. Search for `[` to find them.

**Adding photos.** Photo spots currently show brand illustrations. Each one is a `<div class="photo photo--illus ..." data-photo="...">` whose `data-photo` text describes the photo meant to go there (search for `data-photo` to find them). Upload the photo to `assets/img/` (ideally a JPG under 300 KB, around 1600px wide). Then replace the whole div, for example:

```html
<div class="photo photo--illus photo--tall" data-photo="the OnePlusTwo team"><img src="/assets/img/illustrations/team.svg" alt="" width="400" height="300" loading="lazy"></div>
```

with:

```html
<img class="photo-img" src="/assets/img/team.jpg" alt="The OnePlusTwo team in the office" width="1200" height="1440" loading="lazy">
```

Always describe the photo in `alt`. It helps visitors using screen readers and your Google rankings.

**Changing page titles and descriptions (SEO).** These are in the `<title>` and `<meta name="description">` lines near the top of each page file, and repeated in the `og:title` and `og:description` lines used for social sharing.

**Adding a new page.** Copy an existing page file, rename it, change its content, title, description and `canonical` link, then add its address to `sitemap.xml`.

**Redirecting old page addresses.** Add entries to the `redirects` list in `vercel.json`, for example:

```json
{ "source": "/old-page", "destination": "/pricing", "permanent": true }
```

**After changing `styles.css` or `main.js`.** Each page loads them as `styles.css?v=6` and `main.js?v=6`. Increase that number in every page (for example to `v=7`) so visitors' browsers fetch the new version straight away.

## Connected services

- **Enquiry form:** Formspree (form ID `xrpbkykb`). Enquiries arrive by email.
- **Demo bookings:** Calendly, embedded on the Book a demo page.
- **Analytics:** Vercel Web Analytics. Switch it on in the Vercel dashboard under the project's **Analytics** tab.
- **Fonts:** Bricolage Grotesque and Figtree, stored in `assets/fonts/` (no Google Fonts connection needed).
