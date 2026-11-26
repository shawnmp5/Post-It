# POST IT

A freeform sticky-note wall for organizing your thoughts by topic.

Create a topic → open it → throw sticky notes onto its wall → organize your thoughts.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Accounts and encryption

- **Sign up first.** New visitors see Create Account (username and password) or Sign In. Usernames show as **@name**: at least 2 characters with at least one letter (letters, numbers, `.` and `_`), case-insensitive, first come first served — a name frees up when its owner changes it or deletes the account. Availability is checked as you type.
- **Account** (bottom-left of the sidebar): change username, change password, see encryption and save status, sign out, delete the account. **Settings** (⚙︎, top right) holds appearance, wallpaper, fonts and data tools.
- **End-to-end encrypted.** The browser stretches the password (PBKDF2-SHA256, 600k rounds, per-account salt) into a master secret that never leaves the device. From it come an auth key (the server stores only a scrypt hash of that) and a wrap key, which encrypts the account's random AES-256-GCM data key. The wall is encrypted with that data key before it's saved — on this device and on the server — so the server only ever holds ciphertext. Changing the password re-wraps the same key; other devices are signed out. **A forgotten password can't be recovered.**
- **Sync** (always on; the sidebar shows “Synced just now” in green, or Syncing… / Offline). Each account's wall follows it to any device; the newer edit wins and the other device catches up. *Sync now* in Account saves or fetches right away.
- **Sharing** (Share button top right, or Share… in a topic's ⋯ menu): **Copy link** makes a view-only link anyone can open without an account — the topic is encrypted with a key that lives only in the link (after the `#`, never sent to the server); copying again updates what they see; **Stop sharing** turns it off. Also **Download PDF** (A4, long walls split across pages), **Download image** (PNG) and **Copy as text**.
- **Where it lives.** `netlify/functions/api.mjs` (all of `/api/*`) with `netlify/lib/accounts.mjs`, stored in Netlify Blobs. Sessions are HttpOnly cookies; sign-in locks for a few minutes after repeated wrong passwords. A strict Content Security Policy keeps any other code off the page. `npm run dev` runs the same API in memory; where there's no server at all (a static preview) accounts fall back to this browser only.
- Notes made before accounts existed move into the first account created on that device, and the old unencrypted copy is removed.

## What it does

**Topics (sidebar)**
- Floating glass sidebar (hide it with its button or Ctrl/⌘+\\); the wall runs edge to edge under a floating title, a glass toolbar (search + view) and a bottom dock (undo/redo, zoom, New Note)
- Groups: the folder+ button → New Group; drag topics into a group or use a topic's ⋯ → Move to. Click a group to collapse it; its ⋯ menu adds a topic, renames or removes the group (topics are kept)
- Unlimited topics with live note counts and a tiny swatch of each topic's most-used color
- Hover a topic for its ⋯ menu: Rename, Duplicate (copies every note and connection), Delete (with confirm + undo)
- Drag topics to reorder them (long-press on touch screens); double-click to rename
- Drag the sidebar's right edge to make it wider or narrower (double-click the edge to reset)
- Clear interface (Settings): no panels or lines — just type and icons over the wall; applies live
- Rain wallpaper (Settings → Wallpaper): heavy rain behind a fogged-up window; beads on the glass swell, run down and merge. An evening sky in dark mode, deep night with the moon behind cloud in extra dark, and an overcast afternoon in light mode. A still frame with reduced motion
- Rain sound (Settings, or the speaker button in the toolbar): built from thousands of individual drops — a soft, dense patter, splashes and a few heavier drops on the glass — over a soft wash of distant rain with gusts and a little outdoor reverb. Generated in the browser, no audio files; volume slider
- Lightning (on by default with the rain wallpaper): flickering flashes, near strikes show a forked bolt; with the sound on, thunder rolls in a moment later — sooner and louder for close strikes. Off with reduced motion
- City skyline (with the rain wallpaper): towers across a river, layered into the haze and a little out of focus behind the wet glass, windows lit and glowing, the whole skyline mirrored and wavering in the water. Along the waterfront a stream of traffic glows past, headlights one way and tail lights the other, braking in waves, now and then a bus. Windows switch on and off, a TV flickers, tower crowns slowly change colour, red beacons blink on the tallest roofs, a plane crosses now and then, a lamp on the waterfront is failing. Evening in dark mode, late night in extra dark, a grey rainy afternoon in light mode. With the rain sound on, cars swish along the road
- Starred bullets: click a bullet's dot to star it (gold star, bold text); click again to unstar. Saved in the note as `- ★ item`
- Auto caps (Settings, on by default): capitalises the first letter of a note, title, line or sentence as you type, and a lone "i". Never inside code blocks
- Appearance: Light, graphite Dark, Extra dark (near black), or Auto (follows the system) — in Settings, or View → Dark mode
- New topics: the + beside the Topics heading or the “New Topic” row at the end of the list; “New Group” sits right under it
- Settings (⚙︎ top right): new note color (Random by default, or a fixed colour), note font (clean: System, Rounded, Serif, Mono; handwritten: Caveat, Kalam, Patrick Hand, Gochi Hand), tilt and connection toggles, export / import JSON, restore samples, clear all

**The wall (workspace)**
- Freeform placement — grab a note by its tape and drop it anywhere, no grid snapping; the wall grows downward as you go
- Notes are a little block editor: type `\` for the block menu (Text, Heading 1–3, Bullets, Numbers, Checklist, Quote, Table, Image, Code, Divider, Today's date), or type the shortcuts `#`, `-`, `1.`, `[]`, `>`, ` ``` `, `---` at the start of a line
- Checklists: click a box (even without opening the note) to cross the item out; a progress bar tracks each list, and finishing one gets a little confetti burst
- Tables: Tab / Enter move between cells (and add rows at the end); the toolbar under a focused table adds or removes rows and columns
- Images: drag one to move it between lines and drop it left, centre or right; drag a corner to resize it like a note. Works on the wall too
- Enter continues a list, Enter on an empty item ends it, Backspace at the start turns a block back into text; paste an image to add it
- Click a note to edit it right where you clicked; click outside (or press Esc) to finish
- Resize from any side (left/right = width, top/bottom = height) or any corner (diagonal) — no frame or handles, just the resize cursor. Notes never cut off their content: making one shorter shrinks its pictures to fit; ⋯ menu → *Fit height to text* returns to auto height
- 8 muted colors, slight tilt (adjustable per note, or turn off globally), duplicate, archive, delete
- Reminders: the bell button on a note (or ⋯ → Remind me…) (this evening, tomorrow, this weekend, next week, or any date & time). A bell chip shows on the note; when it's due the chip turns red, you get an in-app alert with Open (and a system notification if allowed); ✓ marks it done. Upcoming reminders are listed in Search
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

Everything — topics, note text, colors, positions, sizes, rotations, archive, connections, per-topic zoom and scroll position, and settings — is saved automatically, encrypted, to this browser (`postit:wall:<account id>`) and to the account, and kept in step between open tabs and devices. A new visitor starts with one topic (“My Notes”) holding a short welcome note; the full sample wall can be loaded from Settings → Samples. Both are ordinary data and can be edited or deleted.

## Code map

```
src/
  store.js              state, reducer, undo/redo history, localStorage persistence
  seed.js               first-launch starter (one topic, one note) and the optional sample wall
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
