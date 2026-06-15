import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/sidebar.css";
import "./styles/workspace.css";
import "./styles/panels.css";
import "./styles/buttons.css";
import "./styles/floating.css";
import "./styles/animations.css";

if (new URLSearchParams(window.location.search).get("view") === "floating") {
  document.documentElement.classList.add("is-floating");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
