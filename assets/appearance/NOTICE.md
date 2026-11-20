# Bloub animated avatar engine

This plugin contains a locally bundled, framework-free adaptation of the Bloub
SVG animation engine. It is pinned to the following upstream revision so the
distributed implementation never changes at runtime:

- Source: [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub)
- Revision: `b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`
- Copyright: Copyright (c) 2026 Jérémy Perret
- Code license: MIT

The complete upstream license is included beside this notice as
`LICENSE-bloub.txt`. The plugin does not embed the Bloub website, contact the
upstream service, or claim affiliation with x.ai. 物迹账本 supplies its own
random schedule, three-colour theme mapping, compact SVG renderer and Obsidian
lifecycle integration.

# Smiley Sans sticker-label font

Sticker-detail labels use a locally bundled copy of 得意黑 / Smiley Sans so the
display remains distinctive and works offline without contacting a font CDN.

- Source: [atelier-anchor/smiley-sans](https://github.com/atelier-anchor/smiley-sans)
- Release: `v2.0.1`
- Revision: `67e3821f4b06cbd7155fa6fa69daff4b6f311b76`
- Font file: `SmileySans-Oblique.ttf.woff2`
- License: SIL Open Font License 1.1

The complete upstream font license is included beside this notice as
`LICENSE-smiley-sans.txt`. The font is limited to the floating sticker labels;
the rest of the ledger continues to use Obsidian's interface font.
