import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Disable browser right-click context menu in production builds
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
