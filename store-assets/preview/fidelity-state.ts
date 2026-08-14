import {
  parseAppViewState,
  type AppViewState,
} from "../../domain/public-protocol";
import type { FidelityState } from "./copy";

export function prepareFidelityViewState(
  viewState: unknown,
  fidelityState: FidelityState,
): AppViewState {
  const parsed = parseAppViewState(viewState);
  const candidate =
    fidelityState === "unlabeled-collision"
      ? {
          ...parsed,
          instances: parsed.instances.map((instance) => {
            if (instance.providerKind !== "newapi") return instance;
            const {
              userLabel: _userLabel,
              snapshot,
              ...unlabeledInstance
            } = instance;
            if (!snapshot) return unlabeledInstance;
            const { accountLabel: _accountLabel, ...unlabeledSnapshot } =
              snapshot;
            return { ...unlabeledInstance, snapshot: unlabeledSnapshot };
          }),
        }
      : parsed;

  return candidate;
}
