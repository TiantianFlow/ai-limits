import { configDefaults, defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig(async () => ({
  plugins: await WxtVitest(),
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    setupFiles: ["./test/setup.ts"],
    // The 5 s default catches hangs but trips rendering tests when the whole
    // suite runs in parallel on a busy machine.
    testTimeout: 15_000,
  },
}));
