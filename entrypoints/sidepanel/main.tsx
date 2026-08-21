import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyDocumentLocale } from "../../i18n/index";
import { App } from "./App";
import "./styles.css";

applyDocumentLocale(document);

const root = document.getElementById("root");

if (!root) {
  throw new Error("Side-panel root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
