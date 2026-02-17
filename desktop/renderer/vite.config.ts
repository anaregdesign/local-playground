import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rendererRoot = fileURLToPath(new URL(".", import.meta.url));
const rendererCacheDir = path.resolve(
  rendererRoot,
  "..",
  "..",
  "node_modules",
  ".vite-desktop-renderer",
);

export default defineConfig({
  root: rendererRoot,
  cacheDir: rendererCacheDir,
  base: "./",
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-native", "react-native-web"],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(rendererRoot, "dist"),
    emptyOutDir: true,
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
  },
});
