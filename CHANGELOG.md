# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-23

First public release. Forty-one PDF tools running entirely in the browser.

### Added

- **Editing** — edit existing PDF text in place using the document's own font; whiteout, images,
  shapes, links, fill & sign, form creation, watermark, page numbers, header & footer, Bates
  numbering and stamps.
- **Organising** — merge, alternate & mix, split by range, in half, by size, by text and by
  bookmarks, extract, delete, reorder, rotate, crop, resize, N-up and flip.
- **Converting** — PDF to Word, Excel, PowerPoint, text and JPG; JPG to PDF; image extraction.
- **Protecting** — password protection with granular permissions, unlock, flatten, annotation
  removal, and redaction that rasterises marked pages so content is destroyed rather than covered.
- **Repairing** — compression by real image downscaling, greyscale, in-browser Tesseract OCR,
  file repair, bookmark creation and metadata editing.
- Bundled metric-compatible fonts so rewritten text preserves the original line width.
- Static build deployable to any host; GitHub Pages workflow included.

### Security

- No upload endpoint, no backend and no telemetry. Document data never leaves the browser tab.

[1.0.0]: https://github.com/romizone/sejda-lookalike/releases/tag/v1.0.0
