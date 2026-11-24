# POST IT

A freeform sticky-note wall for organizing your thoughts by topic.

Create a topic → open it → throw sticky notes onto its wall → organize your thoughts.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## What it does

**Topics (sidebar)**
- Unlimited topics with live note counts and a tiny swatch of each topic's most-used color
- Hover a topic for its ⋯ menu: Rename, Duplicate (copies every note and connection), Delete (with confirm + undo)
- Drag topics to reorder them (long-press on touch screens); double-click to rename
- Drag the sidebar's right edge to make it wider or narrower (double-click the edge to reset)
- Profile / settings at the bottom: your name, default note color, note font (clean: System, Rounded, Serif, Mono; handwritten: Caveat, Kalam, Patrick Hand, Gochi Hand), tilt and connection toggles, export / import JSON, restore samples, clear all

**The wall (workspace)**
- Freeform placement — grab a note by its tape and drop it anywhere, no grid snapping; the wall grows downward as you go
- Notes are a little block editor: type `\` for the block menu (Text, Heading 1–3, Bullets, Numbers, Checklist, Quote, Table, Image, Code, Divider, Today's date), or type the shortcuts `#`, `-`, `1.`, `[]`, `>`, ` ``` `, `---` at the start of a line
- Checklists: click a box (even without opening the note) to cross the item out; a progress bar tracks each list
- Tables: Tab / Enter move between cells (and add rows at the end); the toolbar under a focused table adds or removes rows and columns
- Images: hover and drag either side handle to resize (works on the wall too)
- Enter continues a list, Enter on an empty item ends it, Backspace at the start turns a block back into text; paste an image to add it
- Click a note to edit it right where you clicked; click outside (or press Esc) to finish
- Drag any corner to resize diagonally (no frame or handles, just the resize cursor). A resized note keeps at least that size and always grows to fit its content, so nothing is cut off; ⋯ menu → *Fit height to text* returns to auto height
- 8 muted colors, slight tilt (adjustable per note, or turn off globally), duplicate, archive, delete
- Stickers: the smiley button on a note (or ⋯ → Add sticker…) slaps on a reaction — 👍 👎 ❤️ 😂 🔥 🎉 ⭐ ✅ 🚀 and more. Drag stickers anywhere on the note; hover and hit × to peel one off
- Connect two related notes with a line (⋯ → *Connect to note…*); click a line to remove it
- Search titles and text in the current topic, filter by color; matching notes are highlighted on the wall
- Archive keeps notes off the wall without deleting them (View → *Archived notes*)
- Zoom (buttons, `+` / `-` / `0`, or Ctrl/⌘ + scroll), *Zoom to fit*, and *Tidy up* to neatly re-arrange
- Undo / redo for every note and topic action
- Drag empty space to pan; double-click empty space to drop a new note there

**Keyboard**

| Key | Action |
| --- | --- |
| `N` (or Ctrl/⌘ + N where the browser allows it) | New note |
| `/` or Ctrl/⌘ + K | Search |
| Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z | Undo, redo |
| `Enter` on a selected note | Edit it |
| `Delete` / `Backspace` on a selected note | Delete (undoable) |
| Arrow keys (Shift for bigger steps) | Nudge the selected note |
| `Esc` | Finish editing / cancel / deselect |

## Persistence

Everything — topics, note text, colors, positions, sizes, rotations, archive, connections, per-topic zoom and scroll position, and settings — is saved automatically to `localStorage` (key `postit:v1`) and synced between open tabs. The sample topics shown on first launch are ordinary data and can be edited or deleted.

## Code map

```
src/
  store.js              state, reducer, undo/redo history, localStorage persistence
  seed.js               sample topics and notes for first launch
  blocks.js             note text <-> blocks, block menu commands, images
  App.jsx               layout, toasts, confirm dialog, global undo shortcuts
  components/
    Sidebar.jsx         topic list, reorder, rename/duplicate/delete, profile
    SettingsPanel.jsx   settings popover
    Workspace.jsx       header, search, view menu, archive, canvas controls
    Board.jsx           the canvas: drag, resize, pan, zoom, connections, placement
    Note.jsx            a single sticky note
    NoteBlocks.jsx      the note block editor and its read view
    SlashMenu.jsx       the \ block menu
    NoteMenu.jsx        per-note ⋯ menu
    Stickers.jsx        reaction stickers and the sticker picker
    Popover.jsx         anchored popovers and menu items
```
