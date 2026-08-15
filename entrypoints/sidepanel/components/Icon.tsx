import React from "react";

export type IconName =
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "code"
  | "feedback"
  | "info"
  | "key"
  | "minus"
  | "plus"
  | "refresh"
  | "settings"
  | "trash"
  | "trending-down"
  | "trending-up";

export interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className = "" }: IconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg
      aria-hidden="true"
      className={`icon ${className}`.trim()}
      data-icon={name}
      viewBox="0 0 20 20"
    >
      {name === "refresh" ? (
        <>
          <path {...common} d="M15.8 7.2A6.2 6.2 0 1 0 16 12" />
          <path {...common} d="M12.7 4.5h3.4v3.4" />
        </>
      ) : name === "key" ? (
        <>
          <circle {...common} cx="7" cy="9" r="3.5" />
          <path {...common} d="m9.8 11.2 6.2 6.2M13 14.4l1.8-1.8M15 16.4l1.8-1.8" />
        </>
      ) : name === "settings" ? (
        <>
          <path
            {...common}
            d="M8.3 2.7h3.4l.5 1.8c.5.2 1 .5 1.4.8l1.8-.5 1.7 3-1.3 1.3a6.7 6.7 0 0 1 0 1.8l1.3 1.3-1.7 3-1.8-.5c-.4.3-.9.6-1.4.8l-.5 1.8H8.3l-.5-1.8c-.5-.2-1-.5-1.4-.8l-1.8.5-1.7-3 1.3-1.3a6.7 6.7 0 0 1 0-1.8L2.9 7.8l1.7-3 1.8.5c.4-.3.9-.6 1.4-.8z"
          />
          <circle {...common} cx="10" cy="10" r="2.4" />
        </>
      ) : name === "trash" ? (
        <>
          <path {...common} d="M4.5 6h11M8 3.5h4l.8 2.5H7.2z" />
          <path {...common} d="m6 6 .7 10h6.6L14 6M8.5 9v4M11.5 9v4" />
        </>
      ) : name === "chevron-right" ? (
        <path {...common} d="m7.5 4.5 5.5 5.5-5.5 5.5" />
      ) : name === "chevron-left" ? (
        <path {...common} d="M12.5 4.5 7 10l5.5 5.5" />
      ) : name === "plus" ? (
        <path {...common} d="M10 4v12M4 10h12" />
      ) : name === "trending-up" ? (
        <path {...common} d="m3.5 13 4-4 3 3 5.5-6M12 6h4v4" />
      ) : name === "trending-down" ? (
        <path {...common} d="m3.5 7 4 4 3-3 5.5 6M12 14h4v-4" />
      ) : name === "minus" ? (
        <path {...common} d="M4 10h12" />
      ) : name === "check" ? (
        <>
          <circle {...common} cx="10" cy="10" r="7" />
          <path {...common} d="m6.8 10 2.1 2.2 4.5-4.7" />
        </>
      ) : name === "info" ? (
        <>
          <circle {...common} cx="10" cy="10" r="7" />
          <path {...common} d="M10 9v4" />
          <circle cx="10" cy="6.5" r="1" fill="currentColor" />
        </>
      ) : name === "code" ? (
        <path {...common} d="m7.5 5-5 5 5 5m5-10 5 5-5 5" />
      ) : (
        <>
          <path {...common} d="M4 4.5h12v8H9l-3.5 3v-3H4z" />
          <path {...common} d="M7 8.5h6" />
        </>
      )}
    </svg>
  );
}
