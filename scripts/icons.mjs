// Renders the PWA icons in public/icons/ from public/favicon.svg. Run: npm run icons
// Needs rsvg-convert (librsvg; `brew install librsvg`). The PNGs are committed, so
// this runs only when the favicon design changes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const favicon = new URL('../public/favicon.svg', import.meta.url);
const out = (name) => new URL('../public/icons/' + name, import.meta.url);

// Maskable icons are cropped to a circle or a squircle by the launcher, so the
// mark is scaled into the central safe zone on a full-bleed black ground.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#000"/>
  <g transform="translate(32 32) scale(0.72) translate(-32 -32)">
    <polygon points="32,22 46,30 46,46 32,54 18,46 18,30" fill="none" stroke="#39c1ef" stroke-width="4"/>
    <polygon points="32,6 26,17 38,17" fill="#a8e6fa"/>
  </g>
</svg>
`;

function render(svg, size, name) {
  const png = execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size)], { input: svg });
  writeFileSync(out(name), png);
  console.log('public/icons/' + name, size + 'px', png.length + ' bytes');
}

const design = readFileSync(favicon);
render(design, 192, 'icon-192.png');
render(design, 512, 'icon-512.png');
render(design, 180, 'apple-touch-icon.png');
render(maskable, 512, 'maskable-512.png');
