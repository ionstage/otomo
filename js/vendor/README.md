# Third-party code

Kept as plain files, with no package manager and no build step. See section 7
of `docs/design.md`.

| File | Source | Version | Licence |
|---|---|---|---|
| `jsQR.js` | `dist/jsQR.js` from the npm package `jsqr`, https://github.com/cozmo/jsQR | 1.4.0, unchanged | Apache-2.0, `jsQR-LICENSE` |
| `qrcodegen.js` | `typescript-javascript/qrcodegen.ts` from https://github.com/nayuki/QR-Code-generator | tag v1.8.0, converted once to JavaScript (see the note at the top of the file) | MIT, `qrcodegen-LICENSE` |

`jsQR.js` is a UMD bundle, not an ES module. Loaded with a classic `<script>`,
it sets `window.jsQR`. `qrcodegen.js` is an ES module exporting `QrCode` and
`QrSegment`.
