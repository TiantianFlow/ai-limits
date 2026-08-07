import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig(async () => ({
  plugins: await WxtVitest(),
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
}));
