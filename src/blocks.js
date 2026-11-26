/**
 * Note bodies are plain text with light markdown-style block syntax:
 *   # / ## / ###  headings      - item   bullets      1. item  numbered
 *   - ★ item      a starred bullet
 *   - [ ] / - [x] checklist     > quote               --- divider
 *   ```code```    code block    | a | b | tables      ![](img:id) images
 * In the editor each line is a block; typing the trigger key (\) opens the block menu.
 */

export const TRIGGER = '\\';

const PREFIX_RE = /^(#{1,3} |- \[[ xX]\] ?|[-*] |\d+\. |> ?)/;

export const COMMANDS = [
  { id: 'text', label: 'Text', short: 'Text', group: 'Write', icon: 'Aa', keys: 'paragraph plain normal' },
  { id: 'h1', label: 'Heading 1', short: 'Heading 1', group: 'Write', icon: 'H1', hint: '#', keys: 'title big h1' },
  { id: 'h2', label: 'Heading 2', short: 'Heading 2', group: 'Write', icon: 'H2', hint: '##', keys: 'subtitle h2' },
  { id: 'h3', label: 'Heading 3', short: 'Heading 3', group: 'Write', icon: 'H3', hint: '###', keys: 'h3 small' },
  { id: 'bullet', label: 'Bulleted list', short: 'Bullets', group: 'Lists', icon: 'bullet', hint: '-', keys: 'ul unordered dash bullets' },
  { id: 'number', label: 'Numbered list', short: 'Numbers', group: 'Lists', icon: 'number', hint: '1.', keys: 'ol ordered numbers' },
  { id: 'check', label: 'Checklist', short: 'Checklist', group: 'Lists', icon: 'check', hint: '- [ ]', keys: 'todo task checkbox' },
  { id: 'quote', label: 'Quote', short: 'Quote', group: 'Lists', icon: 'quote', hint: '>', keys: 'blockquote citation' },
  { id: 'table', label: 'Table', short: 'Table', group: 'Insert', icon: 'table', keys: 'grid rows columns', tip: 'Tab between cells' },
  { id: 'image', label: 'Image', short: 'Image', group: 'Insert', icon: 'image', keys: 'photo picture upload', tip: 'or paste one' },
  { id: 'code', label: 'Code block', short: 'Code', group: 'Insert', icon: 'code', hint: '```', keys: 'snippet pre' },
  { id: 'divider', label: 'Divider', short: 'Divider', group: 'Insert', icon: 'divider', hint: '---', keys: 'line hr separator rule' },
  { id: 'date', label: 'Today\u2019s date', short: 'Date', group: 'Insert', icon: 'date', keys: 'today now day calendar time' },
];

export const MENU_COLS = 4;

/**
 * Lay the visible commands out as the menu shows them: grouped sections when
 * unfiltered, one grid of matches when filtered. `rows` holds item indexes per
 * visual row, used for arrow-key movement.
 */
export function menuLayout(items, query) {
  const sections = [];
  if (query.trim()) sections.push({ label: null, items: items.map((cmd, index) => ({ cmd, index })) });
  else
    items.forEach((cmd, index) => {
      let sec = sections[sections.length - 1];
      if (!sec || sec.label !== cmd.group) sections.push((sec = { label: cmd.group, items: [] }));
      sec.items.push({ cmd, index });
    });
  const rows = [];
  for (const sec of sections)
    for (let i = 0; i < sec.items.length; i += MENU_COLS) rows.push(sec.items.slice(i, i + MENU_COLS).map((x) => x.index));
  return { sections, rows };
}

/** Next active index for an arrow key in the tile grid. */
export function moveInMenu(rows, active, key) {
  const r = rows.findIndex((row) => row.includes(active));
  if (r < 0) return 0;
  const c = rows[r].indexOf(active);
  const flat = rows.flat();
  const i = flat.indexOf(active);
  if (key === 'ArrowRight') return flat[(i + 1) % flat.length];
  if (key === 'ArrowLeft') return flat[(i - 1 + flat.length) % flat.length];
  const nr = key === 'ArrowDown' ? (r + 1) % rows.length : (r - 1 + rows.length) % rows.length;
  return rows[nr][Math.min(c, rows[nr].length - 1)];
}

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

/* ------------------------------------------------------------------ */
/* Block model. The note body is stored as text (see top of file) and   */
/* edited as a list of blocks.                                          */
/* ------------------------------------------------------------------ */

export const TEXTUAL = new Set(['text', 'h1', 'h2', 'h3', 'bullet', 'number', 'check', 'quote', 'code']);
export const LISTS = new Set(['bullet', 'number', 'check']);

let seq = 0;
export const newBlock = (type = 'text', text = '', extra = {}) => ({
  id: `b${Date.now().toString(36)}${(seq++).toString(36)}`,
  type,
  text,
  ...(type === 'check' ? { checked: false } : {}),
  ...extra,
});

const splitRow = (l) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
const escCell = (c) => c.replace(/\n/g, ' ').replace(/\|/g, '\\|');

export function toBlocks(src) {
  const lines = String(src ?? '').split('\n');
  const out = [];
  const last = () => out[out.length - 1];
  let i = 0;
  let prevQuote = false; // consecutive "> " lines form one quote block
  while (i < lines.length) {
    const l = lines[i];
    let m;
    const wasQuote = prevQuote;
    prevQuote = false;
    if (/^```/.test(l)) {
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
      out.push(newBlock('code', lines.slice(i + 1, j).join('\n')));
      i = j + 1;
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [splitRow(l)];
      let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) rows.push(splitRow(lines[j++]));
      const cols = Math.max(...rows.map((r) => r.length));
      out.push(newBlock('table', '', { rows: rows.map((r) => Array.from({ length: cols }, (_, k) => r[k] ?? '')) }));
      i = j;
      continue;
    }
    if ((m = /^(#{1,3}) (.*)$/.exec(l))) out.push(newBlock(`h${m[1].length}`, m[2]));
    else if ((m = /^[-*] \[([ xX])\] ?(.*)$/.exec(l))) out.push(newBlock('check', m[2], { checked: m[1] !== ' ' }));
    else if ((m = /^[-*] ★ ?(.*)$/.exec(l))) out.push(newBlock('bullet', m[1], { starred: true }));
    else if ((m = /^[-*] (.*)$/.exec(l))) out.push(newBlock('bullet', m[1]));
    else if ((m = /^\d+[.)] (.*)$/.exec(l))) out.push(newBlock('number', m[1]));
    else if ((m = /^> ?(.*)$/.exec(l))) {
      if (wasQuote) last().text += `\n${m[1]}`;
      else out.push(newBlock('quote', m[1]));
      prevQuote = true;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(l)) out.push(newBlock('hr'));
    else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(l))) {
      // Optional size and alignment after the alt text: ![alt|60|left](src)
      const [alt, ...opts] = m[1].split('|');
      const num = opts.find((o) => /^\d{1,3}$/.test(o));
      const align = opts.find((o) => o === 'left' || o === 'right' || o === 'center') || 'center';
      out.push(newBlock('image', '', { alt, src: m[2], width: num ? Math.min(100, Math.max(10, Number(num))) : 100, align }));
    }
    else if ((m = /^ {2}(.*)$/.exec(l)) && LISTS.has(last()?.type)) last().text += `\n${m[1]}`;
    else out.push(newBlock('text', l));
    i++;
  }
  if (!out.length) out.push(newBlock());
  return out;
}

export function fromBlocks(blocks) {
  const lines = [];
  let n = 0;
  for (const b of blocks) {
    n = b.type === 'number' ? n + 1 : 0;
    const t = b.text ?? '';
    const cont = t.replace(/\n/g, '\n  ');
    switch (b.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        lines.push(`${'#'.repeat(Number(b.type[1]))} ${t.replace(/\n/g, ' ')}`);
        break;
      case 'bullet':
        lines.push(`- ${b.starred ? '★ ' : ''}${cont}`);
        break;
      case 'number':
        lines.push(`${n}. ${cont}`);
        break;
      case 'check':
        lines.push(`- [${b.checked ? 'x' : ' '}] ${cont}`);
        break;
      case 'quote':
        lines.push(t.split('\n').map((x) => `> ${x}`).join('\n'));
        break;
      case 'code':
        lines.push(`\`\`\`\n${t}\n\`\`\``);
        break;
      case 'hr':
        lines.push('---');
        break;
      case 'image': {
        const w = b.width && b.width < 100 ? `|${Math.round(b.width)}` : '';
        const al = b.align && b.align !== 'center' ? `|${b.align}` : '';
        lines.push(`![${b.alt || ''}${w}${al}](${b.src})`);
        break;
      }
      case 'table': {
        const row = (r) => `| ${r.map(escCell).join(' | ')} |`;
        lines.push([row(b.rows[0]), `| ${b.rows[0].map(() => '---').join(' | ')} |`, ...b.rows.slice(1).map(row)].join('\n'));
        break;
      }
      default:
        lines.push(t);
    }
  }
  return lines.join('\n');
}

