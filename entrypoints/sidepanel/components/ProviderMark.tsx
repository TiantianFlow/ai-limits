import React from "react";

import {
  isProviderId,
  providerPresentation,
  type ProviderId,
} from "../../../providers/catalog";

export interface ProviderMarkProps {
  providerId: ProviderId;
  size: "sm" | "md";
}

const fallbackMarkPath = "/provider-marks/fallback.svg";

export function ProviderMark({ providerId, size }: ProviderMarkProps) {
  const resolvedProviderId = isProviderId(providerId) ? providerId : "fallback";
  const presentation = isProviderId(providerId)
    ? providerPresentation(providerId)
    : undefined;
  const markPath = presentation?.markPath ?? fallbackMarkPath;
  const pixels = size === "sm" ? 24 : 28;

  return (
    <picture
      className={`provider-mark-frame provider-mark-frame--${size} provider-mark-frame--provider-${resolvedProviderId}`}
    >
      {presentation?.darkMarkPath ? (
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={presentation.darkMarkPath}
        />
      ) : null}
      <img
        alt=""
        aria-hidden="true"
        className={`provider-mark provider-mark--${size} provider-mark--provider-${resolvedProviderId}`}
        height={pixels}
        src={markPath}
        width={pixels}
      />
    </picture>
  );
}
