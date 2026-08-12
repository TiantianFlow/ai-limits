import type { ReactNode, Ref } from "react";
import React from "react";

import { Icon } from "./Icon";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backLabel: string;
  backButtonRef?: Ref<HTMLButtonElement>;
  actions?: ReactNode;
  onBack: () => void;
}

export function PageHeader({
  title,
  subtitle,
  backLabel,
  backButtonRef,
  actions,
  onBack,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__actions">
        <button
          ref={backButtonRef}
          className="page-header__back"
          type="button"
          aria-label={backLabel}
          onClick={onBack}
        >
          <Icon name="chevron-left" />
          {backLabel}
        </button>
        {actions ? <div className="page-header__right">{actions}</div> : null}
      </div>
      <div className="page-header__title">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </header>
  );
}
