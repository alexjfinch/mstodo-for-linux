type Props = {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog = ({
  message,
  confirmLabel = "OK",
  danger = false,
  onConfirm,
  onCancel,
}: Props) => (
  <div className="confirm-overlay" onClick={onCancel}>
    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
      <p className="confirm-message">{message}</p>
      <div className="confirm-actions">
        <button className="confirm-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`confirm-ok-btn${danger ? " danger" : ""}`}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);
