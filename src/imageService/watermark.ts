/**
 * Custom Astro image service that composites the "petrovisuals" watermark into
 * every generated derivative of a portfolio / featured photo — at build time.
 *
 * Source files in src/data/** are never modified; the watermark is applied
 * in-memory during image transformation. Site chrome (logo, hero background,
 * about/pricing decoration) lives outside the watermarked dirs and is untouched.
 *
 * The watermark itself is a pre-rendered PNG (src/assets/images/watermark.png,
 * see scripts/generate-watermark.mjs) so this runtime has NO font dependency —
 * it only resizes + composites, which is portable to any build host (e.g. Netlify).
 *
 * Wired up in astro.config.mjs via image.service.entrypoint.
 */
import sharpService from "astro/assets/services/sharp";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import sharp from "sharp";

// ---- Defaults (override via image.service.config in astro.config.mjs) -------
interface Mark {
	assetPath: string; // pre-rendered PNG (see scripts/generate-watermark.mjs)
	gravity: "southeast" | "north" | "south"; // bottom-right / top-center / bottom-center
	widthRatio: number; // mark width as a fraction of the image width
	marginRatio: number; // inset from the edge as a fraction of the image width
	minWidth: number; // floor so the mark stays legible on tiny thumbnails
}

interface Group {
	dirs: string[]; // source dirs (relative to project root) whose images get these marks
	marks: Mark[];
}

const DEFAULTS = {
	// Each group maps a set of source dirs to the marks applied to their images.
	// NOTE: we can't match by path at build time — Astro hands the transform the
	// already-emitted `/_astro/<name>.<hash>.webp` path, not the /data source path.
	// So we scan these dirs once and match by filename stem instead.
	//
	// Group ORDER is precedence: the first group to claim a filename stem wins. A
	// photo that lives in BOTH a portfolio folder and featuredImages is byte-
	// identical, so Astro emits a single shared derivative for it — there is only
	// one file to watermark. Listing portfolios first guarantees such shared photos
	// get the portfolio (single bottom) mark, keeping every portfolio page uniform.
	groups: [
		{
			// Portfolio photos: a single, smaller mark centered along the bottom.
			dirs: ["src/data/portfolios"],
			marks: [
				{
					assetPath: "src/assets/images/watermark-bottomright.png", // "petrovisuals.be"
					gravity: "south",
					widthRatio: 0.16,
					marginRatio: 0.03,
					minWidth: 56,
				},
			],
		},
		{
			// Featured / hero photos: the fuller two-mark treatment.
			dirs: ["src/data/featuredImages"],
			marks: [
				{
					assetPath: "src/assets/images/watermark-bottomright.png", // "petrovisuals.be"
					gravity: "southeast",
					widthRatio: 0.24,
					marginRatio: 0.028,
					minWidth: 64,
				},
				{
					assetPath: "src/assets/images/watermark-topcenter.png", // "petrovisuals"
					gravity: "north",
					widthRatio: 0.2,
					marginRatio: 0.028,
					minWidth: 56,
				},
			],
		},
	] as Group[],
};

const IMAGE_EXT = /\.(webp|jpe?g|png|avif|gif|tiff?)$/i;
const HASH_RE = /^[A-Za-z0-9_-]{8}$/; // Astro content-hash segment

const qualityTable: Record<string, number> = { low: 25, mid: 50, high: 80, max: 100 };
const fitMap: Record<string, string> = {
	fill: "fill",
	contain: "inside",
	cover: "cover",
	none: "outside",
	"scale-down": "inside",
	outside: "outside",
	inside: "inside",
};

function parseQuality(quality: string): number | string {
	const result = parseInt(quality);
	return Number.isNaN(result) ? quality : result;
}

// Detect GIF magic bytes (GIF87a / GIF89a) — matches Astro's sharp service.
function isGif(buf: Uint8Array): boolean {
	return (
		buf[0] === 71 &&
		buf[1] === 73 &&
		buf[2] === 70 &&
		buf[3] === 56 &&
		(buf[4] === 57 || buf[4] === 55) &&
		buf[5] === 97
	);
}

function srcPath(transform: any): string {
	const s = transform?.src;
	const p = typeof s === "string" ? s : (s && s.src) || "";
	return String(p).replace(/\\/g, "/");
}

