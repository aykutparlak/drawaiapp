# Sequence Flows — DSL syntax reference

Engine id: `sequenceflows` · file: [sequenceflows.js](sequenceflows.js) ·
topbar mark: `SEQF`

This is the living spec for this engine's own DSL. Keep it in sync with
`sequenceflows.js` — when you add/change/remove a statement in the parser,
update this file (and the in-app `helpHTML` block near the bottom of
`sequenceflows.js`, which is the version users see) in the same change.

## Status

A column of colored **system** boxes, stacked top-to-bottom, individually
resizable — wide horizontal bars, not narrow vertical columns — each of
which can hold its own **process** chips. It started as a copy of
`sequence.js` and picked up messages/notes/activations/blocks/autonumber/
title along the way, then all of that was removed on purpose — see the
changelog's earlier entries. `process` (added after that strip-down) is
the first real new concept this DSL has of its own; keep the file this
scoped otherwise — don't let sequence-diagram leftovers creep back in just
because they used to be here.

## Statements

One statement per line. Blank lines and `#`, `//`, `%%` comment lines are
ignored. There are two statements:

### `system`

```
system <Name> [as <Label>]
```

Declares a system, in display order, with an optional display label
distinct from its id (`Name` is the id; `Label` is what's drawn — defaults
to `Name` if omitted). Any line that's neither this nor `process` (below)
is a parse error (`Line N: could not parse — "..."`) — unlike `sequence`'s
grammar, there's no statement that could auto-declare a system as a side
effect.

**Each system renders as one fixed-width, resizable-height colored box —
there is no separate header rectangle.** The label sits along the box's
left edge, rotated 90° to read vertically bottom-to-top (`transform="rotate(-90 ...)"`
around an anchor near the left edge, vertically centered on the box's
*actual* rendered height, so it stays centered even after that box gets
resized). The box itself is the one `[data-node]` element (selectable,
double-click-anywhere-on-it to rename, removable via the `×` in its own
top-right corner — removing it also removes every `process` declared `in`
it). Every system is auto-assigned its own color, cycling through the
shared `PALETTE` (`js/core/state.js`) by declaration order (1st system →
blue, 2nd → teal, 3rd → purple, ...). A user can override any one
system's color via the properties panel's color swatches (the same
`customColors`/`PALETTE` mechanism `sequence`/`swimlane` already use) —
that pick wins over the auto-assigned default.

### `process`

```
process <Name> [as <Label>] in <System>
```

