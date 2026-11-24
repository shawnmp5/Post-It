import { COLORS, clamp } from '../store.js';
import { Popover, MenuItem, MenuSep } from './Popover.jsx';
import {
  IconLink,
  IconSmile,
  IconCopy,
  IconArchive,
  IconTrash,
  IconRotateLeft,
  IconRotateRight,
  IconFit,
} from './Icons.jsx';

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function NoteMenu({ note, anchor, onClose, dispatch, toast, onDelete, onConnect, onDuplicate, onArchive, onStickers }) {
  const update = (patch, record = true) => dispatch({ type: 'note/update', id: note.id, patch, touch: false, record });
  const tilt = (delta) => update({ rotation: delta === 0 ? 0 : clamp(Math.round((note.rotation + delta) * 10) / 10, -8, 8) });

  return (
    <Popover anchor={anchor} onClose={onClose} align="start" className="menu note-menu">
      <div className="menu-swatches" role="group" aria-label="Note color">
        {COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`swatch ${note.color === c.id ? 'is-active' : ''}`}
            style={{ '--swatch': c.bg, '--swatch-edge': c.edge }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={note.color === c.id}
            onClick={() => update({ color: c.id })}
          />
        ))}
      </div>
      <MenuSep />
      <MenuItem icon={IconSmile} onClick={onStickers}>
        Add sticker…
      </MenuItem>
      <MenuItem icon={IconLink} onClick={onConnect}>
        Connect to note…
      </MenuItem>
      <div className="menu-row">
        <span className="menu-item-icon" aria-hidden="true">
          <IconRotateRight />
        </span>
        <span className="menu-item-label">Tilt</span>
        <div className="seg">
          <button type="button" onClick={() => tilt(-1.5)} aria-label="Tilt left" title="Tilt left">
            <IconRotateLeft />
          </button>
          <button
            type="button"
            className="seg-value"
            onClick={() => tilt(0)}
            title="Straighten"
            aria-label="Straighten"
          >
            {note.rotation > 0 ? '+' : ''}
            {note.rotation}°
          </button>
          <button type="button" onClick={() => tilt(1.5)} aria-label="Tilt right" title="Tilt right">
            <IconRotateRight />
          </button>
        </div>
      </div>
      {note.h != null && (
        <MenuItem
          icon={IconFit}
          onClick={() => {
            update({ h: null });
            onClose();
          }}
        >
          Fit height to text
        </MenuItem>
      )}
      <MenuItem icon={IconCopy} onClick={onDuplicate}>
        Duplicate
      </MenuItem>
      <MenuItem icon={IconArchive} onClick={onArchive}>
        Archive
      </MenuItem>
      <MenuSep />
      <MenuItem icon={IconTrash} danger onClick={onDelete} hint="Del">
        Delete
      </MenuItem>
      <div className="menu-foot">Edited {ago(note.updatedAt)}</div>
    </Popover>
  );
}
