# SLS Lighting Inspections (Local-first) — v3

Static React + Vite app hosted on GitHub Pages.

**Master map** is stored once per site under `Data/`:
- `layers.json`
- `assets.json`
- `zones.json`

**Each inspection** creates its own folder under the site's master folder:
- `Inspections/<Inspection Label>/results.json`
- `Inspections/<Inspection Label>/photos/`
- `Inspections/<Inspection Label>/report.pdf`
- `Inspections/<Inspection Label>/report.xlsx`

v3 adds:
- Inspection list (loads existing inspection folders under `Inspections/`)
- Start New Inspection (creates a new folder under `Inspections/`)
- Open Inspection (loads overlay `results.json`)
- Inventory is locked while in Inspection mode (to protect the master map)

Setup: see `web/README.md` inside web folder.


## GitHub-only deployment (no local CLI)

This repo includes a GitHub Actions workflow that builds and deploys automatically on every push to `main`.

### Required repo secrets
In GitHub: **Settings → Secrets and variables → Actions → New repository secret**

- `VITE_GOOGLE_CLIENT_ID` = your OAuth Client ID
- `VITE_GOOGLE_API_KEY` = your API key
- `VITE_GOOGLE_APP_ID` = optional (can be blank)

### Enable Pages
GitHub: **Settings → Pages**
- Source: **GitHub Actions**

Then push to `main`. The workflow will publish the site at:
`https://<username>.github.io/<repo>/`
