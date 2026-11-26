import { useEffect, useReducer, useRef } from 'react';
import { cleanInk } from './ink.js';
import { createSeedData, createStarterData } from './seed.js';

export { createStarterData };
import { imageRefs } from './blocks.js';

export const STORAGE_KEY = 'postit:v1';
const HISTORY_LIMIT = 120;

/** Muted sticky-note palette. `ink` is the accent used for the swatch ring. */
export const COLORS = [
  { id: 'yellow', name: 'Yellow', bg: '#FFE45E', edge: '#F0C928' },
  { id: 'pink', name: 'Pink', bg: '#FF9DBE', edge: '#F276A2' },
  { id: 'blue', name: 'Blue', bg: '#86C8FF', edge: '#56A9F0' },
  { id: 'lavender', name: 'Lavender', bg: '#BFA2FF', edge: '#9E7BF2' },
  { id: 'mint', name: 'Mint', bg: '#7FE3AE', edge: '#4ECB8A' },
  { id: 'orange', name: 'Orange', bg: '#FFAD5C', edge: '#F28E2E' },
  { id: 'white', name: 'White', bg: '#FFFFFF', edge: '#E4E4E0' },
  { id: 'gray', name: 'Gray', bg: '#D9D9D4', edge: '#BDBDB7' },
];
export const COLOR_MAP = Object.fromEntries(COLORS.map((c) => [c.id, c]));

