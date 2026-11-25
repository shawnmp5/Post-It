import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons.jsx';
import { SettingsPanel } from './SettingsPanel.jsx';

/* Settings in a window like Account's: a title, a close button, and a scrolling body. */
export function SettingsSheet({ data, dispatch, toast, confirm, account, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.dialog')) return; // let a confirm close first
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet settings-sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="sheet-nav">
          <h2 className="sheet-title">Settings</h2>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} title="Close" aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="sheet-page">
          <SettingsPanel data={data} dispatch={dispatch} toast={toast} confirm={confirm} account={account} onDone={onClose} inSheet />
        </div>
      </div>
    </div>,
    document.body,
  );
}
