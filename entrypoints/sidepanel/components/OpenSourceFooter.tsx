import React from "react";

import { Icon } from "./Icon";

const REPOSITORY_URL = "https://github.com/wjcjttl/ai-limits";
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const SAFE_LINK_REL = "noopener noreferrer";

export interface OpenSourceFooterProps {
  showIssues?: boolean;
}

export function OpenSourceFooter({ showIssues = true }: OpenSourceFooterProps) {
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
        <h2>Built in the open</h2>
        <p>
          Inspect how provider usage is read, follow development, or help shape
          what comes next.
        </p>
        <div className="open-source-footer__links">
          <a href={REPOSITORY_URL} rel={SAFE_LINK_REL} target="_blank">
            <Icon name="code" />
            View source
          </a>
          {showIssues ? (
            <a href={ISSUES_URL} rel={SAFE_LINK_REL} target="_blank">
              <Icon name="feedback" />
              Share feedback
            </a>
          ) : null}
        </div>
        {showIssues ? (
          <p className="open-source-footer__warning">
            Do not include cookies, access credentials, private usage data, or
            other secrets in an issue.
          </p>
        ) : null}
      </div>
    </footer>
  );
}
