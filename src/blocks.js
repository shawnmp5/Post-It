/**
 * Note bodies are plain text with light markdown-style block syntax:
 *   # / ## / ###  headings      - item   bullets      1. item  numbered
 *   - [ ] / - [x] checklist     > quote               --- divider
 *   ```code```    code block    | a | b | tables      ![](img:id) images
 * Typing the trigger key (\) in a note opens a menu that inserts these.
 */

export const TRIGGER = '\\';

const PREFIX_RE = /^(#{1,3} |- \[[ xX]\] ?|[-*] |\d+\. |> ?)/;

export const COMMANDS = [
  { id: 'text', label: 'Text', icon: '¶', keys: 'paragraph plain normal' },
  { id: 'h1', label: 'Heading 1', icon: 'H1', hint: '#', keys: 'title big h1' },
  { id: 'h2', label: 'Heading 2', icon: 'H2', hint: '##', keys: 'subtitle h2' },
  { id: 'h3', label: 'Heading 3', icon: 'H3', hint: '###', keys: 'h3 small' },
  { id: 'bullet', label: 'Bulleted list', icon: 'bullet', hint: '-', keys: 'ul unordered dash' },
  { id: 'number', label: 'Numbered list', icon: 'number', hint: '1.', keys: 'ol ordered' },
  { id: 'check', label: 'Checklist', icon: 'check', hint: '[]', keys: 'todo task checkbox' },
  { id: 'table', label: 'Table', icon: 'table', keys: 'grid rows columns' },
  { id: 'image', label: 'Image', icon: 'image', keys: 'photo picture upload' },
  { id: 'quote', label: 'Quote', icon: 'quote', hint: '>', keys: 'blockquote citation' },
  { id: 'code', label: 'Code block', icon: 'code', hint: '```', keys: 'snippet pre' },
  { id: 'divider', label: 'Divider', icon: 'divider', hint: '---', keys: 'line hr separator rule' },
  { id: 'date', label: 'Today’s date', icon: 'date', keys: 'today now day calendar time' },
];

export function filterCommands(query) {
  const q = query.trim().toLowerCase();
  if (!q) return COMMANDS;
  const starts = [];
  const contains = [];
  for (const c of COMMANDS) {
    const label = c.label.toLowerCase();
    if (label.startsWith(q) || label.split(/\s+/).some((w) => w.startsWith(q))) starts.push(c);
    else if (label.includes(q) || c.keys.includes(q) || c.id === q) contains.push(c);
  }
  return [...starts, ...contains];
}

const lineBounds = (v, pos) => {
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  let end = v.indexOf('\n', pos);
  if (end < 0) end = v.length;
  return { start, end };
};

export const todayString = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });

/**
 * Apply a command to `value`, where the trigger + query occupy [from, to).
 * Returns { value, selStart, selEnd }. `extra` carries data such as an image id.
 */
export function applyCommand(value, from, to, id, extra = {}) {
  let v = value.slice(0, from) + value.slice(to);
  const caret = from;
  const { start, end } = lineBounds(v, caret);
  const line = v.slice(start, end);
  const content = line.replace(PREFIX_RE, '');
  const replaceLine = (text, selFromLineStart, selLen = 0) => {
    const out = v.slice(0, start) + text + v.slice(end);
    const s = start + (selFromLineStart ?? text.length);
    return { value: out, selStart: s, selEnd: s + selLen };
  };

  switch (id) {
    case 'text':
      return replaceLine(content);
    case 'h1':
    case 'h2':
    case 'h3': {
      const p = `${'#'.repeat(Number(id[1]))} `;
      return replaceLine(p + content);
    }
    case 'bullet':
      return replaceLine(`- ${content}`);
    case 'number': {
      const prev = v.slice(lineBounds(v, Math.max(0, start - 1)).start, Math.max(0, start - 1));
      const m = start > 0 && /^(\d+)\. /.exec(prev);
      return replaceLine(`${m ? Number(m[1]) + 1 : 1}. ${content}`);
    }
    case 'check':
      return replaceLine(`- [ ] ${content}`);
    case 'quote':
      return replaceLine(`> ${content}`);
    case 'code':
      return content
        ? replaceLine(`\`\`\`\n${content}\n\`\`\``, 4 + content.length)
        : replaceLine('```\n\n```', 4);
    case 'divider':
      return replaceLine(`---\n${content}`, 4 + content.length);
    case 'table': {
      const lead = content ? `${content}\n` : '';
      const t = `${lead}| Column 1 | Column 2 |\n| --- | --- |\n|  |  |`;
      return replaceLine(t, lead.length + 2, 8);
    }
    case 'image': {
      const img = `![](img:${extra.imageId})`;
      return content ? replaceLine(`${line}\n${img}`) : replaceLine(img);
    }
    case 'date': {
      const d = todayString();
      v = v.slice(0, caret) + d + v.slice(caret);
      return { value: v, selStart: caret + d.length, selEnd: caret + d.length };
    }
    default:
      return { value: v, selStart: caret, selEnd: caret };
  }
}