/** Move block i to insertion index k (0…length), optionally patching it. */
export function moveBlock(blocks, i, k, patch = {}) {
  const item = { ...blocks[i], ...patch };
  const rest = blocks.filter((_, j) => j !== i);
  const at = k > i ? k - 1 : k;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** Size of a block in "caret positions" — used to map a click on the formatted view to a spot in the editor. */
const blockLen = (b) => (TEXTUAL.has(b.type) ? b.text.length : b.type === 'table' ? b.rows.flat().length : 0);

export function positions(blocks) {
  const out = [];
  let acc = 0;
  for (const b of blocks) {
    out.push(acc);
    acc += blockLen(b) + 1;
  }
  return out;
}

/** Where to put the caret for a position (null = end of the note). */
export function locate(blocks, pos) {
  const focusable = (b) => TEXTUAL.has(b.type) || b.type === 'table';
  const endOf = (b) =>
    b.type === 'table'
      ? { key: `${b.id}:${b.rows.length - 1}:${b.rows[0].length - 1}`, offset: 'end' }
      : { key: b.id, offset: 'end' };
  if (pos == null) {
    for (let i = blocks.length - 1; i >= 0; i--) if (focusable(blocks[i])) return endOf(blocks[i]);
    return null;
  }
  const starts = positions(blocks);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (pos > starts[i] + blockLen(b)) continue;
    if (TEXTUAL.has(b.type)) return { key: b.id, offset: pos - starts[i] };
    if (b.type === 'table') {
      const cols = b.rows[0].length;
      const k = Math.max(0, pos - starts[i]);
      return { key: `${b.id}:${Math.min(b.rows.length - 1, Math.floor(k / cols))}:${k % cols}`, offset: 'end' };
    }
    for (let j = i + 1; j < blocks.length; j++) if (focusable(blocks[j])) return { key: blocks[j].id ?? '', offset: 0 };
    for (let j = i - 1; j >= 0; j--) if (focusable(blocks[j])) return endOf(blocks[j]);
  }
  return locate(blocks, null);
}

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
