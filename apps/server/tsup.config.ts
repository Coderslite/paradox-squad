import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Bundle the workspace package (it ships TypeScript source); keep real npm deps external.
  noExternal: ["@paradox/shared"],
});
