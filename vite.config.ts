import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { buildId, DEV_BUILD_ID } from "./src/build/buildId.ts";
import { CONTENT_SECURITY_POLICY } from "./src/build/csp.ts";
import { buildServiceWorker, SERVICE_WORKER_FILE, type OutputFile } from "./src/build/serviceWorker.ts";

// Build-only: Vite's dev server injects inline scripts that this policy would block.
function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: CONTENT_SECURITY_POLICY,
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

/** Every file under `dir`, with its path relative to `dir`. */
function readFilesUnder(dir: string): OutputFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: relative(dir, path), content: readFileSync(path) };
    });
}

/**
 * Build-only: writes sw.js from src/sw-template.js, precaching everything this build emits plus the clips,
 * icons and manifest from public/. Runs after Vite's own generateBundle hooks, which emit the HTML pages.
 */
function serviceWorker(): Plugin {
  let root = "";
  let publicDir = "";
  return {
    name: "service-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const buildFiles: OutputFile[] = Object.values(bundle).map((output) => ({
          path: output.fileName,
          content: output.type === "chunk" ? output.code : output.source,
        }));
        const publicFiles = publicDir === "" ? [] : readFilesUnder(publicDir);
        const template = readFileSync(resolve(root, "src/sw-template.js"), "utf8");
        this.emitFile({
          type: "asset",
          fileName: SERVICE_WORKER_FILE,
          source: buildServiceWorker(template, buildFiles, publicFiles),
        });
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  base: "/duck-call-coach/",
  plugins: [contentSecurityPolicy(), serviceWorker()],
  define: {
    // Shown on the Credits screen. JSON.stringify makes it a string literal in the bundle.
    __BUILD_ID__: JSON.stringify(command === "build" ? buildId(process.env.GITHUB_SHA, new Date()) : DEV_BUILD_ID),
  },
  build: {
    rollupOptions: {
      input: { main: "index.html", diagnostics: "diagnostics.html" },
    },
  },
  test: {
    environment: "node",
  },
}));
