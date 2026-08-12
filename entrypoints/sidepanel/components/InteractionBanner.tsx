import type { ReactNode } from "react";
import React from "react";

import { Icon } from "./Icon";

export interface InteractionBannerProps {
  children: ReactNode;
}

export function InteractionBanner({ children }: InteractionBannerProps) {
  return (
    <div className="interaction-banner">
      <Icon name="info" />
      <p>{children}</p>
    </div>
  );
}
