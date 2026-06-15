import { Component, type ReactNode } from "react";
import { t, detectLang } from "../i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const lang = detectLang();
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
            {t("errorBoundary.title", lang)}
          </h1>
          <p style={{ color: "#666", marginBottom: "1rem" }}>
            {this.state.error?.message ?? t("errorBoundary.unknownError", lang)}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid #ccc",
              cursor: "pointer",
            }}
          >
            {t("errorBoundary.reload", lang)}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
