# Stocks Web Viewer

A static, read-only viewer that runs on **GitHub Pages** and shows the latest stocks
from your desktop app — fetched live from Google Drive every 30 seconds.

```
Desktop app  ──(publish stocks.json)──▶  Google Drive  ──(public file API)──▶  GitHub Pages viewer
```

No backend, no database, no server. Just three static files (`index.html`, `viewer.js`,
`styles.css`) plus a `config.json` you'll create from `config.example.json`.

---

## How the live update works

1. The desktop app generates a public-safe stocks snapshot (item name, brand,
   SKU, qty, price, low-stock flag — **no cost prices, no suppliers, no customers**).
2. It uploads that snapshot to a single file on Google Drive (`localbiz-stocks.json`),
   marked as **"anyone with the link can view"**.
3. The viewer here polls Drive for that file every 30 seconds (configurable).
4. When admin changes inventory in the desktop app, the file is republished
   automatically (with an 8-second debounce). Viewers see the change within
   ~40 seconds without refreshing.

## What this is NOT

- It is **not** real-time bidirectional. The web viewer is read-only.
- It has **no per-user access control** — anyone with the page URL sees the data.
  This is the trade-off for "GitHub Pages only" hosting (no backend = no auth).
  If you later need access levels, see the "Adding access tiers" section at the
  bottom of this file.

---

## One-time setup

### Step 1 — Connect Google Drive in the desktop app

1. Open the desktop app, go to **Settings → Google Drive Backup Integration**.
2. Paste your Google **Client ID** (and optionally Client Secret) from a Google
   Cloud project that has the **Drive API enabled**.
3. Click **Connect Google Drive** → **Complete Connection** and authorize on your
   Google account.

### Step 2 — Publish stocks for the first time

1. In the desktop app, scroll to **Publish Stocks to Web Viewer**.
2. Click **Publish Stocks Now**.
3. Copy the **Drive File ID** that appears.
4. (Optional but recommended) Tick **Auto-publish on inventory changes** so the
   file gets refreshed automatically whenever you edit inventory.

### Step 3 — Create a Google API key (read-only)

The viewer fetches the file via the Drive REST API. That requires a public API key.

1. Go to https://console.cloud.google.com/apis/credentials in the same Google
   project you used for the desktop app.
2. **Create credentials → API key**. Copy it.
3. **Restrict the key** (highly recommended):
   - **Application restrictions → HTTP referrers** → add your GitHub Pages domain,
     e.g. `https://YOUR_USERNAME.github.io/*`
   - If you use a custom domain like `https://example.com/your-app/`, allow the
     site origin (for example `https://example.com/*`) rather than just the
     subpath. Browsers often send only the origin as the cross-site referrer.
   - **API restrictions → Restrict key → Google Drive API**
4. The key only ever reads files that are explicitly shared as "anyone with link",
   so even if leaked it cannot access anything else in your Drive.

### Step 4 — Configure the viewer

1. Copy `config.example.json` to `config.json`:
   ```bash
   cp web/config.example.json web/config.json
   ```
2. Edit `config.json`:
   ```json
   {
     "googleDriveFileId": "1AbcDef…paste from desktop app…",
     "googleApiKey": "AIzaSy…paste your API key…",
     "pollIntervalSeconds": 30
   }
   ```

### Step 5 — Deploy to GitHub Pages

The repo already includes a workflow at
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml).
It injects `config.json` from GitHub Secrets at deploy time so the API key
never sits in the repo.

1. **Add the repo secrets**: GitHub repo → **Settings → Secrets and variables →
   Actions → New repository secret**, then add:
   - `STOCKS_DRIVE_FILE_ID` — the File ID copied from the desktop app Settings
   - `STOCKS_GOOGLE_API_KEY` — the restricted API key from Step 3
   - (Optional) Variable `STOCKS_POLL_SECONDS` (e.g. `30`)

2. **Enable Pages**: GitHub repo → **Settings → Pages → Build and deployment →
   Source = GitHub Actions**.

3. **Push to `main`**. The workflow runs whenever anything in `web/` changes
   (or you trigger it manually). The viewer will be live at
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

> **Important:** the API key will be visible to anyone who loads the viewer page
> (it always is on a static site). That's why you **must** restrict it to your
> Pages domain in Step 3 — that turns "anyone can use this key" into "only
> requests originating from your Pages URL succeed."

**For local testing without GitHub Pages**, copy `config.example.json` to
`config.json` and serve the `web/` folder over any local web server (e.g.
`python3 -m http.server` from inside `web/`).

---

## What gets published — and what doesn't

The desktop app builds the snapshot in
[`electron/src/services/googleDriveService.ts`](../electron/src/services/googleDriveService.ts)
inside `buildStocksSnapshot()`. It includes per-item:

- `name`, `brand`, `category`, `sku`
- `quantityInStock`, `reorderLevel`
- `sellingPrice` (the effective selling price after item-level discount)
- `isLowStock`, `inStock` flags
- `updatedAt`

It explicitly excludes: cost price, profit margin, supplier name/ID, internal
notes, customers, jobs, invoices, estimates.

To change what's exposed, edit `buildStocksSnapshot()` and republish.

---

## Operations

- **Refresh on demand** in the viewer: click the **Refresh** button in the top right.
- **Republish from desktop**: Settings → **Refresh Web Stocks Now**.
- **Stop sharing**: Settings → **Unpublish (revoke public access)**. This removes
  the "anyone with link" permission from the Drive file. Anyone holding the URL
  will start getting 403/404 within minutes.
- **Drive API quota**: 1 billion requests/day per project. With 50 viewers polling
  every 30s that's ~144,000 requests/day — well under the limit.

---

## Troubleshooting

**Viewer says "Config error":** `config.json` is missing or doesn't have
`googleDriveFileId` + `googleApiKey`. See Step 4.

**Viewer says "Drive fetch failed (403)":** the API key is restricted to a
referrer that doesn't match the page URL, or the file isn't shared as "anyone
with link". In the desktop app, click **Refresh Web Stocks Now** — this
re-applies the public permission.

**Viewer says just "Failed to fetch" or "Network fetch failed before Drive responded":**
the browser likely blocked the request before Google Drive returned a JSON error.
Most commonly this means the API key allows the wrong HTTP referrer. For custom
domains, allow the origin like `https://example.com/*`, not only
`https://example.com/your-app/*`.

**Viewer says "Drive fetch failed (404)":** the file was deleted from Drive, or
the File ID in `config.json` doesn't match the one shown in the desktop app
Settings page.

**Viewer says "Stocks file is malformed":** the file in Drive is empty or wasn't
written by the desktop app. Click **Refresh Web Stocks Now** to overwrite it.

**Updates seem slow:** check the desktop app — is **Auto-publish on inventory
changes** enabled? If not, you must click **Refresh Web Stocks Now** manually
after each change.

---

## Adding access tiers (future)

If you later need different views for different audiences (e.g. retail vs
wholesale prices), the cleanest path on a static site is **encrypted tiers**:

1. Desktop app encrypts each tier's slice of the JSON with a different
   admin-set password (Web Crypto AES-GCM).
2. Publishes a single bundle with `{ tier1: ciphertext, tier2: ciphertext, … }`.
3. Viewer prompts for a password, decrypts the tier the user has.

This still has no real revocation (anyone who learns a password keeps it forever
until you re-publish with a new key), so for true RBAC you'd need a backend
(e.g. Supabase). Ask before building this — it's a meaningful chunk of work.
