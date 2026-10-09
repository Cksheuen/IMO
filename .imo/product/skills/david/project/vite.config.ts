import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function reviewSource(file: string): Plugin {
  const sourcePath = realpathSync(resolve(file));
  return {
    name: "david-review-source",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(sourcePath);
      const reload = (changed: string) => {
        if (resolve(changed) === sourcePath) {
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("change", reload);
      server.httpServer?.once("close", () => {
        server.watcher.off("change", reload);
      });
    },
    transformIndexHtml(html) {
      const spec = JSON.parse(readFileSync(sourcePath, "utf8"));
      spec.sourcePath ??= sourcePath;
      const embedded = JSON.stringify(spec).replace(/</g, "\\u003c");
      const title = String(spec.title ?? "David Dev")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return html
        .replace(/ data-dev-sample="[^"]*"/, "")
        .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`)
        .replace(
          /(<script id="review-data" type="application\/json">)[\s\S]*?(<\/script>)/,
          (_, start, end) => `${start}${embedded}${end}`,
        );
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === "serve" && process.env.DAVID_REVIEW_JSON
      ? [reviewSource(process.env.DAVID_REVIEW_JSON)]
      : []),
  ],
  define:
    command === "build"
      ? {
          "process.env.NODE_ENV": JSON.stringify("production"),
        }
      : {},
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: true,
  },
  build: {
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: "src/main.tsx",
      formats: ["iife"],
      name: "David",
      fileName: () => "runtime.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css")
            ? "styles.css"
            : "assets/[name][extname]",
      },
    },
  },
}));
