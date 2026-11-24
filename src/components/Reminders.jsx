import { useState } from 'react';
import { Popover } from './Popover.jsx';

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

const at = (d, h, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const time = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Today, 6:00 PM", "Tomorrow, 9:00 AM", "Mon, Dec 1, 9:00 AM" */
export function formatWhen(ts, now = new Date()) {
  const d = new Date(ts);
  if (sameDay(d, now)) return `Today, ${time(d)}`;
  if (sameDay(d, addDays(now, 1))) return `Tomorrow, ${time(d)}`;
  if (sameDay(d, addDays(now, -1))) return `Yesterday, ${time(d)}`;
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)}, ${time(d)}`;
}

/** Compact label for the chip on a note: "Today 6 PM", "Tomorrow 9 AM", "Sat 10 AM", "Nov 30 9 AM". */
export function formatShort(ts, now = new Date()) {
  const d = new Date(ts);
  const t = d.getMinutes()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (sameDay(d, now)) return `Today ${t}`;
  if (sameDay(d, addDays(now, 1))) return `Tomorrow ${t}`;
  if (sameDay(d, addDays(now, -1))) return `Yesterday ${t}`;
  const days = (at(d, 0) - at(now, 0)) / 864e5;
  if (days > 0 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)} ${t}`;
}

/** Quick picks, computed from now. */
function presets(now = new Date()) {
  const list = [];
  const evening = at(now, 18);
  if (evening - now > 45 * 60 * 1000) list.push({ id: 'evening', label: 'This evening', when: evening });
  else list.push({ id: 'hour', label: 'In an hour', when: new Date(Math.ceil((now.getTime() + 3600e3) / 300e3) * 300e3) });
  list.push({ id: 'tomorrow', label: 'Tomorrow morning', when: at(addDays(now, 1), 9) });
  const dow = now.getDay(); // 0 Sun … 6 Sat
  if (dow !== 6 && dow !== 0) list.push({ id: 'weekend', label: 'This weekend', when: at(addDays(now, 6 - dow), 10) });
  const toMonday = ((8 - dow) % 7) || 7;
  list.push({ id: 'week', label: 'Next week', when: at(addDays(now, toMonday), 9) });
  return list;
}

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const isDue = (r) => !!r && r.at <= Date.now();

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

export function ReminderPicker({ anchor, reminder, onSet, onClear, onClose }) {
  const now = new Date();
  const [custom, setCustom] = useState(() => toLocalInput(reminder ? new Date(reminder.at) : at(addDays(now, 1), 9)));
  const customTs = new Date(custom).getTime();
  const customValid = Number.isFinite(customTs) && customTs > Date.now();

  return (
    <Popover anchor={anchor} onClose={onClose} align="end" className="reminder-picker" closeOnScroll={false}>
      <div className="rp-head">
        <span className="rp-bell" aria-hidden="true">
          <BellIcon />
        </span>
        <span>{reminder ? 'Change reminder' : 'Remind me'}</span>
      </div>
      {reminder && (
        <div className={`rp-current ${isDue(reminder) ? 'is-due' : ''}`}>
          {isDue(reminder) ? 'Was due ' : 'Set for '}
          {formatWhen(reminder.at)}
        </div>
      )}
      <div className="rp-list">
        {presets(now).map((p) => (
          <button key={p.id} type="button" className="rp-item" onClick={() => onSet(p.when.getTime())}>
            <span>{p.label}</span>
            <span className="rp-when">{formatWhen(p.when, now)}</span>
          </button>
        ))}
      </div>
      <form
        className="rp-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (customValid) onSet(customTs);
        }}
      >
        <label className="rp-label" htmlFor="reminder-when">
          Pick a date &amp; time
        </label>
        <div className="rp-row">
          <input
            id="reminder-when"
            type="datetime-local"
            className="text-input"
            value={custom}
            min={toLocalInput(now)}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!customValid}>
            Set
          </button>
        </div>
      </form>
      {reminder && (
        <button type="button" className="rp-clear" onClick={onClear}>
          Remove reminder
        </button>
      )}
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Chip on the note                                                    */
/* ------------------------------------------------------------------ */

export function ReminderChip({ reminder, onOpen, onDone }) {
  const due = isDue(reminder);
  return (
    <div className={`reminder-chip ${due ? 'is-due' : ''}`} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
      <button
        type="button"
        className="rc-main"
        title={due ? 'Reminder is due — click to change' : 'Change reminder'}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(e.currentTarget);
        }}
      >
        <span className="rc-bell" aria-hidden="true">
          <BellIcon />
        </span>
        <span className="rc-text" title={formatWhen(reminder.at)}>
          {due ? 'Due · ' : ''}
          {formatShort(reminder.at)}
        </span>
      </button>
      <button
        type="button"
        className="rc-done"
        title="Mark as done"
        aria-label="Mark reminder as done"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.3 5 8.6l4.6-5" />
        </svg>
      </button>
    </div>
  );
}

export function BellIcon(props) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1 1H3z" />
      <path d="M6.6 14a1.6 1.6 0 0 0 2.8 0" />
    </svg>
  );
}