/**
 * Enter inside a list / quote continues it; Enter on an empty item ends it.
 * Returns null when Enter should behave normally.
 */
export function continueList(value, selStart, selEnd) {
  const { start } = lineBounds(value, selStart);
  const before = value.slice(start, selStart);
  let m;
  let next = null;
  let empty = false;
  if ((m = /^- \[[ xX]\] ?(.*)$/.exec(before))) {
    next = '- [ ] ';
    empty = !m[1].trim();
  } else if ((m = /^([-*]) (.*)$/.exec(before))) {
    next = `${m[1]} `;
    empty = !m[2].trim();
  } else if ((m = /^(\d+)\. (.*)$/.exec(before))) {
    next = `${Number(m[1]) + 1}. `;
    empty = !m[2].trim();
  } else if ((m = /^> ?(.*)$/.exec(before))) {
    next = '> ';
    empty = !m[1].trim();
  }
  if (next == null) return null;
  if (empty) {
    const out = value.slice(0, start) + value.slice(selStart);
    return { value: out, selStart: start, selEnd: start };
  }
  const ins = `\n${next}`;
  const out = value.slice(0, selStart) + ins + value.slice(selEnd);
  const s = selStart + ins.length;
  return { value: out, selStart: s, selEnd: s };
}

const splitRow = (l) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Parse a body into display blocks; each block keeps the source offset of its text. */
export function parseBody(src) {
  const lines = src.split('\n');
  const offs = [];
  let off = 0;
  for (const l of lines) {
    offs.push(off);
    off += l.length + 1;
  }
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const o = offs[i];
    let m;
    if (/^```/.test(l)) {
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
      out.push({ type: 'code', text: lines.slice(i + 1, j).join('\n'), offset: offs[i + 1] ?? o + l.length });
      i = j + 1;
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [splitRow(l)];
      let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) rows.push(splitRow(lines[j++]));
      out.push({ type: 'table', header: rows[0], rows: rows.slice(1), offset: o + 2 });
      i = j;
      continue;
    }
    if ((m = /^(#{1,3}) (.*)$/.exec(l))) out.push({ type: `h${m[1].length}`, text: m[2], offset: o + m[1].length + 1 });
    else if ((m = /^- \[([ xX])\] ?(.*)$/.exec(l)))
      out.push({ type: 'check', checked: m[1] !== ' ', text: m[2], offset: o + l.length - m[2].length, mark: o + 3 });
    else if ((m = /^[-*] (.*)$/.exec(l))) out.push({ type: 'bullet', text: m[1], offset: o + 2 });
    else if ((m = /^(\d+)\. (.*)$/.exec(l))) out.push({ type: 'number', n: Number(m[1]), text: m[2], offset: o + m[1].length + 2 });
    else if ((m = /^> ?(.*)$/.exec(l))) out.push({ type: 'quote', text: m[1], offset: o + l.length - m[1].length });
    else if (/^(-{3,}|\*{3,})\s*$/.test(l)) out.push({ type: 'hr', offset: o });
    else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(l))) out.push({ type: 'image', alt: m[1], src: m[2], offset: o });
    else out.push({ type: 'p', text: l, offset: o });
    i++;
  }
  return out;
}

/** Toggle the checklist box whose "x" / " " sits at `mark`. */
export const toggleCheck = (body, mark) =>
  body.slice(0, mark) + (body[mark] === ' ' ? 'x' : ' ') + body.slice(mark + 1);

/** Image ids referenced by a body. */
export const imageRefs = (body) => [...body.matchAll(/!\[[^\]]*\]\(img:([\w-]+)\)/g)].map((m) => m[1]);

/** Plain-text version of a body for search snippets. */
export const plainText = (body) =>
  body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/^```.*$/gm, '')
    .replace(/^(#{1,3} |- \[[ xX]\] ?|[-*] |\d+\. |> ?)/gm, '')
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, '')
    .replace(/\|/g, ' ');

/** Shrink an image file to a reasonable size and return a data URL. */
export async function imageFileToDataURL(file, max = 1000) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const png = file.type === 'image/png' && w * h <= 500 * 500;
    if (!png) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
