import { ToastNotification } from "../hooks/useReminders";

type Props = {
  toasts: ToastNotification[];
  onDismiss: (id: string) => void;
};

export const ToastContainer = ({ toasts, onDismiss }: Props) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((toast) => (
        <div key={toast.id} role="alert" className={`toast-notification${toast.type === "success" ? " toast-notification--success" : toast.type === "error" ? " toast-notification--error" : ""}`}>
          <div className="toast-icon">
            {toast.type === "success" ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10l4.5 4.5L16 6" />
              </svg>
            ) : toast.type === "error" ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM9 6h2v5H9V6zm0 7h2v2H9v-2z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a6.5 6.5 0 00-6.5 6.5c0 1.86.78 3.54 2.03 4.73l.47.44V16h8v-2.33l.47-.44A6.47 6.47 0 0016.5 8.5 6.5 6.5 0 0010 2zm2 15H8a2 2 0 004 0zM10 3.5a5 5 0 015 5c0 1.52-.64 2.89-1.66 3.86L12.5 13.14V14.5h-5v-1.36l-.84-.78A4.98 4.98 0 015 8.5a5 5 0 015-5z" />
              </svg>
            )}
          </div>
          <div className="toast-content">
            <div className="toast-title">{toast.title}</div>
            <div className="toast-body">{toast.body}</div>
          </div>
          <button
            className="toast-dismiss"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M7 5.586L11.293 1.293l1.414 1.414L8.414 7l4.293 4.293-1.414 1.414L7 8.414l-4.293 4.293-1.414-1.414L5.586 7 1.293 2.707l1.414-1.414L7 5.586z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};
