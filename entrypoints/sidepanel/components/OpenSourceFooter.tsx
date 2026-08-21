import React from "react";

import { l10n } from "../../../i18n/index";
import { Icon } from "./Icon";

const REPOSITORY_URL = "https://github.com/TiantianFlow/ai-limits";
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const SAFE_LINK_REL = "noopener noreferrer";

export interface OpenSourceFooterProps {
  showIssues?: boolean;
}

export function OpenSourceFooter({ showIssues = true }: OpenSourceFooterProps) {
  // Read the version from the runtime manifest so package.json stays the single
  // source of truth (WXT derives manifest.version from it). No hardcoded literal.
  const version = browser.runtime.getManifest()?.version;

  return (
    <footer className="open-source-footer">
      <img
        alt=""
        aria-hidden="true"
        className="open-source-footer__mark"
        height="20"
        src="/provider-marks/github.svg"
        width="20"
      />
      <div>
        <h2>{l10n.t("footer.heading")}</h2>
        <p>{l10n.t("footer.copy")}</p>
        {version ? (
          <p className="open-source-footer__version">
            {l10n.t("footer.version", { version })}
          </p>
        ) : null}
        <div className="open-source-footer__links">
          <a href={REPOSITORY_URL} rel={SAFE_LINK_REL} target="_blank">
            <Icon name="code" />
            {l10n.t("footer.viewSource")}
          </a>
          {showIssues ? (
            <a href={ISSUES_URL} rel={SAFE_LINK_REL} target="_blank">
              <Icon name="feedback" />
              {l10n.t("footer.shareFeedback")}
            </a>
          ) : null}
        </div>
        {showIssues ? (
          <p className="open-source-footer__warning">
            {l10n.t("footer.secretsWarning")}
          </p>
        ) : null}
      </div>
    </footer>
  );
}
