import React from "react";
import { logger } from "../services/logger";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _info: React.ErrorInfo) {
    logger.error("Uncaught error", error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <h2 style={styles.title}>Something went wrong</h2>
            <p style={styles.message}>{this.state.error?.message}</p>
            <button style={styles.button} onClick={this.handleReload}>
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary, #1e1e1e)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    textAlign: "center",
    padding: "40px",
    maxWidth: "420px",
  },
  title: {
    color: "var(--text-primary, #e0e0e0)",
    fontSize: "20px",
    marginBottom: "12px",
  },
  message: {
    color: "var(--text-secondary, #999)",
    fontSize: "14px",
    marginBottom: "24px",
    wordBreak: "break-word",
  },
  button: {
    padding: "10px 24px",
    fontSize: "14px",
    fontWeight: 600,
    background: "var(--accent-primary, #2196F3)",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};
