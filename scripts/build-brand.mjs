/**
 * Generates the brand assets from a single source of truth.
 *
 * The mark lives inline in the page so it can follow the theme, but that version uses CSS
 * variables and cannot be rasterised on its own. This rebuilds the same geometry with literal
 * colours, writes standalone SVGs, and renders PNGs from them - so the exported files can never
 * drift from what the site shows.
 *
 *   node scripts/build-brand.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = "brand";

const INK_LIGHT = "#2b3238";
const INK_DARK = "#e8e5df";
const RUST = "#c2521c";
const RUST_DARK = "#e5793d";
const PAPER = "#f3f1ed";
const NIGHT = "#14181b";

/** The mark, drawn once. Colours are parameters so every variant is the same geometry. */
function mark({ ink, rust }) {
  return `
  <mask id="dcut">
    <rect x="340" y="175" width="575" height="850" fill="#fff"/>
    <circle cx="605" cy="645" r="140" fill="#000"/>
    <line x1="757" y1="170" x2="500" y2="1040" stroke="#000" stroke-width="52"/>
  </mask>
  <g mask="url(#dcut)" fill="${ink}">
    <circle cx="605" cy="645" r="250"/>
    <path d="M765 268 L895 200 L895 700 L765 700 Z"/>
  </g>
  <g stroke="${rust}" stroke-width="24" stroke-linecap="butt">
    <line x1="737" y1="262" x2="667" y2="500"/>
    <line x1="580" y1="792" x2="518" y2="1002"/>
  </g>`;
}

/**
 * Square canvas with the mark centred and generous padding.
 *
 * Padding matters for avatars: X and most platforms crop a profile picture to a circle, and a
 * mark drawn to the edges loses its corners. The glyph sits inside ~72% of the frame so the
 * circular crop never touches it.
 */
function squareSvg({ ink, rust, bg }) {
  const S = 1024;
  const inner = 740;
  const off = (S - inner) / 2;
  // Source viewBox is 575x850; scale to fit the inner box by its taller axis.
  const scale = inner / 850;
  const w = 575 * scale;
  const x = off + (inner - w) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  ${bg ? `<rect width="${S}" height="${S}" fill="${bg}"/>` : ""}
  <g transform="translate(${x.toFixed(1)} ${off}) scale(${scale.toFixed(5)}) translate(-340 -175)">
    ${mark({ ink, rust })}
  </g>
</svg>`;
}

/** Horizontal lockup: mark plus wordmark, for headers and README banners. */
function lockupSvg({ ink, rust, bg }) {
  const W = 1600, H = 480;
  const inner = 340;
  const scale = inner / 850;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : ""}
  <g transform="translate(300 70) scale(${scale.toFixed(5)}) translate(-340 -175)">
    ${mark({ ink, rust })}
  </g>
  <text x="620" y="284" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
        font-size="190" font-weight="700" letter-spacing="-6" fill="${ink}">Drift<tspan fill="${rust}">-d</tspan></text>
</svg>`;
}

await mkdir(OUT, { recursive: true });

const variants = [
  ["mark-light", squareSvg({ ink: INK_LIGHT, rust: RUST, bg: PAPER })],
  ["mark-dark", squareSvg({ ink: INK_DARK, rust: RUST_DARK, bg: NIGHT })],
  ["mark-transparent", squareSvg({ ink: INK_LIGHT, rust: RUST, bg: null })],
  ["lockup-light", lockupSvg({ ink: INK_LIGHT, rust: RUST, bg: PAPER })],
  ["lockup-dark", lockupSvg({ ink: INK_DARK, rust: RUST_DARK, bg: NIGHT })],
  ["lockup-transparent", lockupSvg({ ink: INK_LIGHT, rust: RUST, bg: null })],
];

/** Avatar-friendly sizes plus favicon sizes. */
const SIZES = [1024, 512, 256, 128, 64, 32];

for (const [name, svg] of variants) {
  const svgPath = `${OUT}/drift-d-${name}.svg`;
  await writeFile(svgPath, svg, "utf8");

  const isSquare = name.startsWith("mark");
  const sizes = isSquare ? SIZES : [1600, 800, 400];

  for (const size of sizes) {
    const png = `${OUT}/drift-d-${name}-${size}.png`;
    const img = sharp(Buffer.from(svg));
    await (isSquare ? img.resize(size, size) : img.resize(size)).png({ compressionLevel: 9 }).toFile(png);
  }
  console.log(`${name.padEnd(20)} svg + ${sizes.length} png`);
}

console.log(`\nWritten to ${OUT}/`);
