# Contributing to EditPDF

Thanks for taking the time to contribute. This document explains how to get set up and what a
good change looks like here.

## Ground rule: nothing leaves the browser

EditPDF's whole premise is that documents never reach a server. **A change that introduces a
network call for document data will not be merged**, however convenient it is. Fonts, models and
assets ship with the bundle for the same reason.

## Getting started

```bash
git clone https://github.com/romizone/sejda-lookalike.git
cd sejda-lookalike
npm install
npm run dev
```

## Project layout

| Path | What lives there |
|---|---|
| `src/components/` | Application shell — toolbar, workspace, page view, panels |
| `src/components/tools/` | One module per tool family |
| `src/lib/` | PDF, OCR, docx and zip helpers |
| `src/tools.jsx` | The tool registry — name, description, category, icon |
| `public/fonts/` | Bundled metric-compatible faces |

## Adding a tool

1. Create the panel in `src/components/tools/`.
2. Register it in `src/tools.jsx` with a name, description and category.
3. Put shared PDF work in `src/lib/` rather than in the component.
4. Prefer a **structural** edit through pdf-lib; fall back to the rendered canvas only when the
   operation genuinely cannot be expressed structurally, and say so in a comment.

## Pull requests

- One logical change per pull request.
- Run `npm run build` before pushing; it must succeed.
- Test with a real PDF, and ideally with an awkward one — a scan, a rotated page, an encrypted
  file, a document with form fields.
- Describe the trade-off if your change makes one. Honest limitations are documented here, not
  hidden.

## Reporting bugs

Open an issue with the browser and version, the steps, what you expected, and what happened.
**Never attach a confidential PDF** — reproduce it with a document you are happy to share
publicly.
