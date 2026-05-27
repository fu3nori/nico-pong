import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(projectRoot, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(projectRoot, "src/sidepanel/index.html"),
        serviceWorker: resolve(projectRoot, "src/background/serviceWorker.ts"),
        contentScript: resolve(
          projectRoot,
          "src/content/nicoliveContentScript.ts"
        ),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "serviceWorker") {
            return "src/background/serviceWorker.js";
          }
          if (chunk.name === "contentScript") {
            return "src/content/nicoliveContentScript.js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
