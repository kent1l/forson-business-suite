# User Guide Generator

Builds the single-page, printable HTML user guide (`user-guide.html`) from every
`docs/manuals/*_manual.md` file, in the module grouping/order defined in `render.js`'s
`GROUPS`/`GROUP_ORDER`.

This is a **generated file** per STANDARDS.md's single-source-of-truth rule — never hand-edit
`user-guide.html` directly. Edit the module markdown files instead, then rebuild.

## Rebuild

```
cd docs/manuals/generated
npm install   # first time only
npm run build
```

Regenerates `user-guide.html` in place. Commit the result alongside whatever module manual you
changed.

## Adding a new module

1. Write the new manual under `docs/manuals/` following `STANDARDS.md` / `TEMPLATE.md`.
2. Add its filename to the appropriate group's `files` array in `render.js` (`GROUPS`) — new
   top-level areas need an entry in `GROUP_META`/`GROUP_ORDER` too.
3. Rebuild.

## What the build does

- `build.js` reads every manual, strips frontmatter/builder comments, converts `./x_manual.md`
  cross-links to in-page anchors, and renders each file's markdown to HTML via `marked` (custom
  renderers add heading anchors, wrap tables for horizontal scroll, and turn the `> 💡/📝/⚠️`
  callout convention and the `> **At a Glance**` block from STANDARDS.md/TEMPLATE.md into styled
  components instead of plain blockquotes).
- `render.js` assembles the single-page shell: sticky sidebar nav grouped by business area, a
  landing page of module cards, a client-side search box (headings + at-a-glance blurbs, no
  external calls), scroll-spy active-section highlighting, and a `@media print` stylesheet so the
  same file works as an on-screen guide and a print/PDF export.
