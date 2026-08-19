import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cleanup-cli.ts"],
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2022",
});
