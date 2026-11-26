/*
 * Exporting a topic: a picture of its wall (PNG), the same as a PDF, or its text.
 * The picture is taken from a read-only copy of the wall drawn off-screen, so what's
 * exported looks exactly like the notes (tape, tilt, stickers, connections).
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toCanvas } from 'html-to-image';
import { StaticWall } from './StaticWall.jsx';
import { plainText } from '../blocks.js';

const MAX_PIXELS = 24_000_000; // keep big walls from exhausting memory

/* The picture is drawn in isolation, so the web fonts it uses are fetched and embedded
   (Latin subset only). Without them it falls back to system fonts, rather than failing. */
const GOOGLE_FAMILY = {
  rounded: 'Nunito:wght@400;600;700',
  serif: 'Source+Serif+4:opsz,wght@8..60,400;8..60,600',
  caveat: 'Caveat:wght@400;700',
  kalam: 'Kalam:wght@400;700',
  patrick: 'Patrick+Hand',
  gochi: 'Gochi+Hand',
};
const fontCache = new Map();
function toDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
async function fontCSS(noteFont) {
  const families = ['Inter:wght@400;500;600;700', GOOGLE_FAMILY[noteFont]].filter(Boolean);
  const key = families.join('|');
  if (!fontCache.has(key)) {
    fontCache.set(
      key,
      (async () => {
        try {
          const css = await (await fetch(`https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`)).text();
          const latin = [...css.matchAll(/\/\*\s*latin\s*\*\/\s*(@font-face\s*{[^}]*})/g)].map((m) => m[1]);
          const out = await Promise.all(
            latin.map(async (rule) => {
              const url = rule.match(/url\((https:[^)]+)\)/)?.[1];
              if (!url) return rule;
              return rule.replace(url, await toDataURL(await (await fetch(url)).blob()));
            }),
          );
          return out.join('\n');
        } catch {
          return ''; // offline: system fonts
        }
      })(),
    );
  }
  return fontCache.get(key);
}

export function topicPayload(data, topicId) {
  const topic = data.topics.find((t) => t.id === topicId);
  const notes = data.notes.filter((n) => n.topicId === topicId && !n.archived);
  const ids = new Set(notes.map((n) => n.id));
  return {
    v: 1,
    topic: { name: topic?.name || 'Untitled topic' },
    notes,
    connections: data.connections.filter((c) => ids.has(c.from) && ids.has(c.to)),
    settings: { noteFont: data.settings.noteFont, tilt: data.settings.tilt, showConnections: data.settings.showConnections },
  };
}

/* A folder: every topic in it, in sidebar order. */
export function folderPayload(data, groupId) {
  const group = (data.groups || []).find((g) => g.id === groupId);
  const topics = data.topics.filter((t) => t.groupId === groupId);
  return {
    v: 2,
    kind: 'folder',
    folder: { name: group?.name || 'Folder' },
    topics: topics.map((t) => {
      const p = topicPayload(data, t.id);
      return { id: t.id, name: p.topic.name, notes: p.notes, connections: p.connections };
    }),
    settings: { noteFont: data.settings.noteFont, tilt: data.settings.tilt, showConnections: data.settings.showConnections },
  };
}

// A folder payload's topics as single-topic payloads (a topic payload gives just itself).
export function topicsOf(payload) {
  if (payload.kind !== 'folder') return [payload];
  return payload.topics.map((t) => ({ v: 1, topic: { name: t.name }, notes: t.notes, connections: t.connections, settings: payload.settings }));
}
const titleOf = (payload) => (payload.kind === 'folder' ? payload.folder.name : payload.topic.name);

