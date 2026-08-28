# Fit Log

A personal workout tracker — lifting goals, running, and WFH-day bodyweight
work — built as a single small web app installed to a phone's home screen (a
"Progressive Web App," or PWA). There is no backend, no account, no build
step, and no third-party dependencies. It is four files of plain HTML, CSS,
and JavaScript, and all data lives in the browser's on-device storage.

This document is a map of the codebase and a reference for extending it. The
"map" comment at the top of `js/app.js` covers the same ground at the code
level — section names in reading order, one line each — for jumping directly
to a piece of logic.

## Design constraints this codebase is built around

Two constraints shape everything below:

1. **Data survives updates.** New features must be addable without ever
   resetting or discarding previously logged data.
2. **The code stays easy to return to** — organized, commented, and with all
   colors and visual design kept in exactly one place (`css/styles.css`)
   instead of scattered through markup and JavaScript.

The rest of this guide explains how both are enforced structurally, not just
followed by convention.

## What's in each file

| File | What it's for |
|---|---|
| `index.html` | Page structure — every screen's HTML skeleton (empty containers that `app.js` fills with real content), with no colors or visual styling in it at all. |
| `css/styles.css` | Every visual decision: colors, spacing, corner radii, fonts, the light/dark theme. The one file to open to restyle anything. |
| `js/app.js` | All app behavior: data model, persistence, and the HTML-building logic for every screen. The application's core. |
| `js/charts.js` | The two chart-drawing functions (the sparkline on a dashboard card, and the larger trend chart in a goal's detail view). Kept separate as a self-contained, reusable unit. |
| `manifest.json` | Tells the OS how to install this as an app — its name, icon, and colors for the OS-level splash screen/status bar. |
| `sw.js` | The service worker — a background script that caches the app's files so it still opens without a network connection. |
| `icons/` | The home-screen icon, in the sizes Android/iOS require. |

Nothing here talks to a server. Deploying this app means putting these files
somewhere with a public HTTPS URL (currently GitHub Pages); there is no
backend to keep running.

## How the app runs

Opening `index.html` triggers, in order:

1. The browser loads `css/styles.css` (styling), then `js/charts.js` and
   `js/app.js` (behavior) — in that order, because `app.js` calls functions
   `charts.js` defines.
2. The last line of `app.js` waits for the page to finish loading, then
   calls `init()`, which loads saved data from `localStorage` (or creates
   starter data on a first run), applies the current theme, wires up every
   button/tab/form to its handler function, and renders the current screen.
3. From there, the same loop drives every interaction: **an interaction
   (tapping Save, flipping a toggle) → a handler updates the in-memory data
   → it calls `save()` → it calls whichever `render...()` function(s) redraw
   what changed.** There is no framework underneath this — it is the same
   plain pattern repeated for every screen.

`js/app.js` opens with a long comment naming every section of the file in
reading order with a one-line description of each — searching a section's
name (e.g. "Rendering: Dashboard") jumps straight to it.

## Where data lives, and why it survives updates

Everything logged is one JSON object, saved under a fixed key in the
browser's `localStorage`. Nothing is ever transmitted anywhere — it is local
to that one browser, on that one device, for that one installed site.

That object carries a `version` number. Whenever a feature requires the data
to carry something new (an earlier update added `section` and `bodyRegion`
to exercises, for instance), rather than just changing what old data means,
the app adds a **migration**: a small function in `js/app.js` (see
`MIGRATIONS`) that takes an older save file and adds the new field with a
sensible default — never deleting or renaming anything an older version
wrote. Every time the app opens, it walks saved data forward through any
migrations it has not yet applied. A backup file exported from Settings goes
through the identical process on import, so a backup taken months ago still
loads correctly after the app has changed underneath it.

**The rule for any change that touches the data shape:** bump
`SCHEMA_VERSION` by one, add a new entry to `MIGRATIONS`, and inside it only
ever *add* fields with defaults — never remove, rename, or repurpose an
existing one. The comment block above `SCHEMA_VERSION` in `js/app.js` spells
this out in more detail, at the point where the change would be made.

This is also why the internal storage key (`STORAGE_KEY = 'liftlog.v1'`)
still reads "liftlog" even though the app is named Fit Log — it is never
displayed, it is just the name of the drawer the data sits in, and renaming
it would make the app look in a new, empty drawer. Cosmetic renames
(this one included) intentionally never touch it.

## JavaScript vocabulary used throughout `app.js`

- **variable** — a named box holding a value, declared with `const` (cannot
  be reassigned) or `let` (can be). Nearly everything in this file is `const`.
- **function** — a named, reusable block of instructions, e.g.
  `function fmtWeight(lb) { ... }`. `functionName(argument)` calls (runs) one.
- **object** (`{ key: value, ... }`) — a bundle of named fields, like a small
  form. An exercise is an object: `{ name: 'Bench Press', goal: 225, ... }`.
- **array** (`[item, item, ...]`) — an ordered list. `state.exercises` is an
  array of exercise objects.
- **arrow function** (`(x) => x * 2`) — a compact way to write a small
  function, used throughout for one-line operations like "for each exercise,
  do this."
- **template literal** (backtick-quoted strings with `${...}` inside) — a
  string that embeds a value directly, e.g. `` `Try ${weight} lb` `` instead
  of concatenating pieces with `+`.
- **DOM / element** — the DOM is the browser's live model of the page;
  `document.getElementById('exerciseCards')` fetches one specific HTML
  element from it so JavaScript can read or change it.
- **event listener** — `button.addEventListener('click', () => { ... })`
  registers "when this is clicked, run this."
- **localStorage** — a small on-device key/value store the browser provides
  every website; the only place this app's data lives.

## Cookbook: common changes

### Change the app's accent color (or any color)

Open `css/styles.css`. The top of the file lists named colors (`--accent`,
`--good`, `--text-primary`, etc.), each with a comment stating what it is
used for, for the light theme; the matching dark-theme values sit in the
`@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` blocks
directly below. Changing `--accent` in both places updates every meter fill,
button, and active-tab color at once — nothing else in the app needs to
change, because `index.html` and `app.js` never hardcode a color themselves.

Two spots outside `styles.css` intentionally keep their own copy of the
accent color, because they are read by the OS rather than by CSS and cannot
reference a CSS variable: the `theme-color` `<meta>` tag near the top of
`index.html`, and `"theme_color"` in `manifest.json`. Both carry a comment
noting they must be updated by hand to match `--accent`.

### Change a default goal, or what a new install starts with

Open `js/app.js`, locate `function defaultData()`. It is a plain list of
starter exercises — change a `goal` number, or add/remove an entry in that
array. This only affects brand-new installs; it does nothing to data already
saved (see the migrations section above for changing *existing* data).

### Change the weight increments the "Next session" suggestion uses

Locate `WEIGHT_INCREMENTS` in `js/app.js`. It is a small object specifying
how many pounds/kilograms to suggest adding for an upper-body vs. lower-body
lift. Change the numbers directly.

### Add a brand-new field to exercises or entries

This is the one change worth being careful with — follow the recipe in the
comment above `SCHEMA_VERSION` in `js/app.js`:

1. Bump `SCHEMA_VERSION` (e.g. `2` → `3`).
2. Add a function to `MIGRATIONS` keyed by the version being upgraded
   *from* — `3: (data) => { ...; return data; }` for a v3→v4 migration.
3. Inside it, loop over `data.exercises` (or `data.entries`) and set the new
   field only when it is missing, e.g. `if (!ex.myNewField) ex.myNewField =
   'some default';` — never delete or reassign an existing field.

Every already-saved data set gets the new field added, in place, the next
time the app opens — nothing is reset.

### Rename the app, change its icon, etc.

Search for the exact string to change (e.g. "Fit Log") — it appears in
`index.html`'s `<title>` and a couple of `<meta>` tags, and in
`manifest.json`'s `"name"`/`"short_name"`. The icon files are the PNGs under
`icons/`; replace them with same-sized images (192×192 and 512×512) and keep
the filenames the same, or update the paths in `manifest.json` and
`index.html` if they are renamed.

## Testing a change before deploying it

Because there is no build step, testing means opening `index.html` in a
browser and exercising the UI directly. The browser's developer console (in
Chrome: the ⋮ menu → "More tools" → "Developer tools", or F12 on desktop)
surfaces red error text when a change breaks something, usually with a file
name and line number pointing at the problem.

## Deploying an update

1. Make the edits.
2. **Bump `CACHE_VERSION` in `sw.js`** (e.g. `fitlog-v2` → `fitlog-v3`) —
   this is what tells an already-installed copy of the app "the files
   changed, fetch them again" instead of continuing to serve the old cached
   copy. Skipping this step is the most common reason an update "doesn't
   show up."
3. On GitHub, upload the changed files the same way as the initial setup
   (**Add file → Upload files**, drag them in, commit) — GitHub Pages
   redeploys automatically in under a minute.
4. Open the app on a phone with a network connection at least once so the
   new service worker can install; a full close-and-reopen may be needed for
   the update to visibly take over.
