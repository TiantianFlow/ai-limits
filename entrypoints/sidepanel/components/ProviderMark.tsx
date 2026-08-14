import React from "react";

import {
  isProviderKind,
  providerPresentation,
  type ProviderKind,
} from "../../../providers/catalog";

export interface ProviderMarkProps {
  providerId: ProviderKind;
  size: "sm" | "md";
}

const fallbackMarkPath = "/provider-marks/fallback.svg";

export function ProviderMark({ providerId, size }: ProviderMarkProps) {
  const resolvedProviderId = isProviderKind(providerId) ? providerId : "fallback";
  const presentation = isProviderKind(providerId)
    ? providerPresentation(providerId)
    : undefined;
  const markPath = presentation?.markPath ?? fallbackMarkPath;
  const usesFallbackMark = markPath === fallbackMarkPath;
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
        className={`provider-mark provider-mark--${size} provider-mark--provider-${resolvedProviderId}${usesFallbackMark ? " provider-mark--fallback" : ""}`}
        height={pixels}
        src={markPath}
        width={pixels}
      />
    </picture>
  );
}
