import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/langtum.ts", "src/agent.ts", "src/prompts/competitive-analysis.ts"],
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2022",
});
