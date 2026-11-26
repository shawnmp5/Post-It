/*
 * Auto caps (Settings → Auto caps): capital letters as you type.
 *   - the first letter of a note, a title, a line or a list item
 *   - the first letter after . ! or ?
 *   - "i" on its own becomes "I"
 * Only a single typed character is ever changed, in place, so the caret stays put
 * and pasting or deleting is never touched. App keeps `typing.autoCaps` in step
 * with the setting.
 */

export const typing = { autoCaps: true };

const sentenceStart = (before) => /^\s*$/.test(before) || /\n\s*$/.test(before) || /[.!?…]["'”’)\]]*\s+$/.test(before);

// Call from a textarea/input's change handler, before reading its value.
// `prev` is the value it had before this keystroke.
export function fixCaps(el, prev) {
  if (!typing.autoCaps || !el) return;
  const next = el.value;
  const caret = el.selectionStart;
  if (caret !== el.selectionEnd || next.length !== prev.length + 1 || caret < 1) return;
  if (next.slice(0, caret - 1) + next.slice(caret) !== prev) return;
  const ch = next[caret - 1];
  const before = next.slice(0, caret - 1);
  let out = null;
  if (ch !== ch.toUpperCase() && sentenceStart(before)) {
    out = before + ch.toUpperCase() + next.slice(caret);
  } else if (/[\s.,!?;:'’]/.test(ch) && /(^|\s)i$/.test(before)) {
    out = `${before.slice(0, -1)}I${ch}${next.slice(caret)}`;
  }
  if (out == null) return;
  el.value = out;
  el.setSelectionRange(caret, caret);
}
