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

The app supports this environment variable:

```env
VITE_ASSET_BASE_URL=https://psle-tutor.sgp1.digitaloceanspaces.com
```

When `VITE_ASSET_BASE_URL` is set, image and markdown assets are loaded from that base URL. When it is not set, the app loads assets from the same origin as the Vite app.

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

For a static deployment, run:

```powershell
npm run build
```

Deploy the contents of `dist/`. If assets are hosted separately, set `VITE_ASSET_BASE_URL` before building so the app points at the hosted `converted-images/manifest.json`, markdown files, and snip assets.
