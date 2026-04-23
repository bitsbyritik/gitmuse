import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "bin/cli.ts" },
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  splitting: false,
  dts: false,
});
