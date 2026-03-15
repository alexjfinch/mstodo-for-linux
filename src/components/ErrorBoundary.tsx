import React from "react";

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

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Uncaught error:", error, info.componentStack);
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
    background: "#1e1e1e",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    textAlign: "center",
    padding: "40px",
    maxWidth: "420px",
  },
  title: {
    color: "#e0e0e0",
    fontSize: "20px",
    marginBottom: "12px",
  },
  message: {
    color: "#999",
    fontSize: "14px",
    marginBottom: "24px",
    wordBreak: "break-word",
  },
  button: {
    padding: "10px 24px",
    fontSize: "14px",
    fontWeight: 600,
    background: "#2196F3",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};
