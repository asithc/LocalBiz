# Local Inventory, Jobs, Estimation & Invoicing App (LocalBiz Desk)

A local-first Electron desktop application for a small Sri Lankan electrician/CCTV business.

## Tech Stack

- Electron
- React + TypeScript
- Vite
- SQLite (`better-sqlite3`)
- Tailwind CSS
- Zustand
- React Router
- ExcelJS (Excel export)
- Electron `printToPDF` for printable PDFs
- electron-builder (Windows packaging)

## Core Features

- Local login/authentication (`Admin`, `Staff`) with hashed passwords
- Basic security hardening:
  - Failed-login lockout protection
  - Strong password enforcement on password changes
  - Admin-only settings and backup/restore actions
  - Electron navigation/window-open restrictions and sandboxed renderer
- Inventory management with stock movement history and low-stock indicator
- Inventory item image upload and preview support
- Customer management
- Estimates/quotations with discount handling and conversion to jobs
- Jobs/work orders with staff assignment and stock allocation
- Invoice generation from completed jobs with payment tracking
- Staff + simple salary records
- Dashboard metrics and recent activity
- Export to XLSX/CSV for inventory, customers, estimates, jobs, invoices, staff
- PDF generation for estimate, job sheet, and invoice
- Direct print for estimate, job sheet, and invoice
- Email-ready templates opened in default mail client
- Settings (business profile, notes, SMTP fields, logo path, backup/restore)
- Optional Google Drive backup integration (admin-only)
- Full offline operation using local SQLite

## Project Structure

```
.
├─ electron/
│  └─ src/
│     ├─ db/
│     ├─ ipc/
│     ├─ services/
│     └─ main.ts / preload.ts
├─ src/
│  ├─ shared/
│  │  └─ types.ts
│  └─ renderer/
│     ├─ components/
│     ├─ layouts/
│     ├─ pages/
│     ├─ store/
│     ├─ lib/
│     └─ utils/
├─ index.html
├─ package.json
└─ README.md
```

## Default Admin Credentials

- Username: `admin`
- Password: `admin123`

## Demo Seed Data

On first run, the app seeds:

- 1 admin user + 2 sample staff login users
- 5 inventory items
- 3 customers
- 2 staff records
- 1 sample estimate
- 1 sample job
- 1 sample invoice

## Install Dependencies

Use Node.js LTS 20.x (recommended for `better-sqlite3` prebuilt binaries).

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

This starts:

- Vite renderer on `http://localhost:5173`
- Electron main/preload TypeScript watch build
- Electron desktop shell

## Build for Production

```bash
npm run build
```

## Build Windows Installer

```bash
npm run dist
```

Installer output is generated under:

- `release/`

## Local Database Location

The app stores SQLite in Electron `userData` path:

- Windows (typical): `%APPDATA%\LocalBiz Desk\localbiz.sqlite`
- macOS (typical): `~/Library/Application Support/LocalBiz Desk/localbiz.sqlite`

## Backup and Restore

Use **Settings → Backup Database** and **Restore Database**.

- Backup copies current SQLite to a selected file path.
- Restore replaces current SQLite with a selected backup file.

### Google Drive Backup (Optional)

From **Settings → Google Drive Backup Integration**:

1. Enter Google OAuth Client ID (and optional secret)
2. Save settings
3. Click **Connect Google Drive**
4. Complete verification in browser using shown device code
5. Click **Complete Connection**
6. Click **Backup To Google Drive**

Notes:
- Scope used: `drive.file` (uploads app-created files)
- Optional folder ID can be set for target Drive folder

## Exports

Each main module page has export actions:

- `Export XLSX`
- `Export CSV`

Exports are saved via a file picker dialog.

XLSX exports include branded header styling and metadata.

## PDF Output

From Estimates, Jobs, and Invoices pages:

- Click `PDF` to generate a printable A4 PDF
- Click `Print` to open native print dialog directly from the app
- Includes business details, customer details, line items, totals in LKR, and notes

## Branding

- Jayakula Brothers brand assets are included in `public/branding/`
- App, estimate/invoice UI, and generated documents are themed with the provided logo and colors
- Supports optional sub-brand (`Wiring Malli`) name/logo in printable/exported documents

## Email Templates

From Estimates, Jobs, and Invoices pages:

- Click `Email` to open default mail client with prefilled subject/body
- User can manually attach exported PDFs

## Authentication Notes

- Passwords are hashed in local SQLite (bcrypt)
- Session is maintained in-memory for the local desktop runtime

## Business Rules Implemented

- Currency fixed to LKR
- Unique auto numbers for estimates/jobs/invoices
- Inventory cannot go negative
- Prevent over-allocation from stock
- Job can exist without estimate
- Approved estimate can be converted to job
- Invoice generation enforced from completed jobs
- Audit logs for major actions

## Packaging Notes (Windows First)

`electron-builder` config is in `package.json` under `build`:

- Target: NSIS
- Arch: x64
- One-click installer disabled
- Desktop shortcut enabled

## Known MVP Scope Notes

- SMTP direct-send fields are stored but direct SMTP send is not wired in this MVP.
- Force password change on first login is not enforced (schema support exists via `must_change_password`).