Declares a process belonging to a system (`System` must be a declared
`system` name, checked after the whole script is parsed — a `process` line
can come before or after its system's own `system` line). `Name`/`Label`
work exactly like a system's. Unlike `sequence`'s grammar, this DSL has no
concept of a process auto-declaring the system it's `in` — an unknown
`System` is a parse error (`Line N: unknown system "..."`), same class of
error as everything else here.

**Each process renders as a rounded-rectangle chip inside its system's
box** (a fixed, modest corner radius — `chipRadius`, 8px — not height/2,
which would round it into a full pill/stadium shape), not its own box —
chips flow left-to-right starting well clear of the rotated label,
wrapping to a new row inside the box once one would run past its right
edge (see `chipAreaLeft`/`chipAreaRight` in `parseAndLayout`). A chip's
own size is in **grid units** — a 2×4 grid cell by default (height =
`2 × currentGridPx()`, width = `max(4 × currentGridPx(), label-driven)`)
— the same `GRID_UNIT_PX`/topbar "Grid size" stepper unit a box's own
resize already snaps to, so bumping that stepper grows chips too, not
just the resize-snap increment. A chip that overflows its system's own
(possibly short) height just draws past the box's bottom edge — it does
**not** force the box to grow; growing the box to fit is still a manual
drag, same as everything else here. A chip is its own `[data-node]` element
(`data-node-kind="process"`, distinct from a system's `"system"`),
selectable, double-click-to-rename, removable via its own small `×` — but
rendered as a **sibling** of its system's box in the SVG, not nested
inside it, specifically so a chip's own dblclick/click never bubbles into
its parent system's handlers too (nesting would still look identical on
screen, but would silently double-fire both).

Each system box has its own **red `+` circle** right after its last
process chip (or where the first would go, if it has none) — click it to
add a new process to *that* system (`insertProcessFor`, wired via
`.add-process-btn[data-add-process="<System>"]` in `attach()`). New
processes are inserted textually right after that system's last existing
process (or right after the system's own declaration line, if it has
none yet), keeping a system's processes grouped together in the script the
way a person would naturally type them, not just appended to the end of
the file. It's a plain click button, not draggable — same solid red
(`#D0453A`, white `+`) as every other "add" control in this engine (the
add-system hotzones) and the remove badges, rather than the system's own
tinted color, so it reads as an action rather than part of the box's own
content.

**A process chip is freely draggable** — press and drag it (past the small
threshold that keeps a plain click/dblclick working) to place it anywhere
inside its own system box, or drop it into a *different* system box to
move it there (rewrites that line's `in <System>`). This is a bespoke
gesture (`onProcessDragStart`/`Move`/`End` in `sequenceflows.js`), not the
shared `interactions.js` drag helper (that one's a single x-only position;
this is a full 2D drop anywhere in a box). A chip that's never been
dragged still flows automatically (left-to-right, wrapping) exactly as
before — free positioning is opt-in, per chip, the first time it's
dragged. Once dragged, it carries an explicit pixel position in
`customLayout` (`posXKey`/`posYKey`, relative to its *current* system
box's own top-left) that every render places it at exactly, snapped to
the grid (`currentGridPx()`, same increment box-resize and chip-sizing
already snap to) — and it opts out of the flow layout entirely, so it
never consumes a flow slot or pushes other chips around; it can sit
anywhere, including on top of or between flowing ones. The gesture itself:
figure out live which system box the pointer is over
(`findTargetSystem`, off `lastSystemBoxes` — a geometry snapshot from the
last `parseAndLayout`), show that as a drop hint (a dashed outline around
the target box plus a translucent ghost of the chip, itself snapped to the
grid, following the pointer — plain SVG elements appended directly to the
live `<svg>`, not a re-render on every `mousemove`), and on release write
the snapped position into `customLayout` and, only if the target system
differs from the chip's own, rewrite its DSL line's `in <System>`
(`moveProcess`, always appended after that system's last process or its
own declaration — the same placement rule `insertProcessFor` uses; textual
order among a system's processes is purely cosmetic once free positioning
is in play, so there's no "reorder the line" step to also do here). The
drop always lands on *some* system (the nearest one by Y, even mid-air
between two boxes) — there's no "cancel," same spirit as every other
engine's forgiving drag gestures. Because the drag's release often lands
over a different chip or system box, the very next `click` event is
swallowed once so it can't also select whatever's now under the pointer.

## Layout and interaction model

- **A faint dot grid covers the whole canvas**, spaced at `currentGridPx()`
  — the same increment box resizing and process-chip sizing already snap
  to — so it visually shows the grid things will land on, not just
  decoration; bumping the "Grid size" stepper spaces the dots out too. An
  SVG `<pattern>` (`#bgGrid`) tiled across one background `<rect>`, drawn
  right after the white `.diagram-bg` and before everything else, with
  `pointer-events:none` so it never intercepts a click meant for the
  background (deselect) or anything drawn on top of it.
- **A system's y position is always the deterministic auto layout**
  (declaration order + "Row spacing") — its box is selectable,
  double-click-to-rename, and removable, but never draggable (no `data-x`
  at all, unlike `sequence`/`swimlane`'s nodes). This is intentional, not
  an oversight.
- **Boxes float top-to-bottom, touching edge-to-edge — no gap — each the
  same fixed width (`BOX_W`) — sized to fill the actual canvas pane
  width** (`canvasPaneEl.clientWidth`, the same shared DOM ref every
  engine's shell reads, minus `.canvas-scroll`'s own 40px-each-side
  padding and this engine's own 30px left/right margins), floored at
  260px so it never collapses on a narrow viewport and capped at
  `MAX_BOX_W` (1200px) so it doesn't stretch edge-to-edge absurdly wide
  on a large monitor — an ordinary window fills fully (well under the
  cap), a genuinely wide one renders at that fixed reasonable width and
  `.canvas-scroll`'s own centering (`justify-content:safe center`) puts
  it in the middle of the extra space, no extra centering logic needed
  here. Recomputed on every render, not continuously reactive to a live
  window resize (no engine in this app has a resize listener; this stays
  consistent with that — resize the window, then make any edit, and it
  refits).**
  Every box's own top/bottom is also snapped to the nearest grid line
  (`snapToGrid`, `Math.round(v / currentGridPx()) × currentGridPx()`, so
  an edge is off by at most half a grid cell — never more) — its border
  genuinely starts and ends on a grid line, not floating between two.
  Since two touching boxes share the same natural boundary before
  snapping, both sides snap to the *identical* grid line, so they still
  meet exactly with no gap or overlap after rounding.
  Drag a box's bottom edge to resize its height — every box after it
  slides down to keep touching (it never leaves a gap or causes an
  overlap), while every box before it is untouched. There's only one
  handle per box, on its bottom edge — that edge physically *is* the
  shared boundary with the next box, so a second "next box's top edge"
  handle at the same spot would just be a duplicate control for the same
  drag. Resize handles render as their own top-level layer, after every
  box (not nested inside each box's own `<g>`) — with boxes touching, a
  handle sits exactly on the shared boundary, so half its hit-area is
  geometrically "inside" the next box's own rect; painting every handle
  in one pass after all the boxes guarantees the next box's rect never
  ends up on top of it.
  What's stored is a height **delta** from the box's natural (tiling-based)
  height (`customLayout[name+':d']` — `:` isn't a legal `\w` character, so
  this can never collide with a real system name), not an absolute edge
  position — see the `cumulativeShift` recurrence in `parseAndLayout` for
  exactly how one box's delta propagates into every later box's rendered
  position without changing their own heights. The dragged edge snaps to a
  grid — see "Grid size" below. "Reset layout" clears every box's delta,
  back to natural tiling.
- **Topbar "Grid size" stepper** (replaces `sequence`'s "Bottom boxes"
  checkbox for this engine — see `toggle:{type:'stepper', ...}` in the
  engine object, and `js/core/render.js`'s `updateChromeForEngine` for how
  the shared chrome renders a stepper instead of a checkbox when an
  engine's `toggle` asks for one). Ranges 1–8, default 3; the actual pixel
  snap increment is `stepperValue × 8` (8px is `GRID_UNIT_PX`, a constant
  in `sequenceflows.js`), so the default step is 24px and a stepperValue
  of 8 is 64px. Persisted per-file in the same slot `sequence`/`swimlane`/
  `sankey` use for their boolean toggle (`style.secondary` — now
  polymorphic: boolean for a checkbox-mode engine, number for a
  stepper-mode one).
- **Only two add-hotzones — just above the first box and just below the
  last one** (`insertPrimaryAt(0)` / `insertPrimaryAt(order.length)`), not
  one in every gap between boxes. Hover there and click the red `+` to add
  a system at that end; a system between two existing ones is added by
  editing the script directly. The `+` sits on the **left** side (`boxLeft
  + 20`, lined up with the rotated label's own anchor), not centered
  across the box's width — and its clickable/hoverable area is a small
  circle right around the visible button (radius 14, a touch bigger than
  the button's own radius 10 for easier hovering), not a strip spanning
  the box's whole width. It used to be the latter, which meant clicking
  empty space well to the right of the visible `+` silently inserted a
  system too. The add-hotzones render *behind* the boxes in the SVG (not
  in front) specifically so a box's own resize handle — which sits right
  where the bottom hotzone's hit-area reaches toward it — always wins the
  click in that sliver of overlap.
- Hover a system box and click the red `×` in its top-right corner to
  remove it.
- Double-click anywhere on a system box to rename it in place — Enter to
  save, Esc to cancel.

## Open design questions for the "own syntax"

Track ideas here as they come up so they don't get lost between sessions;
give each its own heading under "Statements" above once it's actually
implemented in `sequenceflows.js`.

- (none yet)

## Changelog

- Initial scaffold — copied verbatim from `sequence`'s grammar.
- Renamed `participant` → `system` (keyword, errors, UI copy, internal
  function/variable names). First real divergence from `sequence`.
- Each system rendered as a full-height colored band (auto-assigned from
  `PALETTE`, user-overridable), not just a header box on a thin lifeline;
  removed the dashed lifeline down each system's center as redundant once
  the band existed; added a `BAND_GAP` trim so neighboring bands read as
  separate rectangles.
- Added resize handles on each system's box; added the shared "stepper"
  variant of the topbar's secondary control slot (`js/core/render.js`,
  `js/core/chrome.js`, `js/core/persistence.js`, `js/core/state.js`,
  `index.html`) so this engine could expose an adjustable "Grid size"
  (1–8, default 3) in place of `sequence`'s "Bottom boxes" checkbox. The
  other three engines are unaffected — they still get a checkbox,
  unchanged. Iterated the resize model twice (width+center pair → two
  independent edges → the current single-delta flow layout, where
  resizing one box always cascades into every box after it while keeping
  the fixed gap) and removed header drag-to-reposition entirely along the
  way, ending at what's described above.
- **Stripped the engine down to just the system boxes.** Removed messages/
  arrows, notes, activate/deactivate, loop/alt/opt/par/critical/rect
  blocks, autonumber, and title, along with every piece of interaction
  code that only existed to support them (the arrow-type picker, the
  drag-select-to-wrap-in-a-block gesture, connector selection/removal,
  the link-handle drag-to-connect wiring, activation bars, note/block
  inline editors). The DSL is now exactly one statement (`system`); the
  file dropped from ~1360 lines to ~440. This is the deliberate new
  baseline to build a flow-specific DSL on top of, not a regression —
  the removed sequence.js features were never meant to be the endpoint.
- **Removed the separate header box entirely.** A system is now just its
  one colored box — the label moved inside the box's own top, the
  `[data-node]`/remove-button/dblclick-rename wiring moved onto the box
  itself, and the box's height grew to fill the space the header used to
  sit above (no more gap between a header row and the band below it).
- **Flipped the whole layout from a horizontal row to a vertical column.**
  Boxes now stack top-to-bottom (short, wide bars) instead of sitting
  left-to-right (tall, narrow columns) — every piece of the flow-layout
  math (`p.x`→`p.y`, `leftBound/rightBound`→`topBound/bottomBound`, the
  right-edge resize handle→a bottom-edge one, `svgClientX`→`svgClientY` in
  the drag handler) got transposed the same way. Box width is now the
  fixed dimension (`BOX_W`, 260px, same for every box); only height
  resizes. Fixed a real bug this surfaced: the add-hotzone's `+` button
  was rendered in front of (and so was swallowing clicks meant for) the
  box's own resize handle right next to it — reordered the SVG so boxes
  render after (on top of) the hotzones.
- Moved the system label to the box's left edge and rotated it 90° to
  read vertically instead of sitting horizontally across the top.
- Moved the "add system" `+` from centered across the gap to the left
  side, lined up with the label.
- Fixed the "add before first" / "add after last" `+`'s getting clipped
  by the canvas edge at the default "Row spacing" — `topBound`/
  `bottomBound`'s margin was `spacing/2`, which shrinks along with
  spacing and has no real reason to track it in the first place; switched
  to a fixed `EDGE_PAD` (30px), and gave the canvas enough bottom padding
  to fit the last `+` fully instead of exactly hugging the last box.
- Made `BOX_W` fill the canvas pane's actual width instead of a plain
  260px constant (still floored at 260px on a narrow viewport).
- Capped `BOX_W` at 1200px — filling the *entire* pane looked fine on an
  ordinary window but absurd on a wide monitor; an ordinary window still
  fills fully (well under the cap), a wide one now renders at a fixed
  reasonable width, centered by `.canvas-scroll`'s existing centering.
- Removed the "add system" `+` from every gap between boxes — only the
  one above the first box and the one below the last remain.
- Fixed the remaining two hotzones' click/hover area covering the box's
  entire width instead of just the visible button — clicking far to the
  right of the `+` used to insert a system anyway.
- Added `process <Name> [as <Label>] in <System>` — the first new DSL
  concept since the strip-down to just system boxes. Each system box gets
  a dashed `+` to add a process to it; processes render as small chips
  flowing/wrapping inside their system's box, are individually selectable/
  renamable/removable, and are removed along with their system. Chips
  render as siblings of the system boxes in the SVG (not nested inside
  them) so a chip's own rename/remove clicks never bubble into its
  parent system's handlers.
- Sized process chips in grid units (a 2×4 grid cell by default, growing
  with the topbar "Grid size" stepper) instead of a plain fixed pixel
  size, and switched their shape from a full pill (rx = height/2) to a
  fixed 8px corner radius — a rounded rectangle, not a stadium shape.
- Tried replacing the single "add process" button with a grid of empty-
  cell `+`'s filling the box; reverted — didn't work as wanted. Back to
  one dashed `+` right after the last chip.
- Added a faint background dot grid across the whole canvas, spaced at
  `currentGridPx()`, as a visual guide for where things snap.
- Tried making `BAND_GAP` a full grid unit and snapping every box edge to
  the grid, then tried centering each background dot within its tile with
  a halved row height; reverted both — didn't work as wanted. Back to a
  plain fixed 16px `BAND_GAP` and the simple square dot pattern
  (`cx="1" cy="1"` per `currentGridPx()`-sized tile).
- Removed `BAND_GAP` entirely — boxes now touch edge-to-edge with no gap
  — and snapped every box's top/bottom to the nearest grid line, so its
  border genuinely starts/ends on a grid line. This surfaced a real bug:
  with no gap, a resize handle sitting exactly on the boundary between
  two boxes had half its hit-area silently swallowed by the next box's
  own rect (painted after it, so on top). Fixed by rendering every resize
  handle as its own top-level layer after all the boxes, same fix pattern
  already used for process chips.
- Brought `BAND_GAP` back as a small quarter-grid-unit gap
  (`currentGridPx() / 4`) instead of either zero or a full grid unit, and
  switched `snapToGrid`'s own resolution to that same quarter-grid size
  (was the full grid) so the gap stays precisely that size instead of
  getting swallowed or exaggerated by independent full-grid rounding on
  each edge.
- Switched what gets snapped to the grid from each box's own final edge
  to the *boundary two boxes share*, with `BAND_GAP` applied symmetrically
  around that already-snapped point — moved `snapToGrid` back to full-
  grid resolution now that it's snapping the shared point instead of the
  edges. This guarantees the gap's own center always sits exactly on a
  grid line, which snapping each edge independently never actually
  guaranteed (it only kept the gap's *size* consistent, not its
  *position* relative to the grid).
- Doubled `BAND_GAP` to half a grid unit (was a quarter) so each box's
  own inset from the shared grid line — `BAND_GAP/2` — comes out to
  exactly a quarter grid, not an eighth. The gap's *size* changed as a
  side effect of fixing what each individual box's *own* padding is;
  the symmetric-inset-from-the-snapped-boundary math itself (previous
  entry) didn't need to change at all.
- Reverted back to boxes touching edge-to-edge (removed `BAND_GAP`
  entirely again), with each box's own top/bottom snapped independently
  to the grid, per explicit request to have box borders sit exactly on
  grid lines rather than being inset from them.
- Tried a quarter-grid `contentPadY` that only shifted the first
  process-chip row down, leaving the box's own rect untouched — not
  visible enough (a box with no processes showed no change at all).
  Replaced with: each box's rendered rect (and its top-right remove
  button) is now inset a quarter-grid (`currentGridPx()/4`) from its
  slot's top and bottom, so the diagram's white background actually
  shows through as a visible gap above and below every box. The
  underlying slot math (`by`/`byEnd`, `cumulativeShift`, resize deltas,
  hotzones) is untouched — boxes still tile edge-to-edge with no gap in
  their *allocated* space, same as the "boxes touch, no `BAND_GAP`"
  decision above; only what's drawn inside each slot is inset now. The
  resize handle stays at the slot boundary (`byEnd`) unchanged, which
  now reads as sitting centered in the gap between two boxes' visible
  edges. Scales with the "Grid size" stepper like chip sizing already
  does.
- Made process chips draggable — reorder a chip among its own system's
  siblings, or drop it into a different system box to move it there. A
  bespoke gesture (not the shared `interactions.js` drag helper, which
  only covers a single free-form x position; a chip has none at all, its
  position is purely a flow layout) that reads geometry snapshots taken
  during the last `parseAndLayout` (`lastSystemBoxes`/`lastChipGeom`) to
  figure out, live, which system box the pointer is over and which
  sibling it's nearest to, shows a drop hint (dashed target-box outline +
  insertion marker + a ghost chip following the pointer, all appended
  directly to the live SVG rather than re-rendering on every
  `mousemove`), and on release rewrites the process's own DSL line
  (`moveProcess`) to match.
- Replaced that slot-based reorder-by-dragging with genuine free
  positioning, per explicit request — a chip can now be dropped anywhere
  inside its system box, not just snapped into a computed left-to-right
  slot among its siblings. A dragged chip now gets an explicit pixel
  position in `customLayout` (`posXKey`/`posYKey`, relative to its
  system box's own top-left, snapped to `currentGridPx()`) that
  parseAndLayout renders it at exactly and which opts it out of the
  automatic flow layout entirely; a chip that's never been dragged still
  flows exactly as before (free positioning is opt-in, per chip, on
  first drag). Dropping into a different system box still rewrites that
  line's `in <System>` (`moveProcess`) — but always appends now (no
  before/after sibling to compute), since textual order among a
  system's processes is purely cosmetic once a chip can be positioned
  anywhere. The insertion-marker line from the previous version is gone
  (nothing to mark a "slot" for anymore); the ghost itself is now
  grid-snapped so it previews exactly where the chip will land.
- Made each system's "add process" `+` button itself draggable, per
  explicit request that a newly-added process be droppable anywhere in
  the box too, not just wherever the automatic flow happens to put it.
  Same free-position mechanism as a process chip (`addBtnXKey`/
  `addBtnYKey` in `customLayout`, box-relative, grid-snapped) and the
  same threshold-gated drag-or-click gesture (`onAddBtnDragStart`/
  `Move`/`End`), but scoped to one system's own box (a button can't move
  into another system's, unlike a chip). Once dragged, a click drops the
  new process at the button's own spot (`insertProcessFor`'s new
  `freePos` argument) and the button auto-advances past it (wrapping to
  a new row at the box's right edge) so repeated clicks don't stack. A
  never-dragged button is unchanged: click still appends into the flow.
- Reverted the "add process" button's draggability, per explicit
  request — too much for what was wanted. Back to a plain click button
  (`insertProcessFor(systemName)`, no `freePos`; `addBtnXKey`/
  `addBtnYKey`/`onAddBtnDragStart`/`Move`/`End` all removed), but
  recolored it solid red (`#D0453A` fill, white `+`) instead of the
  system's own tinted color, matching every other "add" control in this
  engine — the actual ask was just a clearer, non-draggable red button,
  not free placement of the button itself (process chips are still
  freely draggable, per the entry above; only the button's own
  draggability is reverted).
