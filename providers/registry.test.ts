import { describe, expect, test } from "vitest";

import { providerRegistry, providerIds } from "./registry";

describe("provider registry", () => {
  test("contains only the four standalone web providers with exact grants", () => {
    expect(providerIds).toEqual(["chatgpt", "claude", "kimi", "cursor"]);
    expect(
      providerIds.map((providerId) => [
        providerId,
        providerRegistry[providerId].optionalOrigins,
        providerRegistry[providerId].optionalPermissions ?? [],
      ]),
    ).toEqual([
      ["chatgpt", ["https://chatgpt.com/*"], []],
      ["claude", ["https://claude.ai/*"], []],
      ["kimi", ["https://www.kimi.com/*"], ["cookies"]],
      ["cursor", ["https://cursor.com/*"], []],
    ]);
  });
});
