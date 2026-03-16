import "./Titlebar.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const Titlebar = () => {
  const appWindow = getCurrentWindow();

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
  };

  const handleClose = async () => {
    await appWindow.hide();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>
          Microsoft To Do for Linux
        </span>
      </div>
      <div className="titlebar-right">
        <button
          className="titlebar-btn"
          onClick={handleMinimize}
          aria-label="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path fill="currentColor" d="M0 6h12v1H0z" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={handleMaximize}
          aria-label="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              fill="currentColor"
              d="M1 1v10h10V1H1zm1 1h8v8H2V2z"
            />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-close"
          onClick={handleClose}
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              fill="currentColor"
              d="M6 5.293L9.146 2.146l.708.708L6.707 6l3.147 3.146-.707.708L6 6.707 2.854 9.854l-.708-.708L5.293 6 2.146 2.854l.708-.708L6 5.293z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};
