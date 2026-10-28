# Back office (oneplustwo.co.uk/admin)

The back office lets OnePlusTwo staff:
- edit the website's pages, photos and layout
- manage voucher codes for the hardware shop
- update the system status page

Staff sign in with their **work Microsoft 365 or Google Workspace account**. Nobody else can get in.

This guide covers the one-off setup (about 30 minutes) and how the back office works.

---

## How it works

- `/admin` is part of the main website. `middleware.js` checks every visit to `/admin` and `/api/admin`. Anyone who isn't signed in is sent to `/admin/login`.
- Signing in goes to Microsoft or Google. After that, the site checks three things:
  - the person has an @oneplustwo.co.uk account,
  - they're on the staff list (`ADMIN_USERS`),
  - for Microsoft, that the account belongs to your organisation.

  If all three pass, they get a session cookie that lasts 12 hours.
- **Publishing saves the change to GitHub as one commit.** Vercel then republishes the site, which takes about a minute. Every publish is a version you can see in GitHub, so nothing is lost.
- **Page edits wait as drafts** in that person's browser until they press Publish. Voucher codes and system status save as soon as you press Save or Publish status.
- If two people change the same page, the second person to publish is warned instead of overwriting the first person's work.

Files involved:

| File | What it does |
|---|---|
| `middleware.js` | Locks `/admin` and `/api/admin` to signed-in staff |
| `api/auth/[action].js` | Sign in, sign out (Microsoft or Google) |
| `api/admin/[action].js` | Reading and saving files, uploads, voucher codes, history |
| `api/_lib/*.js` | Shared code: sessions and roles, GitHub, voucher encryption |
| `admin/` | The back office pages (`index.html`, `login.html`, `admin.js`, `admin.css`) |
| `assets/data/vouchers.json` | Voucher codes as the shop sees them (scrambled) |

---

## Setup

### 0. Check two things in Vercel first

1. **Plan.** Vercel's free Hobby plan is for non-commercial use only. A business site should be on **Pro**.
2. **Production branch.** In Vercel, open the project, then **Settings → Git**, and note the **Production Branch** (for example `main`). You'll enter it as `GITHUB_BRANCH` in step 4. The back office saves to that branch, so changes go live.

### 1a. If you use Microsoft 365

1. Go to https://entra.microsoft.com and sign in as an admin.
2. Open **Applications → App registrations → New registration**.
   - Name: `OnePlusTwo back office`
   - Supported account types: **Accounts in this organizational directory only (Single tenant)**
   - Redirect URI: platform **Web**, address `https://www.oneplustwo.co.uk/api/auth/callback`
   - Click **Register**.
3. On the overview page, copy:
   - **Application (client) ID**. This becomes `AUTH_CLIENT_ID`.
   - **Directory (tenant) ID**. This becomes `AUTH_TENANT_ID`.
4. Open **Certificates & secrets → New client secret**.
   - Description: `website`
   - Expires: 24 months
   - Copy the **Value** straight away; you can't see it again. This becomes `AUTH_CLIENT_SECRET`.
   - Put a reminder in your calendar to make a new one before it expires.
5. Optional: open **Token configuration → Add optional claim → ID → email**. The back office works without this, because it falls back to the account's sign-in name.

### 1b. If you use Google Workspace

1. Go to https://console.cloud.google.com and create a project called `OnePlusTwo back office`.
2. Open **APIs & Services → OAuth consent screen**.
   - User type: **Internal**. This limits sign-in to your Google Workspace.
   - App name: `OnePlusTwo back office`
   - Support email: yours
   - Save.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorised redirect URIs: `https://www.oneplustwo.co.uk/api/auth/callback`
   - Click **Create**.
4. Copy:
   - **Client ID**. This becomes `AUTH_CLIENT_ID`.
   - **Client secret**. This becomes `AUTH_CLIENT_SECRET`.

### 2. Make a GitHub token so the back office can save

1. On GitHub, open your picture, then **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Name: `OnePlusTwo back office`
   - Expiration: 1 year. Set a calendar reminder to renew it.
   - Repository access: **Only select repositories → OnePlusTwo-webiste-v1**
   - Permissions: **Repository permissions → Contents → Read and write**
2. Generate it and copy the token. This becomes `GITHUB_TOKEN`.

### 3. Make two long random secrets

You need two different secrets, each at least 32 characters. A password manager's "generate password" (48 characters, letters and numbers) is fine. On a Mac or Linux you can also run `openssl rand -base64 48` twice.

