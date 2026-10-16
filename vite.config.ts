import { defineConfig, type Plugin } from "vitest/config";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

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

export default defineConfig({
  base: "/duck-call-coach/",
  plugins: [contentSecurityPolicy()],
  build: {
    rollupOptions: {
      input: { main: "index.html", diagnostics: "diagnostics.html" },
    },
  },
  test: {
    environment: "node",
  },
});
