import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
    mcp: "src/mcp/index.ts",
    chatgpt: "src/chatgpt/index.ts",
    "chatgpt-serve": "src/chatgpt/serve.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: "node18",
});
