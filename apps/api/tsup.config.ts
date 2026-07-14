import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // The API is a deployable application, not a consumable library. Its Web
  // client imports AppRouter directly from source for type-only checking.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2022",
  external: ["drizzle-orm"],
});