- One becomes `SESSION_SECRET`. It signs the sign-in cookie.
- The other becomes `VOUCHER_SECRET`. It scrambles voucher codes so only staff can read them.

**Keep `VOUCHER_SECRET` the same forever.** If it changes, the shop still accepts existing codes, but the back office can't show what they are any more.

### 4. Add the settings to Vercel

In Vercel, open the project, then **Settings → Environment Variables**. Add these for **Production**:

| Name | Value |
|---|---|
| `AUTH_PROVIDER` | `microsoft` or `google` |
| `AUTH_CLIENT_ID` | from step 1 |
| `AUTH_CLIENT_SECRET` | from step 1 |
| `AUTH_TENANT_ID` | from step 1a (Microsoft only) |
| `AUTH_DOMAIN` | `oneplustwo.co.uk` |
| `SITE_URL` | `https://www.oneplustwo.co.uk` |
| `ADMIN_USERS` | `faris.a@oneplustwo.co.uk=owner` (add more people with commas, see below) |
| `SESSION_SECRET` | from step 3 |
| `VOUCHER_SECRET` | from step 3 |
| `GITHUB_TOKEN` | from step 2 |
| `GITHUB_REPO` | `Faris-OPT/OnePlusTwo-webiste-v1` |
| `GITHUB_BRANCH` | the production branch from step 0 |

Then go to **Deployments**, open the three dots on the latest deployment and choose **Redeploy**. Settings only apply after a redeploy.

### 5. Try it

1. Visit https://www.oneplustwo.co.uk/admin. You should see the sign-in page.
2. Click **Sign in with Microsoft** (or Google) and use your work account.
3. On the dashboard, check there's no yellow "Setup not finished" box.
4. Make a small test edit, publish it, and check it appears on the site about a minute later.

---

## Staff and roles

`ADMIN_USERS` lists who can sign in, separated by commas:

```
faris.a@oneplustwo.co.uk=owner, sales@oneplustwo.co.uk=editor, accounts@oneplustwo.co.uk=shop, support@oneplustwo.co.uk=support
```

| | Owner | Editor | Shop manager (`shop`) | Support |
|---|:-:|:-:|:-:|:-:|
| Edit pages, text, images and layout | ✓ | ✓ | | |
| Prices and details (find and replace) | ✓ | ✓ | | |
| Voucher codes | ✓ | | ✓ | |
| System status | ✓ | ✓ | | ✓ |

To add or remove someone, edit `ADMIN_USERS` in Vercel and redeploy. Removing someone stops them at their next click. When a person leaves, also turn off their work account, which locks them out everywhere.

---

## What each section does

- **Pages and layout.** Shows a live preview of the page:
  - Click any text to change it.
  - Click a photo to swap it or describe it.
  - Click a button or link to change where it goes.
  - On the left, move sections up and down, hide or show them, switch the background between plain and mint, remove them, or add new ones.
  - **Search and sharing** edits the Google title and description.

  Only the main content changes; the header, footer and scripts are never touched.
- **Images.** Upload JPG, PNG, WebP or GIF photos. Big photos are shrunk automatically. SVG files can't be uploaded, for security. An image can only be deleted when no page uses it.
- **Prices and details.** Finds a price, phone number or any wording across every page. You tick which matches to replace.
- **Voucher codes.** You can:
  - create, edit, pause and delete codes,
  - choose percentage or amount off,
  - set start and end dates (UK time) and a minimum spend before VAT.

  Codes go live about a minute after saving.
- **System status.** Change each service's status, report and update incidents, mark them fixed, and schedule maintenance. Press **Publish status** to go live. This replaces editing `status.json` by hand (STATUS-GUIDE.md still works too).
- **Publish history.** Every published version, with a link to it on GitHub.

## Limits to know about

- The header menu and footer appear on every page and can't be edited in the back office yet. Ask your developer.
- Prices the shop basket actually charges live in the shop page's code (`SHOP_ITEMS`). Find and replace changes the wording on pages, not what the basket charges.
- Voucher codes have no "number of uses" limit. The shop checks codes in the customer's browser, so it can't count uses.
- Sign-in only works on the address registered in step 1 (`www.oneplustwo.co.uk`). It won't work on Vercel preview links unless you add those addresses to the app registration and set `SITE_URL` to match.
- The repository is public, so anything saved there can be seen. That's why voucher codes are stored scrambled and every secret lives only in Vercel.
