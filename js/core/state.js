  // ================================================================
  // FILE: js/core/state.js
  // WHAT: DOM element references + every piece of shared mutable app state
  //       + the diagram-type engine registry (ENGINES/registerEngine).
  //       Loaded FIRST (see the <script> order in index.html) -- every
  //       other file in js/core/ and js/engines/ reads and writes the
  //       `let` variables and calls the functions declared here.
  //
  // ARCHITECTURE IN ONE PARAGRAPH: this app is one shared "shell" (editor
  // pane, canvas, saved-diagrams folder tree, undo/redo, the two side
  // panels) plus a swappable "engine" that owns everything about ONE
  // drawing style: its DSL grammar, how that DSL is parsed and laid out
  // into an SVG, and how that SVG becomes interactive. Exactly one engine
  // is "current" at a time (see `currentEngine` below); switching diagrams
  // switches which engine is current. Engines never talk to each other --
  // only to this shared shell, through the contract documented in full at
  // "ADDING A NEW DRAWING STYLE" further down this file.
  //
  // WHY CLASSIC <script> TAGS, NOT ES MODULES: every file in js/ (this one
  // included) is a plain classic script, loaded via <script src="...">, on
  // purpose -- NOT <script type="module">. They all share one global scope
  // (like today's single-file version did, just physically split), which
  // is why e.g. an engine file can call `doRender()` or read `customLayout`
  // with no import statement anywhere. Do not "helpfully" convert these to
  // ES modules: (a) it would require threading every one of these shared
  // `let`s through explicit imports/exports for no behavioral benefit here,
  // and (b) this app is deployed to Vercel as a zero-build static site --
  // there's no bundler, no package.json, nothing to compile. Keep it that
  // way; just add plain files and <script> tags.
  // ================================================================

  const dslEl = document.getElementById('dsl');
  const holder = document.getElementById('diagram-holder');
  const errbar = document.getElementById('errbar');
  const linecount = document.getElementById('linecount');
  const spacingEl = document.getElementById('spacing');
  const spacingLabelEl = document.getElementById('spacing-label');
  const spacingVal = document.getElementById('spacing-val');
  const toggle2El = document.getElementById('toggle2');
  const toggle2LabelEl = document.getElementById('toggle2-label');
  const menuToggle2LabelEl = document.getElementById('menu-toggle2-label');
  const snippetsEl = document.getElementById('snippets');
  const helpEl = document.getElementById('help');
  const mainEl = document.querySelector('.main');
  const canvasPaneEl = document.querySelector('.canvas-pane');
  const linkHintEl = document.getElementById('link-hint');
  const brandMarkEl = document.getElementById('brand-mark');
  const brandNameEl = document.getElementById('brand-name');
  let scriptVisible = false;

  let customLayout = {};   // node/participant id -> manually dragged x position
  let dragState = null;
  let linkState = null;    // active drag-to-connect gesture, if any
  let activePopup = null;  // the currently open popup menu (arrow/connector type, block wrap), if any
  let activeInlineEditor = null; // {el, finish} for the currently open inline text editor, if any
  let closeSideMenu = null;
  let currentFileId = null;
  let autoSaveCurrentFile = null;

  // ---------------- diagram theming (presentation only, never touches the DSL) ----------------
  // A curated palette rather than a free color picker -- every option is a
  // pre-paired {stroke, tinted fill} that already matches the app's visual
  // system, so recoloring a diagram can't produce something illegible or
  // inconsistent. "end"/danger shapes (e.g. swimlane's terminal node) always
  // stay the fixed semantic red, regardless of theme -- that meaning isn't
  // user-overridable.
  const PALETTE = {
    blue:   {label:'Blue',   hex:'#2F6FED'},
    teal:   {label:'Teal',   hex:'#0EA5A5'},
    purple: {label:'Purple', hex:'#7C5CFC'},
    green:  {label:'Green',  hex:'#22A35E'},
    orange: {label:'Orange', hex:'#E08A2C'},
    coral:  {label:'Coral',  hex:'#E0574A'},
    slate:  {label:'Slate',  hex:'#5B6B87'},
    pink:   {label:'Pink',   hex:'#D2559B'}
  };
  const PALETTE_ORDER = ['blue','teal','purple','green','orange','coral','slate','pink'];
  let accentColor = 'blue';  // this diagram's default theme, one of PALETTE_ORDER
  let customColors = {};     // node/lane id -> palette key, overriding the diagram default for just that shape
  let selectedElement = null; // {kind, id, engineType} for whatever's shown in the right panel, if anything

  // Diagram elements reference color via var(--amber,#2F6FED)/var(--teal,#2F6FED)
  // (the same CSS custom properties the stylesheet already defines) so a
  // theme change is one inline style on the SVG root -- not a rewrite of
  // every shape. A colorable shape's own <g> can locally override those same
  // properties to recolor just itself, since CSS custom properties cascade.
  function accentStyleAttr(){
    const hex = (PALETTE[accentColor] || PALETTE.blue).hex;
    return `--amber:${hex};--teal:${hex};`;
  }
  function colorStyleFor(id){
    const key = customColors[id];
    if(!key || !PALETTE[key]) return '';
    return ` style="--amber:${PALETTE[key].hex};--teal:${PALETTE[key].hex};"`;
  }
  let restoredLastFile = false;
  let createNewFile = null;         // set by the saved-drawings module; persists a new file (name, type, sample-or-blank)
  let openNewDiagramModal = null;   // set by the "New diagram" modal module
  let selectElement = null;         // set by the right-hand properties panel module
  let refreshPropertiesPanel = null; // set by the right-hand properties panel module; called after every render
  let currentType = 'sequence'; // just an initial guess -- js/core/render.js
                                 // corrects this via defaultEngineId() (below)
                                 // once every engine has actually registered
  let currentEngine = null; // set once ENGINES is built, at the bottom of this file

  // ================================================================
  // ADDING A NEW DRAWING STYLE (engine) -- start here
  // ================================================================
  // A "drawing style" (Sequence, Swimlane, ...) is called an ENGINE in this
  // codebase. Each one lives entirely in its own file at js/engines/<id>.js,
  // is fully self-contained (own DSL grammar, own parser, own SVG layout,
  // own interaction wiring), and can be built and tested in isolation from
  // every other engine. It only needs to do two things to plug into the
  // rest of the app:
  //   1. Emit SVG markup using the shared DOM/CSS conventions below, so the
  //      GENERIC interaction helpers in js/core/interactions.js (drag,
  //      select, add/remove, inline-edit, drag-to-connect) work on it for
  //      free -- you do not write your own mousedown/click plumbing.
  //   2. Build an object matching the shape below and pass it to
  //      registerEngine(...) once, at the end of your engine file.
  // Then add one line to index.html: <script src="js/engines/<id>.js">
  // right after the other engine <script> tags (before js/core/render.js).
  // Nothing else -- not this file, not any other js/core/*.js file, not
  // the "New diagram" modal, not the properties panel -- needs to change.
  // (Those pull engine metadata like `thumbnail`/`label` dynamically from
  // ENGINES; see js/core/new-diagram-modal.js and properties-panel.js.)
  //
  // ---- the object you pass to registerEngine(...) ----
  //
  // Required:
  //   id             string, unique, e.g. 'sequence'. This is the value
  //                  stored as a saved file's `type`, and ENGINES[id].
  //   label          string, display name, e.g. 'Sequence'.
  //   mark           string, short badge text shown in the topbar, e.g.
  //                  'SEQ'.
  //   sample         string, a complete example script in your DSL --
  //                  loaded into a brand-new diagram of this type.
  //   emptyMessage   string. Throw `new Error(emptyMessage)` from
  //                  parseAndLayout when the script has nothing to draw
  //                  yet (e.g. no participants/lanes declared at all) --
  //                  the shared render loop (js/core/render.js) catches
  //                  exactly this message and swaps in a generic
  //                  "click + to start" placeholder instead of showing a
  //                  parse-error bar.
  //   emptyLabel     string, one word, used in that placeholder's copy:
  //                  "Click the + to add your first <emptyLabel>".
  //   exportBaseName string, filename prefix for Download SVG/PNG, e.g.
  //                  'sequence-diagram' -> sequence-diagram.svg.
  //   spacing        {label, min, max, step, default} -- populates the
  //                  topbar's spacing slider; `default` is also what a
  //                  brand-new file's saved style.spacing starts at.
  //   toggle         {label, default} -- populates the topbar's one
  //                  secondary checkbox (sequence's "Bottom boxes",
  //                  swimlane's "Notes"). Every engine gets this one
  //                  checkbox slot; if your DSL genuinely has nothing for
  //                  it to control, it can be a no-op, but still provide
  //                  the config (the chrome always renders the control).
  //   snippets       [{key, label, text}, ...] -- toolbar buttons that
  //                  insert `text` at the cursor. `label` is the button
  //                  caption (e.g. "+ participant"); `key` only needs to
  //                  be unique within your own snippets array.
  //   helpHTML       string of HTML shown in the editor pane's
  //                  collapsible help section -- document your DSL's
  //                  grammar here.
  //   parseAndLayout(text, spacing, toggleOn) -> svgString
  //                  The engine, really: parse `text` in your DSL, lay it
  //                  out, and return one complete `<svg>...</svg>`
  //                  string. Throw a plain Error with a human-readable
  //                  message on any parse problem (shown in the error bar
  //                  verbatim), or throw exactly `new Error(emptyMessage)`
  //                  for the empty-diagram case. Read dragged positions
  //                  from the shared `customLayout[id]` map and apply
  //                  colors via `colorStyleFor(id)` / `accentStyleAttr()`
  //                  (both declared further down this file) -- see
  //                  "Theming" below for the exact pattern.
  //   attach(svgEl)  Called right after parseAndLayout's output is dropped
  //                  into the DOM. Wire up interactions here -- almost
  //                  always by calling the generic helpers in
  //                  interactions.js (attachDragHandlers,
  //                  attachRemoveHandlers, attachAddHandlers,
  //                  attachSelectionHandlers, attachEditableHandlers,
  //                  attachLinkHandleHandlers) with your own small
  //                  callbacks, rather than writing raw addEventListener
  //                  calls yourself. See sequence.js/swimlane.js for the
  //                  pattern.
  //   insertPrimaryAt(index)
  //                  Called when the user clicks an `.add-hotzone` (see
  //                  below) -- insert a new primary entity (a participant,
  //                  a lane, ...) into the DSL text at that position and
  //                  trigger a re-render by calling doRender() (declared
  //                  in js/core/render.js).
  //
  // Optional (every one of these only improves the right-hand properties
  // panel -- omit any you don't need and the panel simply won't offer that
  // capability for your engine; nothing else breaks):
  //   thumbnail        small (~100x56) inline `<svg>...</svg>` string shown
  //                    as this engine's card in the "New diagram" modal.
  //                    Falls back to a blank card if omitted.
  //   selectionHint    string shown in the properties panel when nothing's
  //                    selected, e.g. "Click a participant to edit it."
  //                    Falls back to a generic sentence if omitted.
  //   getNodeLabel(id) -> string | undefined
  //                    Current text of a `[data-node]` shape. Return
  //                    undefined if `id` no longer exists (this is how the
  //                    panel detects and clears a stale/removed
  //                    selection). Needed for the panel to show or edit a
  //                    primary shape's text at all.
  //   renameNode(id, newText)
  //                    Apply a text edit made via the panel. Required if
  //                    getNodeLabel is provided.
  //   getNodeKind(id) -> string | null
  //                    Only meaningful if a `[data-node]` shape can be one
  //                    of several SAFELY INTERCHANGEABLE kinds (e.g.
  //                    swimlane's step/decision, which are both just "a
  //                    thing that happens in the flow" -- NOT structurally
  //                    distinct the way a start/end terminal is). Return
  //                    the shape's current kind.
  //   setNodeShape(id, newKind)
  //                    Apply a shape change made via the panel's shape
  //                    toggle. Required if getNodeKind is provided. Only
  //                    offer kinds here that are genuinely safe to swap
  //                    without changing what the diagram means -- see
  //                    "Respect the diagram's own standards" below.
  //   getLaneLabel(name) -> string | undefined
  //   renameLane(name, newText)
  //                    Same pattern as getNodeLabel/renameNode, but for a
  //                    secondary grouping concept your DSL might have
  //                    (swimlane's lanes). Skip both entirely if your
  //                    diagram type has no such grouping.
  //
  // ---- DOM/CSS conventions your parseAndLayout output must follow, to
  //      get the generic interactions in interactions.js for free ----
  //
  //   [data-node="<id>"]  Wraps a primary, individually-addressable shape
  //     (a participant, a step, ...). `id` must stay stable across
  //     re-renders -- it's the key into customLayout and into the
  //     per-shape color-override map.
  //       [data-x="<number>"]  Add this too, on the SAME element, to make
  //         it draggable left/right; dragging rewrites customLayout[id] --
  //         read that map back when computing positions on the next
  //         render. Omit data-x (or leave it non-finite) for a
  //         [data-node] that should be selectable but never draggable.
  //       class="has-remove" + a nested `.remove-btn`
  //         Gets you a hover-to-reveal delete badge on the shape. Your
  //         onRemove callback (passed to attachRemoveHandlers) decides
  //         what removing it actually does to the DSL text.
  //   [data-lane="<name>"]  A secondary, non-draggable group container
  //     (only relevant if your DSL has such a grouping concept) --
  //     selectable and removable the same way as [data-node], just never
  //     draggable.
  //   .editable-label[data-edit="<kind>"]  Double-click-to-edit-inline
  //     target (an arrow's label, a note, ...). Pass a
  //     {kind: handlerFn, ...} map to attachEditableHandlers(svg, map) in
  //     your attach(); the matching handlerFn(el) is expected to open the
  //     shared inline-text-edit popup (openInlineEditor, in utils.js).
  //   .add-hotzone[data-insert-index="<n>"]  Click target that calls
  //     insertPrimaryAt(n).
  //   .link-handle[data-linksrc="<id>"]  Press-and-drag-to-another-shape
  //     target for drawing a new connection. Wire it via
  //     attachLinkHandleHandlers(svg, optsFor) inside your attach() -- see
  //     interactions.js's own comment above startLinkDrag for the full
  //     `opts` shape (getPoints/distance/snapRadius/onDrop/clampY/startY).
  //   .diagram-bg  The background rect -- clicking it deselects whatever's
  //     selected. Give your root <svg> one (full width/height, drawn
  //     first, behind everything else) if you want click-to-deselect.
  //
  //   Theming: reference color via var(--amber,#2F6FED) (and
  //   var(--teal,#2F6FED) for a secondary accent, if you want a second
  //   one) in stroke/fill attributes instead of hardcoding hex, and put
  //   `${accentStyleAttr()}` into your root <svg>'s own style attribute.
  //   For any [data-node]/[data-lane] you want individually recolorable,
  //   splice `${colorStyleFor(id)}` into that element's opening tag too --
  //   see either engine file for the exact pattern (search "colorStyleFor"
  //   in sequence.js or swimlane.js). Never let a shape whose color is
  //   semantically fixed (an error/terminal state) become user-themeable
  //   -- see swimlane.js's "end" node, which is deliberately excluded from
  //   colorStyleFor, for the precedent.
  //
  // ---- respect the diagram's own standards ----
  // The properties panel (and any future per-shape editing UI) should only
  // ever expose customizations that are cosmetically or structurally SAFE
  // -- never let it produce a diagram that violates your DSL's own
  // semantics. Concretely: only offer setNodeShape between kinds that mean
  // the same thing structurally (interchangeable process-flow shapes),
  // never between e.g. a terminal/anchor kind and a mid-flow kind; never
  // make a semantically-fixed color (errors, terminals) user-overridable.
  // ================================================================
  const ENGINES = {};
  function registerEngine(engine){
    ENGINES[engine.id] = engine;
  }

  // Fallback used wherever a `type` string turns out to be missing or
  // unrecognized (a corrupted localStorage record, a file saved by a build
  // that had an engine this one doesn't, etc). Deliberately NOT hardcoded
  // to any one engine id -- it's just whichever engine's <script> tag
  // happens to load first in index.html -- so removing or reordering
  // engines can't leave this pointing at something that no longer exists.
  function defaultEngineId(){
    return Object.keys(ENGINES)[0];
  }