// The original filename stem, stripped of query, extension and any Astro hash.
//   build:  /_astro/P1084229_DxO_2.BwVsa9Hj.webp  -> P1084229_DxO_2
//   dev:    /@fs/.../P1084229_DxO_2.webp?origWidth -> P1084229_DxO_2
function stemOf(path: string): string {
	const name = basename(path.split("?")[0]);
	const noExt = name.replace(IMAGE_EXT, "");
	const parts = noExt.split(".");
	if (parts.length > 1 && HASH_RE.test(parts[parts.length - 1])) parts.pop();
	return parts.join(".");
}

// Map of filename stem -> marks to apply, scanned once from the configured groups.
// A stem present in more than one group keeps the marks of the FIRST group listed
// (see the precedence note on DEFAULTS.groups).
let stemMarks: Map<string, Mark[]> | null = null;
function getStemMarks(groups: Group[]): Map<string, Mark[]> {
	if (stemMarks) return stemMarks;
	const map = new Map<string, Mark[]>();
	for (const group of groups) {
		for (const dir of group.dirs) {
			let entries: string[] = [];
			try {
				entries = readdirSync(join(process.cwd(), dir), { recursive: true }) as string[];
			} catch {
				continue;
			}
			for (const entry of entries) {
				const file = String(entry);
				if (!IMAGE_EXT.test(file)) continue;
				const stem = basename(file, extname(file));
				// First group to claim a stem wins — don't let a later group override it.
				if (!map.has(stem)) map.set(stem, group.marks);
			}
		}
	}
	stemMarks = map;
	if (map.size === 0) {
		// eslint-disable-next-line no-console
		console.warn(
			`[watermark] no source images found in configured groups — nothing will be watermarked.`,
		);
	}
	return map;
}

// ---- Watermark asset loading + per-size cache -------------------------------
const assetCache = new Map<string, Buffer | null>();
const insetCache = new Map<string, Buffer>();

function loadWatermark(assetPath: string): Buffer | null {
	if (assetCache.has(assetPath)) return assetCache.get(assetPath) ?? null;
	let buf: Buffer | null = null;
	try {
		buf = readFileSync(join(process.cwd(), assetPath));
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn(
			`[watermark] asset not found at ${assetPath} — skipping this mark. Run: npm run watermark`,
		);
	}
	assetCache.set(assetPath, buf);
	return buf;
}

// Transparent padding that turns edge-hugging gravity into an inset position.
function insetExtend(gravity: Mark["gravity"], margin: number) {
	const background = { r: 0, g: 0, b: 0, alpha: 0 };
	switch (gravity) {
		case "southeast": // bottom-right corner, inset from right + bottom
			return { right: margin, bottom: margin, background };
		case "north": // top-center, inset from the top (stays horizontally centered)
			return { top: margin, background };
		case "south": // bottom-center, inset from the bottom (stays horizontally centered)
			return { bottom: margin, background };
	}
}

/**
 * Build one composite descriptor for `mark`, sized for a base image of
 * baseW x baseH. Returns null when the mark can't fit or is unavailable.
 */
async function buildWatermarkComposite(
	baseW: number,
	baseH: number,
	mark: Mark,
): Promise<{ input: Buffer; gravity: string } | null> {
	const src = loadWatermark(mark.assetPath);
	if (!src) return null;

	let targetW = Math.max(mark.minWidth, Math.round(baseW * mark.widthRatio));
	const margin = Math.max(4, Math.round(baseW * mark.marginRatio));

	const key = `${mark.assetPath}:${mark.gravity}:${targetW}:${margin}`;
	const cached = insetCache.get(key);
	if (cached) {
		// Guard: cached inset must still fit this base (same targetW/margin implies same baseW).
		return { input: cached, gravity: mark.gravity };
	}

	let resized = await sharp(src).resize({ width: targetW }).toBuffer();
	let meta = await sharp(resized).metadata();

	// Shrink to fit if the image is unusually small/short for this width ratio.
	const maxW = baseW - margin * 2;
	const maxH = baseH - margin * 2;
	if (maxW <= 0 || maxH <= 0) return null;
	if ((meta.width ?? 0) > maxW || (meta.height ?? 0) > maxH) {
		const scale = Math.min(maxW / (meta.width ?? 1), maxH / (meta.height ?? 1), 1);
		const nw = Math.max(1, Math.floor((meta.width ?? 1) * scale));
		resized = await sharp(src).resize({ width: nw }).toBuffer();
		meta = await sharp(resized).metadata();
		targetW = nw;
	}

	const inset = await sharp(resized).extend(insetExtend(mark.gravity, margin)).png().toBuffer();

	// Final safety: composite input must be strictly smaller than the base.
	const insetMeta = await sharp(inset).metadata();
	if ((insetMeta.width ?? 0) >= baseW || (insetMeta.height ?? 0) >= baseH) return null;

	insetCache.set(key, inset);
	return { input: inset, gravity: mark.gravity };
}