// Draw the wall off-screen and photograph it.
export async function renderWall(payload, { scale = 2, background = '#f5f5f7' } = {}) {
  const host = document.createElement('div');
  host.className = 'export-host';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await new Promise((resolve) => {
      flushSync(() =>
        root.render(createElement(StaticWall, { notes: payload.notes, connections: payload.connections, settings: payload.settings, onReady: resolve })),
      );
    });
    await document.fonts?.ready;
    await Promise.all([...host.querySelectorAll('img')].map((img) => img.decode?.().catch(() => {})));
    const node = host.firstElementChild;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const pixelRatio = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    const fontEmbedCSS = await fontCSS(payload.settings?.noteFont);
    return await toCanvas(node, { pixelRatio, backgroundColor: background, cacheBust: false, fontEmbedCSS });
  } finally {
    root.unmount();
    host.remove();
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (name) => (name || 'topic').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'topic';

// Each topic's wall under a heading with its name, stacked into one picture.
async function folderCanvas(payload, background) {
  const parts = [];
  for (const t of topicsOf(payload)) {
    if (!t.notes.length) continue;
    parts.push({ name: t.topic.name, canvas: await renderWall(t, { background }) });
  }
  if (!parts.length) return renderWall({ ...topicsOf(payload)[0], notes: [] }, { background });
  const head = 120; // heading band, in the walls' own pixels (they're drawn at about 2x)
  const width = Math.max(...parts.map((p) => p.canvas.width));
  let height = 0;
  for (const p of parts) height += head + p.canvas.height;
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
  const out = document.createElement('canvas');
  out.width = Math.round(width * k);
  out.height = Math.round(height * k);
  const g = out.getContext('2d');
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  g.scale(k, k);
  let y = 0;
  for (const p of parts) {
    g.fillStyle = '#1b1b1a';
    g.font = `700 ${Math.round(head * 0.42)}px Inter, -apple-system, "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(p.name, Math.round(head * 0.6), y + head * 0.62);
    y += head;
    g.drawImage(p.canvas, 0, y);
    y += p.canvas.height;
  }
  return out;
}

export async function exportPNG(payload) {
  const canvas = payload.kind === 'folder' ? await folderCanvas(payload, '#f5f5f7') : await renderWall(payload);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  download(blob, `${safeName(titleOf(payload))}.png`);
}

export async function exportPDF(payload) {
  const canvas = payload.kind === 'folder' ? await folderCanvas(payload, '#ffffff') : await renderWall(payload, { background: '#ffffff' });
  download(await canvasToPDF(canvas, titleOf(payload)), `${safeName(titleOf(payload))}.pdf`);
}

// Every note's text, as Markdown-ish plain text, ready to paste anywhere.
export function topicText(payload) {
  if (payload.kind === 'folder') {
    const parts = [`# ${payload.folder.name}`];
    for (const t of topicsOf(payload)) parts.push(notesText(t, '##'));
    return parts.join('\n\n') + '\n';
  }
  return notesText(payload, '#') + '\n';
}
function notesText(payload, h) {
  const notes = [...payload.notes].sort((a, b) => a.y - b.y || a.x - b.x);
  const parts = [`${h} ${payload.topic.name}`];
  for (const n of notes) {
    const body = plainText(n.body || '').trim();
    const title = (n.title || '').trim();
    if (!title && !body) continue;
    parts.push([title && `${h}# ${title}`, body].filter(Boolean).join('\n'));
  }
  return parts.join('\n\n');
}

/* ---------------- a small PDF writer ----------------
   A4 pages (landscape for wide walls), the picture scaled to the page width and split
   across as many pages as it needs. Each slice is embedded as a JPEG. */

async function sliceJPEG(canvas, y, h) {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function canvasToPDF(canvas, title = 'POST IT') {
  const landscape = canvas.width > canvas.height;
  const [PW, PH] = landscape ? [842, 595] : [595, 842];
  const M = 28;
  const scale = (PW - M * 2) / canvas.width; // points per pixel
  const sliceH = Math.floor((PH - M * 2) / scale); // pixels per page
  const slices = [];
  for (let y = 0; y < canvas.height; y += sliceH) {
    const h = Math.min(sliceH, canvas.height - y);
    slices.push({ h, jpg: await sliceJPEG(canvas, y, h) });
  }

  const te = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? te.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const b of [].concat(body)) push(b);
    push('\nendobj\n');
  };
  const pdfString = (s) => `(${String(s).replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, '?')})`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // 1: catalog, 2: pages, 3: info, then for each page: page, contents, image
  const pageIds = slices.map((_, i) => 4 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${slices.length} >>`);
  obj(3, `<< /Title ${pdfString(title)} /Producer (POST IT) >>`);
  slices.forEach((s, i) => {
    const pid = pageIds[i];
    const w = canvas.width * scale;
    const h = s.h * scale;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${M} ${(PH - M - h).toFixed(2)} cm /Im${i} Do Q`;
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>`);
    obj(pid + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    obj(pid + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${s.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${s.jpg.length} >>\nstream\n`,
      s.jpg,
      '\nendstream',
    ]);
  });
  const count = 4 + slices.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
