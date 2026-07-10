/**
 * Generates the watermark asset used by the build-time image service.
 *
 * Renders the "petrovisuals" wordmark in the site's brand font (Archivo) to a
 * transparent PNG at src/assets/images/watermark.png. The runtime image service
 * (src/imageService/watermark.ts) just scales + composites this PNG, so the build
 * itself has NO font dependency — this script is the only place fonts are needed.
 *
 * Re-run after changing the text/style:  pnpm run watermark   (or: node scripts/generate-watermark.mjs)
 *
 * Fonts: sharp's bundled fontconfig + freetype reads the Archivo .woff2 straight
 * from node_modules once we register it via a temporary fontconfig file. Env vars
 * MUST be set before sharp is imported, hence the dynamic import below.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---- Watermark text/style knobs -------------------------------------------
// One asset per entry; where each mark is placed is configured in
// src/imageService/watermark.ts (marks array).
const MARKS = [
	{ text: "petrovisuals.be", out: "src/assets/images/watermark-bottomright.png" },
	{ text: "petrovisuals", out: "src/assets/images/watermark-topcenter.png" },
];
const FONT_FAMILY = "Archivo"; // brand font (--font-logo-1)
const FONT_WEIGHT = 600;
const FONT_SIZE = 320; // render big; the service downscales per image
const FILL = "#ffffff";
const FILL_OPACITY = 0.4; // baked into the asset; re-run to change
const SHADOW_BLUR = 7; // soft dark halo -> legible on light AND dark photos
const SHADOW_OPACITY = 0.22; // kept roughly proportional to FILL_OPACITY

// ---- Register Archivo with sharp's fontconfig ------------------------------
const fontSrc = join(
	ROOT,
	"node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
);
const fcDir = mkdtempSync(join(tmpdir(), "petrovisuals-fc-"));
const fontDir = join(fcDir, "fonts");
const cacheDir = join(fcDir, "cache");
mkdirSync(fontDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
cpSync(fontSrc, join(fontDir, "archivo.woff2"));
const conf = join(fcDir, "fonts.conf");
writeFileSync(
	conf,
	`<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <cachedir>${cacheDir}</cachedir>
  <config></config>
</fontconfig>`,
);
process.env.FONTCONFIG_FILE = conf;
process.env.FONTCONFIG_PATH = fcDir;

// Import sharp only AFTER fontconfig env is set.
const { default: sharp } = await import("sharp");

const CANVAS_W = 5000; // wide enough that no mark text ever clips; trimmed below
const CANVAS_H = Math.round(FONT_SIZE * 2);
const baseline = Math.round(FONT_SIZE * 1.15);

for (const { text, out } of MARKS) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="${SHADOW_BLUR}"
        flood-color="#000000" flood-opacity="${SHADOW_OPACITY}"/>
    </filter>
  </defs>
  <text x="40" y="${baseline}" font-family="${FONT_FAMILY}" font-weight="${FONT_WEIGHT}"
    font-size="${FONT_SIZE}" fill="${FILL}" fill-opacity="${FILL_OPACITY}"
    filter="url(#shadow)">${text}</text>
</svg>`;

	const rendered = await sharp(Buffer.from(svg)).png().toBuffer();
	// Trim fully-transparent margins (keeps the soft shadow), then add a little breathing room.
	const trimmed = await sharp(rendered)
		.trim({ threshold: 1 })
		.toBuffer({ resolveWithObject: true });
	const pad = SHADOW_BLUR * 3;
	const outPath = join(ROOT, out);
	await sharp(trimmed.data)
		.extend({
			top: pad,
			bottom: pad,
			left: pad,
			right: pad,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toFile(outPath);

	console.log(
		`✓ "${text}" written: ${outPath}\n  ink box ${trimmed.info.width}x${trimmed.info.height} (+${pad}px pad), font=${FONT_FAMILY} ${FONT_WEIGHT}`,
	);
}
