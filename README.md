# PSLE English Tutor

A Vite + React workspace for reviewing PSLE English practice material as page images, rendered markdown, and visual snippets. The app is built around a document library, image carousel, markdown preview, visual snapshot review mode, and a snip tool for inserting selected image regions into markdown notes.

## Features

- Browse converted PSLE English PDF pages by folder and document.
- Search papers from the document library.
- View page images with thumbnail navigation and previous/next controls.
- Open matching markdown content beside the page image.
- Review markdown files that appear to reference visuals such as diagrams, photos, charts, maps, posters, or images.
- Select visual regions from a page image and insert them into the matching markdown file.
- Save markdown and snip edits through Vite dev-server endpoints.

## Tech Stack

- React 19
- Vite 8
- Lucide React icons
- React Markdown with GFM and raw HTML support
- Python conversion script using Poppler tools

## Prerequisites

- Node.js and npm
- Python 3
- Poppler command-line tools available on `PATH`:
  - `pdfinfo`
  - `pdftoppm`

## Setup

Install dependencies:

```powershell
npm install
```

Create a local environment file from the example:

```powershell
Copy-Item .env.example .env
```

The app supports these environment variables:

```env
VITE_ASSET_BASE_URL=https://psle-tutor.sgp1.digitaloceanspaces.com
PSLE_ENG_TUTOR_SESSION_SECRET=change_me_to_at_least_32_random_bytes
PSLE_ENG_TUTOR_TOOL_ID=psle-eng-tutor-brain
PORT=8080
HOST=0.0.0.0
```

When `VITE_ASSET_BASE_URL` is set, image and markdown assets are loaded from that base URL. When it is not set, the app loads assets from the same origin as the Vite app.

`PSLE_ENG_TUTOR_SESSION_SECRET` enables 2ndBrain launch auth for production. Use the same value in 2ndBrain.ceo so it can sign short-lived marketplace launch tokens. Keep this value server-side only.

## Development

Start the dev server:

```powershell
npm run dev
```

The dev server binds to `0.0.0.0`, so Vite will print both local and network URLs.

Build for production:

```powershell
npm run build
```

Preview the production build:

```powershell
npm run preview
```

Run the protected production server locally:

```powershell
npm run build
$env:PSLE_ENG_TUTOR_SESSION_SECRET="use-at-least-32-random-bytes-here"
npm start
```

## Content Workflow

Place source PDFs under a `material/` folder, then convert them to page images:

```powershell
python scripts/pdf_to_images.py --material material --output converted-images
```

The conversion script:

- Recursively finds PDFs under `material/`.
- Renders each page as a JPG by default.
- Preserves the PDF folder structure under `converted-images/`.
- Writes `converted-images/manifest.json`, which the React app uses to build the document library.

Useful options:

```powershell
python scripts/pdf_to_images.py --overwrite
python scripts/pdf_to_images.py --format png
python scripts/pdf_to_images.py --dpi 180 --jpeg-quality 92
python scripts/pdf_to_images.py --dry-run
python scripts/pdf_to_images.py --limit-pdfs 1 --limit-pages 5
```

## Markdown And Snips

Markdown files are expected under `markdown/`, mirroring the converted image paths. For example:

```text
converted-images/Book/Practice 1/page-0001.jpg
markdown/Book/Practice 1/page-0001.md
```

In development, `vite.config.js` adds local endpoints for authoring:

- `GET /markdown-manifest.json` scans markdown files that contain visual references.
- `POST /api/markdown` saves markdown edits.
- `POST /api/snips` saves selected image regions into `snips/` and inserts the image embed into markdown.

During production builds, local `markdown/` and `snips/` folders are copied into `dist/` when present, and a production `markdown-manifest.json` is generated.

## Project Structure

```text
.
├── index.html
├── package.json
├── scripts/
│   └── pdf_to_images.py
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── vite.config.js
└── psle-english-visual-term-report.md
```

Generated and local-only folders such as `node_modules/`, `dist/`, `converted-images/`, `snips/`, and `material/` should be handled according to your deployment and storage workflow. Local secrets belong in `.env`; commit shareable defaults in `.env.example`.

## Deployment Notes

For a static-only deployment without launch auth, run:

```powershell
npm run build
```

Deploy the contents of `dist/`. If assets are hosted separately, set `VITE_ASSET_BASE_URL` before building so the app points at the hosted `converted-images/manifest.json`, markdown files, and snip assets.

For 2ndBrain Marketplace deployment, use the included `Dockerfile` and `railway.json`. The container builds the Vite app and starts `server.js`, which verifies 2ndBrain launch tokens before serving the app.

Required production variables:

```env
PSLE_ENG_TUTOR_SESSION_SECRET=use-the-same-secret-configured-in-2ndbrain
PSLE_ENG_TUTOR_TOOL_ID=psle-eng-tutor-brain
VITE_ASSET_BASE_URL=https://psle-tutor.sgp1.digitaloceanspaces.com
```

Railway supplies `PORT`; the server binds to `0.0.0.0` by default.

## 2ndBrain Launch Auth

When `PSLE_ENG_TUTOR_SESSION_SECRET` is set, every request except `/healthz` requires a valid launch session. Users should enter through a 2ndBrain-generated URL:

```text
https://psle-tutor.example.com/?launch_token=...
```

The token is an HS256 JWT signed with `PSLE_ENG_TUTOR_SESSION_SECRET`.

Expected payload:

```json
{
  "user_id": "supabase-user-id",
  "install_id": "marketplace-install-id",
  "tool_id": "psle-eng-tutor-brain",
  "email": "user@example.com",
  "exp": 1779400300
}
```

Required claims:

- `user_id`
- `tool_id`, matching `PSLE_ENG_TUTOR_TOOL_ID`
- `exp`, as Unix seconds

Optional claims:

- `install_id`
- `email`

After verification, the server stores a signed HTTP-only session cookie and redirects to the same URL without the token query parameter.
