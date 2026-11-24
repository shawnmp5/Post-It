import { IconClose } from './Icons.jsx';

export function Toast({ message, onUndo, action, onClose }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-msg">{message}</span>
      {action && (
        <button
          type="button"
          className="toast-undo"
          onClick={() => {
            action.onClick();
            onClose();
          }}
        >
          {action.label}
        </button>
      )}
      {onUndo && (
        <button type="button" className="toast-undo" onClick={onUndo}>
          Undo
        </button>
      )}
      <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
        <IconClose />
      </button>
    </div>
  );
}
