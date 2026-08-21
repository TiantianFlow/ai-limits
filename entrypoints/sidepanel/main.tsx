import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyDocumentLocale, hydrateLocaleOverride } from "../../i18n/index";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Side-panel root element is missing.");
}

void hydrateLocaleOverride()
  .catch(() => undefined)
  .then(() => {
    applyDocumentLocale(document);
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
