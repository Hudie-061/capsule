import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works on GitHub Pages (sub-path) and inside the Android APK.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: "0.0.0.0" },
  build: { target: "es2020" },
});