// ---- Resize pipeline (mirrors astro/assets/services/sharp) ------------------
function applyResize(pipe: sharp.Sharp, transform: any) {
	pipe.rotate();
	const withoutEnlargement = Boolean(transform.fit);
	if (transform.width && transform.height && transform.fit) {
		pipe.resize({
			width: Math.round(transform.width),
			height: Math.round(transform.height),
			fit: (fitMap[transform.fit] ?? "inside") as any,
			position: transform.position,
			withoutEnlargement,
		});
	} else if (transform.height && !transform.width) {
		pipe.resize({ height: Math.round(transform.height), withoutEnlargement });
	} else if (transform.width) {
		pipe.resize({ width: Math.round(transform.width), withoutEnlargement });
	}
}

function applyFormat(pipe: sharp.Sharp, transform: any, inputBuffer: Uint8Array) {
	if (!transform.format) return;
	let quality: number | undefined = undefined;
	if (transform.quality) {
		const parsed = parseQuality(transform.quality);
		if (typeof parsed === "number") quality = parsed;
		else quality = transform.quality in qualityTable ? qualityTable[transform.quality] : undefined;
	}
	if (transform.format === "webp" && isGif(inputBuffer)) {
		pipe.webp({ quality: typeof quality === "number" ? quality : undefined, loop: 0 });
	} else {
		pipe.toFormat(transform.format, { quality });
	}
}

function normalize(data: Buffer, format: string) {
	const needsCopy = "buffer" in data && (data as any).buffer instanceof SharedArrayBuffer;
	return { data: needsCopy ? new Uint8Array(data) : data, format };
}

const service = {
	...sharpService,
	async transform(inputBuffer: Uint8Array, transformOptions: any, config: any) {
		const transform = transformOptions;
		if (transform.format === "svg") return { data: inputBuffer, format: "svg" };

		const userCfg = config?.service?.config ?? {};
		const cfg = { ...DEFAULTS, ...userCfg };
		const limitInputPixels = userCfg.limitInputPixels;

		const path = srcPath(transform);
		const marks = isGif(inputBuffer) ? undefined : getStemMarks(cfg.groups).get(stemOf(path));
		const wantsWatermark = Boolean(marks && marks.length);

		if (process.env.WM_DEBUG) {
			// eslint-disable-next-line no-console
			console.error(`[wm] ${wantsWatermark ? "MARK " : "skip "} ${stemOf(path)}  <- ${path}`);
		}

		if (!wantsWatermark) {
			// Delegate to Astro's own sharp service for identical output.
			return sharpService.transform(inputBuffer, transformOptions, config);
		}

		// 1) Resize to a lossless raw buffer so we know the true output size and
		//    encode only once (no double compression).
		const resizePipe = sharp(inputBuffer, { failOnError: false, pages: 1, limitInputPixels });
		applyResize(resizePipe, transform);
		const { data: rawData, info } = await resizePipe
			.raw()
			.toBuffer({ resolveWithObject: true });

		// 2) Composite the watermark, then encode once in the requested format.
		const out = sharp(rawData, {
			raw: { width: info.width, height: info.height, channels: info.channels },
		});
		const composites = (
			await Promise.all(
				marks!.map((mark: Mark) => buildWatermarkComposite(info.width, info.height, mark)),
			)
		).filter(Boolean) as { input: Buffer; gravity: string }[];
		if (composites.length) out.composite(composites);
		applyFormat(out, transform, inputBuffer);

		const { data, info: outInfo } = await out.toBuffer({ resolveWithObject: true });
		return normalize(data, outInfo.format);
	},
};

export default service;
