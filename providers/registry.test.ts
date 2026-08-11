import { describe, expect, test } from "vitest";

import { providerCatalog } from "./catalog";
import { providerRegistry, providerIds } from "./registry";

describe("provider registry", () => {
  test("contains only the four standalone web providers with exact grants", () => {
    expect(providerIds).toEqual(["chatgpt", "claude", "kimi", "cursor"]);
    expect(
      providerIds.map((providerId) => [
        providerId,
        providerCatalog[providerId].optionalOrigins,
        providerCatalog[providerId].optionalPermissions,
      ]),
    ).toEqual([
      ["chatgpt", ["https://chatgpt.com/*"], []],
      ["claude", ["https://claude.ai/*"], []],
      ["kimi", ["https://www.kimi.com/*"], ["cookies", "scripting"]],
      ["cursor", ["https://cursor.com/*"], []],
    ]);
    expect(
      providerIds.map((providerId) => providerRegistry[providerId].id),
    ).toEqual(providerIds);
  });
});