/** A random note colour from the whole palette, avoiding `avoid` so consecutive notes differ. */
export function randomColor(avoid) {
  const pool = COLORS.map((c) => c.id).filter((c) => c !== avoid);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Note handwriting options. `scale` evens out how large each face looks. */
export const FONTS = [
  // Clean — Apple's system faces where available, with close open-source stand-ins elsewhere.
  { id: 'clean', group: 'Clean', name: 'System', family: 'var(--font)', scale: 1, titleWeight: 600 },
  {
    id: 'rounded',
    group: 'Clean',
    name: 'Rounded',
    family: "ui-rounded, 'SF Pro Rounded', 'Nunito', var(--font)",
    scale: 1.02,
    titleWeight: 700,
  },
  {
    id: 'serif',
    group: 'Clean',
    name: 'Serif',
    family: "ui-serif, 'New York', 'Source Serif 4', Georgia, serif",
    scale: 1.06,
    titleWeight: 600,
  },
  {
    id: 'mono',
    group: 'Clean',
    name: 'Mono',
    family: "ui-monospace, SFMono-Regular, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
    scale: 0.9,
    titleWeight: 600,
  },
  // Handwritten
  { id: 'caveat', group: 'Handwritten', name: 'Caveat', family: "'Caveat', cursive", scale: 1.32, titleWeight: 700 },
  { id: 'kalam', group: 'Handwritten', name: 'Kalam', family: "'Kalam', cursive", scale: 1.02, titleWeight: 700 },
  { id: 'patrick', group: 'Handwritten', name: 'Patrick', family: "'Patrick Hand', cursive", scale: 1.16, titleWeight: 400 },
  { id: 'gochi', group: 'Handwritten', name: 'Gochi', family: "'Gochi Hand', cursive", scale: 1.14, titleWeight: 400 },
];
export const FONT_MAP = Object.fromEntries(FONTS.map((f) => [f.id, f]));

export const NOTE_DEFAULT_W = 220;
export const NOTE_MIN_W = 150;
export const NOTE_MAX_W = 1400;
export const NOTE_MIN_H = 110;
export const NOTE_MAX_H = 2000;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.6;

let counter = 0;
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const randomTilt = () => Math.round((Math.random() * 4.4 - 2.2) * 10) / 10;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function makeNote(topicId, partial = {}) {
  const now = Date.now();
  return {
    id: uid('n'),
    topicId,
    title: '',
    body: '',
    color: 'yellow',
    x: 40,
    y: 40,
    w: NOTE_DEFAULT_W,
    h: null, // null = height follows content
    rotation: randomTilt(),
    z: 1,
    archived: false,
    images: {},
    stickers: [],
    reminder: null, // { at: timestamp, fired: boolean }
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export const DEFAULT_SETTINGS = {
  userName: '',
  tilt: true,
  showConnections: true,
  newNoteColor: 'random', // 'random' or a colour id
  sidebarWidth: null, // null = default width for the screen size
  noteFont: 'clean',
  theme: 'light', // 'light' | 'dark' | 'system'
  clearUI: false, // transparent interface: no panels, no lines
  wallpaper: 'none', // 'none' | 'rain'
  rainSound: false,
  rainVolume: 0.6,
  lightning: true,
  autoCaps: true, // capitalise the first letter of sentences while typing
};

/* ------------------------------------------------------------------ */
/* Data reducer — pure transformations of the persisted workspace.     */
/* ------------------------------------------------------------------ */

function maxZ(notes, topicId) {
  let m = 0;
  for (const n of notes) if (n.topicId === topicId && n.z > m) m = n.z;
  return m;
}

function dataReducer(d, a) {
  switch (a.type) {
    case 'topic/add': {
      const topic = { id: a.id, name: a.name, createdAt: Date.now(), scrollTop: 0, zoom: 1, ...(a.groupId ? { groupId: a.groupId } : {}) };
      const topics = [...d.topics];
      const at = a.index == null ? topics.length : clamp(a.index, 0, topics.length);
      topics.splice(at, 0, topic);
      return { ...d, topics, activeTopicId: a.id };
    }
    case 'topic/rename': {
      const name = a.name.trim();
      if (!name) return d;
      return { ...d, topics: d.topics.map((t) => (t.id === a.id ? { ...t, name } : t)) };
    }
    case 'topic/duplicate': {
      const src = d.topics.find((t) => t.id === a.id);
      if (!src) return d;
      const idx = d.topics.indexOf(src);
      const { share: _share, ...srcRest } = src; // a copy isn't shared
      const copy = { ...srcRest, id: a.newId, name: `${src.name} copy`, createdAt: Date.now(), scrollTop: 0 };
      const topics = [...d.topics];
      topics.splice(idx + 1, 0, copy);
      const idMap = {};
      const copiedNotes = d.notes
        .filter((n) => n.topicId === src.id)
        .map((n) => {
          const id = uid('n');
          idMap[n.id] = id;
          return { ...n, id, topicId: copy.id };
        });
      const copiedConns = d.connections
        .filter((c) => c.topicId === src.id && idMap[c.from] && idMap[c.to])
        .map((c) => ({ ...c, id: uid('c'), topicId: copy.id, from: idMap[c.from], to: idMap[c.to] }));
      return {
        ...d,
        topics,
        notes: [...d.notes, ...copiedNotes],
        connections: [...d.connections, ...copiedConns],
        activeTopicId: copy.id,
      };
    }
    case 'topic/delete': {
      const idx = d.topics.findIndex((t) => t.id === a.id);
      if (idx < 0) return d;
      const topics = d.topics.filter((t) => t.id !== a.id);
      let activeTopicId = d.activeTopicId;
      if (activeTopicId === a.id) activeTopicId = (topics[idx] || topics[idx - 1] || null)?.id ?? null;
      return {
        ...d,
        topics,
        notes: d.notes.filter((n) => n.topicId !== a.id),
        connections: d.connections.filter((c) => c.topicId !== a.id),
        activeTopicId,
      };
    }
    case 'topic/reorder': {
      const topics = [...d.topics];
      const from = topics.findIndex((t) => t.id === a.id);
      if (from < 0) return d;
      const [t] = topics.splice(from, 1);
      const to = clamp(a.to > from ? a.to - 1 : a.to, 0, topics.length);
      if (to === from) return d;
      topics.splice(to, 0, t);
      return { ...d, topics };
    }
    case 'topic/move': {
      // Move a topic into a group (or out of one) and place it before another topic.
      const t = d.topics.find((x) => x.id === a.id);
      if (!t) return d;
      const moved = { ...t };
      if (a.groupId) moved.groupId = a.groupId;
      else delete moved.groupId;
      const rest = d.topics.filter((x) => x.id !== a.id);
      const at = a.beforeId ? rest.findIndex((x) => x.id === a.beforeId) : -1;
      if (at >= 0) rest.splice(at, 0, moved);
      else rest.push(moved);
      return { ...d, topics: rest };
    }

    case 'group/add': {
      const g = { id: a.id, name: a.name || 'New Group', collapsed: false };
      const topics = a.topicId ? d.topics.map((t) => (t.id === a.topicId ? { ...t, groupId: a.id } : t)) : d.topics;
      return { ...d, groups: [...(d.groups || []), g], topics };
    }
    case 'group/rename': {
      const name = a.name.trim();
      if (!name) return d;
      return { ...d, groups: d.groups.map((g) => (g.id === a.id ? { ...g, name } : g)) };
    }
    case 'group/toggle':
      return { ...d, groups: d.groups.map((g) => (g.id === a.id ? { ...g, collapsed: !g.collapsed } : g)) };
    case 'group/delete':
      // Topics inside stay; they just leave the group.
      return {
        ...d,
        groups: d.groups.filter((g) => g.id !== a.id),
        topics: d.topics.map((t) => {
          if (t.groupId !== a.id) return t;
          const { groupId, ...rest } = t;
          return rest;
        }),
      };

    case 'topic/select':
      if (d.activeTopicId === a.id) return d;
      return { ...d, activeTopicId: a.id };
    case 'topic/share': {
      // The topic's share link ({ id, key, at }) or null. Not part of undo history.
      return {
        ...d,
        topics: d.topics.map((t) => {
          if (t.id !== a.id) return t;
          const { share: _old, ...rest } = t;
          return a.share ? { ...rest, share: a.share } : rest;
        }),
      };
    }
    case 'group/share': {
      // A folder's share link ({ id, key, at }) or null.
      return {
        ...d,
        groups: (d.groups || []).map((g) => {
          if (g.id !== a.id) return g;
          const { share: _old, ...rest } = g;
          return a.share ? { ...rest, share: a.share } : rest;
        }),
      };
    }
    case 'topic/view': {
      // View state (scroll / zoom) — not part of undo history.
      let changed = false;
      const topics = d.topics.map((t) => {
        if (t.id !== a.id) return t;
        for (const k in a.patch) if (t[k] !== a.patch[k]) changed = true;
        return changed ? { ...t, ...a.patch } : t;
      });
      return changed ? { ...d, topics } : d;
    }

    case 'note/add': {
      const z = maxZ(d.notes, a.note.topicId) + 1;
      return { ...d, notes: [...d.notes, { ...a.note, z }] };
    }
    case 'note/update': {
      let changed = false;
      const notes = d.notes.map((n) => {
        if (n.id !== a.id) return n;
        for (const k in a.patch) {
          if (n[k] !== a.patch[k]) {
            changed = true;
            break;
          }
        }
        if (!changed) return n;
        const touch = a.touch === false ? {} : { updatedAt: Date.now() };
        return { ...n, ...a.patch, ...touch };
      });
      return changed ? { ...d, notes } : d;
    }
    case 'note/updateMany': {
      const notes = d.notes.map((n) => (a.patches[n.id] ? { ...n, ...a.patches[n.id] } : n));
      return { ...d, notes };
    }
    case 'note/front': {
      const note = d.notes.find((n) => n.id === a.id);
      if (!note) return d;
      const top = maxZ(d.notes, note.topicId);
      if (note.z === top && d.notes.filter((n) => n.topicId === note.topicId && n.z === top).length === 1) return d;
      return { ...d, notes: d.notes.map((n) => (n.id === a.id ? { ...n, z: top + 1 } : n)) };
    }
    case 'note/delete': {
      const ids = new Set(Array.isArray(a.id) ? a.id : [a.id]);
      return {
        ...d,
        notes: d.notes.filter((n) => !ids.has(n.id)),
        connections: d.connections.filter((c) => !ids.has(c.from) && !ids.has(c.to)),
      };
    }
    case 'note/duplicate': {
      const src = d.notes.find((n) => n.id === a.id);
      if (!src) return d;
      const now = Date.now();
      const copy = {
        ...src,
        id: a.newId,
        x: src.x + 28,
        y: src.y + 28,
        rotation: a.rotation ?? src.rotation,
        z: maxZ(d.notes, src.topicId) + 1,
        reminder: null,
        createdAt: now,
        updatedAt: now,
      };
      return { ...d, notes: [...d.notes, copy] };
    }

    case 'conn/add': {
      if (a.from === a.to) return d;
      const exists = d.connections.some(
        (c) => (c.from === a.from && c.to === a.to) || (c.from === a.to && c.to === a.from),
      );
      if (exists) return d;
      return { ...d, connections: [...d.connections, { id: a.id, topicId: a.topicId, from: a.from, to: a.to }] };
    }
    case 'conn/delete':
      return { ...d, connections: d.connections.filter((c) => c.id !== a.id) };

    case 'settings':
      return { ...d, settings: { ...d.settings, ...a.patch } };

    default:
      return d;
  }
}

/* ------------------------------------------------------------------ */
/* History wrapper — snapshots of topics / notes / connections.        */
/* ------------------------------------------------------------------ */

const snapshot = (d) => ({ topics: d.topics, notes: d.notes, connections: d.connections, groups: d.groups });
const pushPast = (past, s) => {
  const next = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past.slice();
  next.push(s);
  return next;
};

function restore(d, s) {
  // Keep view state (scroll/zoom) of topics that still exist so undo doesn't jump the viewport.
  // (and its share link, which undo shouldn't take away)
  const view = Object.fromEntries(d.topics.map((t) => [t.id, { scrollTop: t.scrollTop, zoom: t.zoom, share: t.share }]));
  const topics = s.topics.map((t) => (view[t.id] ? { ...t, ...view[t.id] } : t));
  const activeTopicId = topics.some((t) => t.id === d.activeTopicId) ? d.activeTopicId : topics[0]?.id ?? null;
  return { ...d, topics, notes: s.notes, connections: s.connections, groups: s.groups ?? d.groups, activeTopicId };
}

function rootReducer(state, a) {
  switch (a.type) {
    case 'undo': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return {
        data: restore(state.data, prev),
        past: state.past.slice(0, -1),
        future: [snapshot(state.data), ...state.future].slice(0, HISTORY_LIMIT),
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { data: restore(state.data, next), past: pushPast(state.past, snapshot(state.data)), future: rest };
    }
    case 'checkpoint':
      return { ...state, past: pushPast(state.past, snapshot(state.data)), future: [] };
    case 'replace':
      // a.data is already normalized (see load / normalize callers).
      return { data: a.data, past: a.keepHistory ? state.past : [], future: a.keepHistory ? state.future : [] };
    default: {
      const data = dataReducer(state.data, a);
      if (data === state.data) return state;
      if (a.record) return { data, past: pushPast(state.past, snapshot(state.data)), future: [] };
      return { ...state, data };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function normalize(raw) {
  const topics = Array.isArray(raw?.topics) ? raw.topics.filter((t) => t && t.id) : [];
  const topicIds = new Set(topics.map((t) => t.id));
  const notes = Array.isArray(raw?.notes)
    ? raw.notes
        .filter((n) => n && n.id && topicIds.has(n.topicId))
        .map(({ pinned, ...n }) => {
          const body = String(n.body ?? '');
          // Keep only images the text still points at.
          const refs = imageRefs(body);
          const images = {};
          for (const id of refs) if (n.images?.[id]) images[id] = n.images[id];
          return {
            ...makeNote(n.topicId),
            ...n,
            title: String(n.title ?? ''),
            body,
            images,
            stickers: Array.isArray(n.stickers) ? n.stickers.filter((t) => t && t.id && t.emoji) : [],
            ink: cleanInk(n.ink),
            reminder: n.reminder && Number.isFinite(n.reminder.at) ? { at: n.reminder.at, fired: !!n.reminder.fired } : null,
          };
        })
    : [];
  const noteIds = new Set(notes.map((n) => n.id));
  const connections = Array.isArray(raw?.connections)
    ? raw.connections.filter((c) => c && noteIds.has(c.from) && noteIds.has(c.to))
    : [];
  const activeTopicId = topicIds.has(raw?.activeTopicId) ? raw.activeTopicId : topics[0]?.id ?? null;
  const groups = Array.isArray(raw?.groups)
    ? raw.groups
        .filter((g) => g && g.id)
        .map((g) => ({ id: g.id, name: String(g.name || 'Group'), collapsed: !!g.collapsed, ...(g.share ? { share: g.share } : {}) }))
    : [];
  const groupIds = new Set(groups.map((g) => g.id));
  return {
    version: 1,
    groups,
    topics: topics.map((t) => {
      const out = { scrollTop: 0, zoom: 1, ...t };
      if (out.groupId && !groupIds.has(out.groupId)) delete out.groupId;
      return out;
    }),
    notes,
    connections,
    activeTopicId,
    settings: { ...DEFAULT_SETTINGS, ...(raw?.settings || {}) },
  };
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — start fresh in memory */
  }
  if (raw) {
    try {
      return normalize(JSON.parse(raw));
    } catch {
      try {
        localStorage.setItem(`${STORAGE_KEY}:corrupt:${Date.now()}`, raw);
      } catch {
        /* ignore */
      }
    }
  }
  // First visit: a single topic with a welcome note, not the whole sample wall.
  return normalize(createStarterData());
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export { normalize };

export function freshSampleData() {
  return normalize(createSeedData());
}

export function emptyData(settings) {
  return normalize({ topics: [], notes: [], connections: [], settings });
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

/*
 * useStore()                      — the wall in this browser's localStorage (no account)
 * useStore({ initialData, persist, subscribe })
 *                                 — a signed-in wall: starts from initialData, hands every
 *                                   change to persist(data) (which encrypts and syncs it), and
 *                                   subscribe(fn) delivers newer versions from elsewhere.
 */
export function useStore({ initialData, persist, subscribe, dirty } = {}) {
  const [state, dispatch] = useReducer(rootReducer, undefined, () => ({
    data: initialData ? normalize(initialData) : load(),
    past: [],
    future: [],
  }));
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const write = (data) => (persistRef.current ? persistRef.current(data) : save(data));
  const latest = useRef(state.data);
  latest.current = state.data;
  // An opened wall that's already saved needn't be saved again until something changes.
  const lastSaved = useRef(initialData && !dirty ? state.data : null);

  // Debounced autosave.
  useEffect(() => {
    if (lastSaved.current === state.data) return undefined;
    const t = setTimeout(() => {
      write(state.data);
      lastSaved.current = state.data;
    }, 250);
    return () => clearTimeout(t);
  }, [state.data]);

  // Flush on tab hide / close so nothing typed is lost.
  useEffect(() => {
    const flush = () => {
      if (lastSaved.current !== latest.current) {
        write(latest.current);
        lastSaved.current = latest.current;
      }
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // A newer version from another device or tab (signed-in walls).
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((incoming) => {
      const data = normalize(incoming);
      lastSaved.current = data; // already saved where it came from — don't echo it back
      dispatch({ type: 'replace', data });
    });
  }, [subscribe]);

  // Keep multiple open tabs in sync (walls without an account).
  useEffect(() => {
    if (persist) return undefined;
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const data = normalize(JSON.parse(e.newValue));
        lastSaved.current = data; // already persisted by the other tab — don't echo it back
        dispatch({ type: 'replace', data });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    data: state.data,
    dispatch,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    getData: () => latest.current,
  };
}
