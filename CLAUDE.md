# Draw — live diagram drafting

A single-page app for hand-drafting diagrams from a small text DSL, live, with
drag/click/dblclick editing on the rendered result. Currently ships two
drawing styles (Sequence, Swimlane); the architecture is built specifically
so more can be added as fully independent, isolated modules — read this file
before adding one.

## Deployment: zero-build static site on Vercel

There is no bundler, no `package.json`, no build step. Every file under
`js/` is a plain **classic** `<script src="...">` — not
`<script type="module">`. Vercel serves this directory's files as-is.

**Do not** convert these to ES modules, add a bundler, or add a build step.
Two concrete reasons this would break things:
- Classic scripts all share one global scope by design (see
  `js/core/state.js`'s header) — that's how `js/engines/*.js` reaches
  `doRender()`, `customLayout`, etc. with zero imports. ES modules would
  require threading every one of those through explicit import/export for
  no behavioral benefit here.
- `<script type="module">` fails to load local files at all over `file://`
  (CORS), which is how this app gets opened/tested locally. Classic
  `<script src>` works fine there and over real HTTP identically.

Adding a new file is: create it under `js/core/` or `js/engines/`, add one
`<script src="...">` line in `index.html`. That's the entire "build."

## Architecture

One shared **shell** (editor pane, canvas, saved-diagrams folder tree,
undo/redo, both side panels, topbar) plus a swappable **engine** that owns
everything about one drawing style: its DSL grammar, how that DSL becomes an
SVG, and how that SVG becomes interactive (drag, click-to-select, double-
click-to-edit, drag-to-connect, hover-to-add/remove). Exactly one engine is
"current" at a time; opening a different diagram, or creating a new one of a
different type, swaps which engine is current. **Engines never talk to each
other or know about each other** — only to the shared shell, through one
documented contract.

```
index.html                 HTML shell + one <link> + <script> tags in load order
styles.css                 all CSS

js/core/                   the shared shell -- engine-agnostic
  state.js                   DOM refs, all shared mutable state, the engine
                              registry (ENGINES/registerEngine) -- loaded
                              FIRST. >>> THE FULL ENGINE CONTRACT LIVES HERE <<<
  utils.js                   stateless helpers (label fitting, inline-edit
                              popup, dropdown popup, esc, svg coord helpers)
  interactions.js            generic drag/select/remove/add/edit/connect
                              wiring every engine's attach() calls into
  render.js                  the one render loop (doRender/render),
                              activateEngine(), topbar chrome repaint
  history.js                 undo/redo (engine-agnostic snapshots)
  chrome.js                  editor/topbar wiring, left rail + panel
  properties-panel.js        right-hand style/properties panel
  new-diagram-modal.js       "New diagram" modal (name/type/sample picker)
  persistence.js             saved-diagrams tree (localStorage), autosave,
                              content/style split -- LAST <script> tag,
                              runs the app's bootstrap at its own end

js/engines/                 one file per drawing style -- fully isolated
  sequence.js                 Sequence diagrams
  swimlane.js                  Swimlane diagrams
  <yours>.js                    <- add new styles here, nothing else
```

Load order in `index.html` matters and mirrors the list above: `state.js`
first, then `utils.js`/`interactions.js`, then every `js/engines/*.js` (each
self-registers via `registerEngine(...)` at its own end), then
`render.js`/`history.js`/`chrome.js`/`properties-panel.js`/
`new-diagram-modal.js`, then `persistence.js` last (it calls things from
every file above it, synchronously, as soon as it loads).

## Adding a new drawing style

1. Read the full contract — every required/optional field an engine object
   needs, and the DOM/CSS conventions (`data-node`, `data-lane`,
   `.editable-label[data-edit]`, `.add-hotzone[data-insert-index]`,
   `.link-handle[data-linksrc]`, `.diagram-bg`, theming via
   `colorStyleFor`/`accentStyleAttr`) your SVG output must follow to get
   drag/select/remove/edit/connect for free — in `js/core/state.js`, under
   the big `ADDING A NEW DRAWING STYLE` comment block. This is the
   authoritative spec; everything below is just a pointer to it.
2. Copy `js/engines/swimlane.js` (has lanes + multiple node shapes — the
   richer template) or `js/engines/sequence.js` (simpler: one shape kind, no
   secondary grouping) as a starting point.
3. Implement your own DSL grammar, `parseAndLayout`, and `attach` — this can
   be built and tested with zero knowledge of the other engine files.
4. End the file with `registerEngine({...})`.
5. Add `<script src="js/engines/<yours>.js"></script>` in `index.html`,
   grouped with the other engine tags (after `interactions.js`, before
   `render.js`).
6. Nothing else changes. The "New diagram" modal's type cards, the
   properties panel's per-engine hint, and the saved-file type tags all pull
   from the `ENGINES` registry dynamically — they pick up a new engine
   automatically.

## Invariants worth knowing before you touch shared code

These were each a real bug once; the fix is now load-bearing.

- **`.canvas-scroll` uses `justify-content: safe center`, not `center`.**
  Plain `center` lets a diagram wider than the pane overflow equally on
  both sides — but a scroll container can only ever scroll toward the end,
  so the portion overflowing past the *start* becomes permanently
  unreachable (not just "needs scrolling", literally unreachable at
  `scrollLeft: 0`). `safe center` is the standard fix. Don't revert this for
  a cosmetic reason without re-testing a diagram wider than the viewport.
- **The global `[hidden]{ display:none !important; }` rule in styles.css is
  required**, not decorative. Any element toggled via the `hidden`
  attribute (the "New diagram" modal overlay is the current example) also
  has a class-based `display` rule (e.g. `.modal-overlay{ display:flex; }`);
  without the `!important` override the attribute alone loses to the class
  and the element stays visually hidden *but still receiving clicks*.
- **The right-hand properties panel never opens/closes itself as a side
  effect of selecting something on the canvas** — only the user's own rail-
  button click toggles it (see `properties-panel.js`, `selectElement`).
  This was tried and reverted: toggling panel visibility off the same click
  that starts a double-click gesture reflows the canvas mid-gesture and
  makes the second click of a dblclick land on the wrong thing (or, if the
  panel floats instead of reflowing, permanently covers canvas content
  near the panel's edge). Keep selection and panel-visibility decoupled.
- **A saved file's `content` (the DSL text) and `style` (positions,
  spacing, the secondary toggle, accent color, per-shape color overrides)
  are stored separately on purpose** — `style` is presentation-only and
  never affects what the diagram *means*; keep it that way when adding new
  per-shape customization (color/shape are already like this — see
  `customColors`/`accentColor` in `state.js` and `colorStyleFor` — don't
  reach for embedding presentation into the DSL text itself).
- **Colors are a curated palette (`PALETTE` in `state.js`), never a free
  picker**, and a shape whose color is semantically fixed (swimlane's "end"
  terminal, drawn in a fixed red) is deliberately excluded from being
  themed. Any new engine's error/terminal/danger shapes should follow the
  same rule — the properties panel is meant to restyle a diagram, never to
  let it say something it doesn't mean.

## Testing

No test framework is committed. Verification during development was done
with Playwright driving a real Chromium against `index.html` — either
directly over `file://` (classic scripts load fine that way) or via a
throwaway local static server (`python3 -m http.server`) to match Vercel's
real HTTP serving more closely. There's no reason both wouldn't keep
working; if you're unsure whether a change is safe, load the page in a
browser and click through the affected flow (or spin up a quick Playwright
script) rather than assuming.
