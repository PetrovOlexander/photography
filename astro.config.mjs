import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import compress from "@playform/compress";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import AutoImport from "astro-auto-import";
import icon from "astro-icon"; // https://www.astroicon.dev/guides/upgrade/v1/

// https://astro.build/config
export default defineConfig({
	site: "https://petrovisuals.be",
	// Old flat portfolio URLs -> new category-nested URLs (folders were regrouped).
	redirects: {
		"/portfolio/1-oceane-timo": "/portfolio/couples/oceane-timo",
		"/portfolio/2-hcc": "/portfolio/sport/hcc",
		"/portfolio/3-fitcontrol": "/portfolio/sport/fitcontrol",
		"/portfolio/4-laliquefebe": "/portfolio/aw/lalique",
		"/portfolio/5-motorsport": "/portfolio/sport/motorsport",
		"/portfolio/5-laura": "/portfolio/aw/laura",
		"/portfolio/6-hanane": "/portfolio/aw/hanane",
		"/portfolio/7-solene": "/portfolio/aw/solene",
		"/portfolio/8-paris": "/portfolio/aw/paris",
		"/portfolio/9-motorsport": "/portfolio/sport/motorsport",
	},
	devToolbar: {
		enabled: false,
	},
	image: {
		// Custom sharp service that bakes the "petrovisuals" watermark into portfolio
		// & featured photos at build time. Source images in src/data/** stay untouched.
		// See src/imageService/watermark.ts and scripts/generate-watermark.mjs.
		service: {
			entrypoint: "./src/imageService/watermark.ts",
		},
	},
	integrations: [
		// example auto import component into blog post mdx files
		AutoImport({
			imports: [
				// https://github.com/delucis/astro-auto-import
				"@components/Admonition/Admonition.astro",
			],
		}),
		mdx(),
		icon({
			// I include only the icons I use. This is because if you use SSR, ALL icons will be included (no bueno)
			// https://www.astroicon.dev/reference/configuration#include
			include: {
				tabler: [
					"bulb",
					"alert-triangle",
					"flame",
					"info-circle",
					"arrow-narrow-left",
					"arrow-narrow-right",
					"menu-2",
					"x",
					"chevron-down",
					"category",
					"calendar-event",
				],
			},
		}),
		sitemap(),
		compress({
			HTML: true,
			JavaScript: true,
			CSS: false,
			Image: false, // astro:assets handles this. Enabling this can dramatically increase build times
			SVG: false, // astro-icon handles this
		}),
	],
	vite: {
		plugins: [tailwindcss()],
		// stop inlining short scripts to fix issues with ClientRouter: https://github.com/withastro/astro/issues/12804
		build: {
			assetsInlineLimit: 0,
		},
	},
});
