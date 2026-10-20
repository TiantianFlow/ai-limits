import { describe, expect, it } from "vitest";

import type { AppViewState } from "../../domain/public-protocol";
import {
  mergeSubsetOrder,
  moveInstanceId,
  withInstanceHidden,
  withInstanceOrder,
} from "./arrangement";

const ids = ["chatgpt:default", "claude:default", "kimi:default"];

function state(): AppViewState {
  return {
    preferences: { displayMode: "used", autoRefresh: true },
    providers: [],
    instances: ids.map((id, index) => ({
      id,
      providerKind: id.split(":")[0] as "chatgpt",
      access: "granted",
      createdAt: index,
      history: [],
    })),
  };
}

describe("provider arrangement", () => {
  it("moves an instance by an offset and clamps at the ends", () => {
    expect(moveInstanceId(ids, "kimi:default", -1)).toEqual([
      "chatgpt:default",
      "kimi:default",
      "claude:default",
    ]);
    expect(moveInstanceId(ids, "chatgpt:default", -1)).toEqual(ids);
    expect(moveInstanceId(ids, "chatgpt:default", 5)).toEqual([
      "claude:default",
      "kimi:default",
      "chatgpt:default",
    ]);
    expect(moveInstanceId(ids, "grok:default", 1)).toEqual(ids);
  });

  it("reorders a subset inside the slots it already holds", () => {
    expect(
      mergeSubsetOrder(ids, ["kimi:default", "chatgpt:default"]),
    ).toEqual(["kimi:default", "claude:default", "chatgpt:default"]);
  });

  it("applies an order and keeps unlisted instances after the listed ones", () => {
    expect(
      withInstanceOrder(state(), ["kimi:default", "chatgpt:default"]).instances.map(
        ({ id }) => id,
      ),
    ).toEqual(["kimi:default", "chatgpt:default", "claude:default"]);
  });

  it("hides and shows one instance", () => {
    const hidden = withInstanceHidden(state(), "claude:default", true);
    expect(hidden.instances[1]).toMatchObject({ hidden: true });
    const shown = withInstanceHidden(hidden, "claude:default", false);
    expect(Object.hasOwn(shown.instances[1]!, "hidden")).toBe(false);
  });
});
