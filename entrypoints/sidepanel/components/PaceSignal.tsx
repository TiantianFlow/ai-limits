import React from "react";

import type { PaceKind } from "../../../domain/public-protocol";
import { Icon } from "./Icon";

export interface PaceSignalProps {
  kind?: PaceKind;
  label: string;
}

export function PaceSignal({ kind, label }: PaceSignalProps) {
  const icon =
    kind === "ahead"
      ? "trending-up"
      : kind === "behind"
        ? "trending-down"
        : "minus";

  return (
    <span className={`pace pace--${kind ?? "on-pace"}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}
