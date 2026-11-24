import { useRef } from 'react';
import { COLORS, FONTS, emptyData, freshSampleData, normalize } from '../store.js';
import { IconDownload, IconUpload, IconRestore, IconTrash } from './Icons.jsx';

export function SettingsPanel({ data, dispatch, toast, confirm, onDone }) {
  const { settings } = data;
  const fileRef = useRef(null);
  const set = (patch) => dispatch({ type: 'settings', patch });

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `post-it-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported your workspace');
  };

  const importData = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed?.topics) || !Array.isArray(parsed?.notes)) throw new Error('bad file');
      const ok = await confirm({
        title: 'Replace your workspace?',
        message: `This replaces everything with ${parsed.topics.length} topics and ${parsed.notes.length} notes from “${file.name}”.`,
        confirmLabel: 'Import',
      });
      if (!ok) return;
      dispatch({ type: 'checkpoint' });
      dispatch({ type: 'replace', data: normalize(parsed), keepHistory: true });
      onDone();
      toast('Workspace imported', { undo: true });
    } catch {
      toast('That file isn’t a POST IT export');
    }
  };

  const loadSamples = async () => {
    const ok = await confirm({
      title: 'Restore sample topics?',
      message: 'Your current topics and notes will be replaced with the sample wall.',
      confirmLabel: 'Restore samples',
    });
    if (!ok) return;
    dispatch({ type: 'checkpoint' });
    dispatch({ type: 'replace', data: { ...freshSampleData(), settings }, keepHistory: true });
    onDone();
    toast('Sample topics restored', { undo: true });
  };

  const clearAll = async () => {
    const ok = await confirm({
      title: 'Start with an empty wall?',
      message: 'All topics and notes will be removed from this device.',
      confirmLabel: 'Clear everything',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'checkpoint' });
    dispatch({ type: 'replace', data: emptyData(settings), keepHistory: true });
    onDone();
    toast('Workspace cleared', { undo: true });
  };

  return (
    <div className="settings">
      <label className="field">
        <span className="field-label">Your name</span>
        <input
          className="text-input"
          value={settings.userName}
          placeholder="You"
          maxLength={40}
          onChange={(e) => set({ userName: e.target.value })}
        />
      </label>

      <div className="field">
        <span className="field-label">New note color</span>
        <div className="swatches">
          <button
            type="button"
            className={`swatch is-random ${(settings.newNoteColor ?? 'random') === 'random' ? 'is-active' : ''}`}
            title="Random"
            aria-label="Random colour"
            onClick={() => set({ newNoteColor: 'random' })}
          />
          {COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`swatch ${settings.newNoteColor === c.id ? 'is-active' : ''}`}
              style={{ '--swatch': c.bg, '--swatch-edge': c.edge }}
              title={c.name}
              aria-label={c.name}
              onClick={() => set({ newNoteColor: c.id })}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Appearance</span>
        <div className="seg wide appearance" role="radiogroup" aria-label="Appearance">
          {[
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['system', 'Auto'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={(settings.theme || 'light') === id}
              className={(settings.theme || 'light') === id ? 'seg-value' : ''}
              onClick={() => set({ theme: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Wallpaper</span>
        <div className="seg wide wallpaper-seg" role="radiogroup" aria-label="Wallpaper">
          {[
            ['none', 'None'],
            ['rain', 'Rain'],
          ].map(([id, label]) => {
            const on = (settings.wallpaper === 'rain' ? 'rain' : 'none') === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? 'seg-value' : ''}
                onClick={() => set({ wallpaper: id })}
              >
                {label}
              </button>
            );
          })}
        </div>
        <Toggle checked={!!settings.clearUI} onChange={(v) => set({ clearUI: v })} label="Clear interface" />
      </div>

      <div className="field">
        <span className="field-label">Note font</span>
        {['Clean', 'Handwritten'].map((group) => (
          <div key={group} className="font-group">
            <span className="font-group-label">{group}</span>
            <div className="font-grid" role="radiogroup" aria-label={`${group} fonts`}>
              {FONTS.filter((f) => f.group === group).map((f) => {
                const on = (settings.noteFont || 'clean') === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`font-tile ${on ? 'is-active' : ''}`}
                    onClick={() => set({ noteFont: f.id })}
                  >
                    <span
                      className="font-sample"
                      style={{ fontFamily: f.family, fontSize: `${14 * f.scale}px`, fontWeight: f.titleWeight }}
                    >
                      Aa
                    </span>
                    <span className="font-name">{f.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="field">
        <Toggle checked={settings.tilt} onChange={(v) => set({ tilt: v })} label="Tilted notes" />
        <Toggle
          checked={settings.showConnections}
          onChange={(v) => set({ showConnections: v })}
          label="Show connections"
        />
      </div>

      <div className="settings-actions">
        <button type="button" className="text-btn" onClick={exportData}>
          <IconDownload /> Export
        </button>
        <button type="button" className="text-btn" onClick={() => fileRef.current?.click()}>
          <IconUpload /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) importData(f);
          }}
        />
      </div>
      <div className="settings-actions">
        <button type="button" className="text-btn" onClick={loadSamples}>
          <IconRestore /> Samples
        </button>
        <button type="button" className="text-btn is-danger" onClick={clearAll}>
          <IconTrash /> Clear all
        </button>
      </div>
      <p className="settings-foot">Everything saves automatically to this browser.</p>
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}
