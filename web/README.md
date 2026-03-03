## Setup
Create `web/.env` with:
```bash
VITE_GOOGLE_CLIENT_ID="..."
VITE_GOOGLE_API_KEY="..."
VITE_GOOGLE_APP_ID=""
```

For GitHub Pages: set `base` in `vite.config.ts` to `/<REPO_NAME>/`.

Run:
```bash
npm i
npm run dev
```

Build:
```bash
npm run build
```
Publish `dist/` to GitHub Pages.
