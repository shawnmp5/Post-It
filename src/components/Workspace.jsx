import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board.jsx';
import { Popover, MenuItem, MenuSep, MenuLabel } from './Popover.jsx';
import { COLORS, COLOR_MAP, ZOOM_MAX, ZOOM_MIN } from '../store.js';
import { plainText } from '../blocks.js';
import { formatWhen } from './Reminders.jsx';
import {
  IconSearch,
  IconSliders,
  IconPlus,
  IconMenu,
  IconUndo,
  IconRedo,
  IconMinus,
  IconClose,
  IconArchive,
  IconTidy,
  IconFit,
  IconLink,
  IconRestore,
  IconRotateRight,
  IconTrash,
} from './Icons.jsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

export function Workspace({ data, dispatch, toast, canUndo, canRedo, isMobile, onOpenDrawer, onCreateTopic, focusNote }) {
  const topic = data.topics.find((t) => t.id === data.activeTopicId) || null;
  const boardRef = useRef(null);
  const searchBtn = useRef(null);
  const viewBtn = useRef(null);
  const [panel, setPanel] = useState(null); // 'search' | 'view' | 'archive'
  const [query, setQuery] = useState('');
  const [colors, setColors] = useState([]);
  const [zoom, setZoomState] = useState(topic?.zoom || 1);
  const [renaming, setRenaming] = useState(false);

  const topicNotes = useMemo(() => (topic ? data.notes.filter((n) => n.topicId === topic.id) : []), [data.notes, topic]);
  const topicConns = useMemo(
    () => (topic ? data.connections.filter((c) => c.topicId === topic.id) : []),
    [data.connections, topic],
  );
  const active = topicNotes.filter((n) => !n.archived);
  const archived = topicNotes.filter((n) => n.archived).sort((a, b) => b.updatedAt - a.updatedAt);
  const reminders = active.filter((n) => n.reminder).sort((a, b) => a.reminder.at - b.reminder.at);

  // Jump to a note (e.g. from a reminder) once its topic's wall is showing.
  const handledFocus = useRef(null);
  useEffect(() => {
    if (!focusNote || handledFocus.current === focusNote.token) return undefined;
    const target = data.notes.find((n) => n.id === focusNote.id);
    if (!target || target.topicId !== topic?.id) return undefined;
    handledFocus.current = focusNote.token;
    const t = setTimeout(() => boardRef.current?.scrollToNote(focusNote.id), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNote, topic?.id]);

  // Reset search when switching topics.
  useEffect(() => {
    setQuery('');
    setColors([]);
    setPanel(null);
    setRenaming(false);
  }, [topic?.id]);

  const closePanel = useCallback(() => setPanel(null), []);
  const closeSearch = useCallback(() => setPanel((p) => (p === 'search' ? null : p)), []);
  const filter = useMemo(() => ({ query, colors }), [query, colors]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    const ok = (n) =>
      (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) &&
      (!colors.length || colors.includes(n.color));
    const list = topicNotes.filter(ok);
    const score = (n) => (n.title.toLowerCase().includes(q) ? 0 : 1);
    list.sort((a, b) => (q ? score(a) - score(b) : 0) || b.updatedAt - a.updatedAt);
    return { live: list.filter((n) => !n.archived), archived: list.filter((n) => n.archived) };
  }, [topicNotes, q, colors]);

  const addNote = useCallback(() => boardRef.current?.addNote(), []);

  // Global shortcuts for the workspace.
  useEffect(() => {
    const onKey = (e) => {
      const typing = (() => {
        const el = document.activeElement;
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      })();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (!topic) return;
      if ((mod && k === 'n' && !e.shiftKey) || (!mod && !typing && !e.altKey && k === 'n')) {
        e.preventDefault();
        addNote();
      } else if ((mod && k === 'k') || (!typing && !mod && e.key === '/')) {
        e.preventDefault();
        setPanel('search');
      } else if (!typing && !mod && (e.key === '+' || e.key === '=')) {
        boardRef.current?.setZoom(boardRef.current.getZoom() + 0.1);
      } else if (!typing && !mod && (e.key === '-' || e.key === '_')) {
        boardRef.current?.setZoom(boardRef.current.getZoom() - 0.1);
      } else if (!typing && !mod && e.key === '0') {
        boardRef.current?.setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNote, topic]);

  if (!topic) {
    return (
      <main className="workspace">
        {isMobile && (
          <header className="ws-header">
            <button type="button" className="icon-btn" onClick={onOpenDrawer} aria-label="Open topics">
              <IconMenu />
            </button>
          </header>
        )}
        <div className="board-scroll">
          <div className="board-empty">
            <div className="board-empty-stack" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="board-empty-title">No topics yet</p>
            <p className="board-empty-sub">Create a topic, then throw sticky notes onto its wall.</p>
            <button type="button" className="btn btn-primary" onClick={onCreateTopic}>
              New topic
            </button>
          </div>
        </div>
      </main>
    );
  }

  const zoomBy = (d) => boardRef.current?.setZoom(Math.round((zoom + d) * 10) / 10);

  return (
    <main className="workspace">
      <header className="ws-header">
        {isMobile && (
          <button type="button" className="icon-btn menu-btn" onClick={onOpenDrawer} aria-label="Open topics">
            <IconMenu />
          </button>
        )}
        <div className="ws-title-wrap">
          {renaming ? (
            <input
              className="ws-title ws-title-input"
              defaultValue={topic.name}
              autoFocus
              maxLength={60}
              aria-label="Topic name"
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                setRenaming(false);
                if (e.target.value.trim() && e.target.value.trim() !== topic.name)
                  dispatch({ type: 'topic/rename', id: topic.id, name: e.target.value, record: true });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = topic.name;
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <h1 className="ws-title" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {topic.name}
            </h1>
          )}
          <p className="ws-sub">
            All your thoughts in one place.
            <span className="ws-meta">
              {' '}
              · {active.length} note{active.length === 1 ? '' : 's'}
            </span>
          </p>
        </div>

        <div className="ws-actions">
          <button
            ref={searchBtn}
            type="button"
            className={`icon-btn ${panel === 'search' || q || colors.length ? 'is-active' : ''}`}
            onClick={() => setPanel(panel === 'search' ? null : 'search')}
            title={`Search notes (${MOD}+K)`}
            aria-label="Search notes"
          >
            <IconSearch />
            {(q || colors.length > 0) && <span className="dot" />}
          </button>
          <button
            ref={viewBtn}
            type="button"
            className={`icon-btn ${panel === 'view' || panel === 'archive' ? 'is-active' : ''}`}
            onClick={() => setPanel(panel === 'view' ? null : 'view')}
            title="View options"
            aria-label="View options"
          >
            <IconSliders />
          </button>
          <button type="button" className="btn btn-primary new-note-btn" onClick={addNote} title="New note (N)">
            <IconPlus />
            <span className="new-note-label">New note</span>
          </button>
        </div>
      </header>

      <div className="ws-body">
      <Board
        key={topic.id}
        ref={boardRef}
        topic={topic}
        notes={topicNotes}
        connections={topicConns}
        settings={data.settings}
        dispatch={dispatch}
        toast={toast}
        filter={filter}
        isMobile={isMobile}
        onZoomChange={setZoomState}
      />

      {(q || colors.length > 0) && panel !== 'search' && (
        <div className="filter-bar">
          <span>
            Showing {results.live.length} of {active.length}
            {q && (
              <>
                {' '}
                matching <strong>“{query.trim()}”</strong>
              </>
            )}
            {colors.length > 0 && <> in {colors.map((c) => COLOR_MAP[c].name.toLowerCase()).join(', ')}</>}
          </span>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setQuery('');
              setColors([]);
            }}
          >
            Clear
          </button>
        </div>
      )}


      <div className="floating-controls" role="toolbar" aria-label="Canvas controls">
        <button
          type="button"
          className="icon-btn"
          onClick={() => dispatch({ type: 'undo' })}
          disabled={!canUndo}
          title={`Undo (${MOD}+Z)`}
          aria-label="Undo"
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => dispatch({ type: 'redo' })}
          disabled={!canRedo}
          title={`Redo (${MOD}+Shift+Z)`}
          aria-label="Redo"
        >
          <IconRedo />
        </button>
        <span className="fc-sep" />
        <button type="button" className="icon-btn" onClick={() => zoomBy(-0.1)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out (−)">
          <IconMinus />
        </button>
        <button type="button" className="zoom-value" onClick={() => boardRef.current?.setZoom(1)} title="Reset zoom (0)">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="icon-btn" onClick={() => zoomBy(0.1)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in (+)">
          <IconPlus />
        </button>
      </div>
      </div>

      {panel === 'search' && (
        <Popover anchor={searchBtn.current} onClose={closeSearch} align="end" className="panel search-panel" closeOnScroll={false}>
          <div className="search-field">
            <IconSearch />
            <input
              autoFocus
              value={query}
              placeholder={`Search ${topic.name}…`}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results.live[0]) {
                  boardRef.current?.scrollToNote(results.live[0].id);
                }
              }}
              aria-label="Search notes"
            />
            {(query || colors.length > 0) && (
              <button
                type="button"
                className="icon-btn small"
                onClick={() => {
                  setQuery('');
                  setColors([]);
                }}
                aria-label="Clear search"
              >
                <IconClose />
              </button>
            )}
          </div>
          <div className="color-filter" role="group" aria-label="Filter by color">
            {COLORS.map((c) => {
              const on = colors.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`swatch small ${on ? 'is-active' : ''}`}
                  style={{ '--swatch': c.bg, '--swatch-edge': c.edge }}
                  title={`Only ${c.name.toLowerCase()} notes`}
                  aria-label={`Filter ${c.name}`}
                  aria-pressed={on}
                  onClick={() => setColors(on ? colors.filter((x) => x !== c.id) : [...colors, c.id])}
                />
              );
            })}
          </div>
          <div className="results">
            {!q && !colors.length && reminders.length > 0 && (
              <>
                <div className="results-label">Reminders</div>
                {reminders.map((n) => (
                  <ResultRow
                    key={n.id}
                    note={n}
                    query=""
                    meta={`${n.reminder.at <= Date.now() ? 'Due · ' : ''}${formatWhen(n.reminder.at)}`}
                    due={n.reminder.at <= Date.now()}
                    onClick={() => boardRef.current?.scrollToNote(n.id)}
                  />
                ))}
              </>
            )}
            {!q && !colors.length && reminders.length === 0 && (
              <div className="results-empty">
                Type to search titles and text in this topic, or pick a color. Notes with reminders show up here.
              </div>
            )}
            {(q || colors.length > 0) && results.live.length === 0 && results.archived.length === 0 && (
              <div className="results-empty">No notes match.</div>
            )}
            {(q || colors.length ? results.live : []).map((n) => (
              <ResultRow key={n.id} note={n} query={q} onClick={() => boardRef.current?.scrollToNote(n.id)} />
            ))}
            {(q || colors.length > 0) && results.archived.length > 0 && (
              <>
                <div className="results-label">In archive</div>
                {results.archived.map((n) => (
                  <ResultRow
                    key={n.id}
                    note={n}
                    query={q}
                    archived
                    onClick={() => {
                      dispatch({ type: 'note/update', id: n.id, patch: { archived: false }, touch: false, record: true });
                      toast('Restored from archive', { undo: true });
                      setTimeout(() => boardRef.current?.scrollToNote(n.id), 50);
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </Popover>
      )}

      {panel === 'view' && (
        <Popover anchor={viewBtn.current} onClose={closePanel} align="end" className="menu view-menu">
          <MenuLabel>Zoom</MenuLabel>
          <div className="menu-row zoom-row">
            <div className="seg wide">
              <button type="button" onClick={() => zoomBy(-0.1)} aria-label="Zoom out" disabled={zoom <= ZOOM_MIN}>
                <IconMinus />
              </button>
              <button type="button" className="seg-value" onClick={() => boardRef.current?.setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={() => zoomBy(0.1)} aria-label="Zoom in" disabled={zoom >= ZOOM_MAX}>
                <IconPlus />
              </button>
            </div>
          </div>
          <MenuItem
            icon={IconFit}
            onClick={() => {
              boardRef.current?.fit();
              setPanel(null);
            }}
          >
            Zoom to fit
          </MenuItem>
          <MenuItem
            icon={IconTidy}
            onClick={() => {
              boardRef.current?.tidy();
              setPanel(null);
            }}
            disabled={!active.length}
          >
            Tidy up notes
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon={IconRotateRight}
            checked={data.settings.tilt}
            onClick={() => dispatch({ type: 'settings', patch: { tilt: !data.settings.tilt } })}
          >
            Tilted notes
          </MenuItem>
          <MenuItem
            icon={IconLink}
            checked={data.settings.showConnections}
            onClick={() => dispatch({ type: 'settings', patch: { showConnections: !data.settings.showConnections } })}
          >
            Show connections
          </MenuItem>
          <MenuSep />
          <MenuItem icon={IconArchive} onClick={() => setPanel('archive')} hint={archived.length || ''}>
            Archived notes
          </MenuItem>
          <div className="menu-foot shortcuts">
            <span>
              <kbd>N</kbd> new note
            </span>
            <span>
              <kbd>/</kbd> search
            </span>
            <span>
              <kbd>{MOD}</kbd>
              <kbd>Z</kbd> undo
            </span>
            <span>Double-click wall to add</span>
          </div>
        </Popover>
      )}

      {panel === 'archive' && (
        <Popover anchor={viewBtn.current} onClose={closePanel} align="end" className="panel archive-panel" closeOnScroll={false}>
          <div className="panel-head">
            <span>Archive</span>
            <span className="panel-count">{archived.length}</span>
          </div>
          <div className="results">
            {archived.length === 0 && (
              <div className="results-empty">Archived notes are hidden from the wall but kept here, safe.</div>
            )}
            {archived.map((n) => (
              <div key={n.id} className="archive-row">
                <span className="result-swatch" style={{ background: COLOR_MAP[n.color]?.bg }} />
                <span className="result-text">
                  <span className="result-title">{n.title || firstLine(n.body) || 'Untitled'}</span>
                  {n.title && n.body && <span className="result-snippet">{firstLine(n.body)}</span>}
                </span>
                <button
                  type="button"
                  className="icon-btn small"
                  title="Restore to wall"
                  aria-label="Restore to wall"
                  onClick={() => {
                    dispatch({ type: 'note/update', id: n.id, patch: { archived: false }, touch: false, record: true });
                    toast('Restored to the wall', { undo: true });
                  }}
                >
                  <IconRestore />
                </button>
                <button
                  type="button"
                  className="icon-btn small danger"
                  title="Delete forever"
                  aria-label="Delete forever"
                  onClick={() => {
                    dispatch({ type: 'note/delete', id: n.id, record: true });
                    toast('Note deleted', { undo: true });
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </main>
  );
}

const firstLine = (s) => plainText(s).split('\n').find((l) => l.trim()) || '';

function snippet(n, q) {
  const body = plainText(n.body).replace(/\s+/g, ' ').trim();
  if (!q) return body.slice(0, 80);
  const i = body.toLowerCase().indexOf(q);
  if (i < 0) return body.slice(0, 80);
  const start = Math.max(0, i - 24);
  return `${start > 0 ? '…' : ''}${body.slice(start, start + 80)}`;
}

function Mark({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function ResultRow({ note, query, onClick, archived, meta, due }) {
  const title = note.title || firstLine(note.body) || 'Untitled';
  const snip = meta ?? (note.title ? snippet(note, query) : '');
  return (
    <button type="button" className="result-row" onClick={onClick}>
      <span className="result-swatch" style={{ background: COLOR_MAP[note.color]?.bg }} />
      <span className="result-text">
        <span className="result-title">
          <Mark text={title} q={query} />
        </span>
        {snip && (
          <span className={`result-snippet ${due ? 'is-due' : ''}`}>
            <Mark text={snip} q={query} />
          </span>
        )}
      </span>
      {archived && <span className="result-tag">Restore</span>}
    </button>
  );
}
