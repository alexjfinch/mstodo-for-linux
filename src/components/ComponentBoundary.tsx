import React from "react";
import { logger } from "../services/logger";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Lightweight error boundary for individual components.
 * Shows a small inline fallback instead of crashing the entire app.
 */
export class ComponentBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: React.ErrorInfo) {
    logger.error("Component error", error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: "16px", color: "var(--text-secondary, #999)", fontSize: "13px" }}>
          Something went wrong in this section.{" "}
          <button
            style={{ background: "none", border: "none", color: "var(--accent-primary, #2196F3)", cursor: "pointer", textDecoration: "underline", fontSize: "13px" }}
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
