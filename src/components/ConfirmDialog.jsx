import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, resolve }) {
  const okRef = useRef(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        resolve(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [resolve]);

  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && resolve(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title" className="dialog-title">
          {title}
        </h2>
        {message && <p className="dialog-msg">{message}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button
            ref={okRef}
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => resolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
