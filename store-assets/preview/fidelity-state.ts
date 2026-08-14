import type { AppViewState } from "../../domain/public-protocol";
import type { FidelityState } from "./copy";

export function prepareFidelityViewState(
  viewState: AppViewState,
  fidelityState: FidelityState,
): AppViewState {
  const candidate =
    fidelityState === "unlabeled-collision"
      ? {
          ...viewState,
          instances: viewState.instances.map((instance) => {
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
      : viewState;

  return candidate;
}
