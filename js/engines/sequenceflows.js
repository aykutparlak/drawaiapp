  // ================================================================
  // FILE: js/engines/sequenceflows.js
  // ENGINE: Sequence Flows -- started as a copy of sequence.js, then
  //         stripped back down to just one thing: a column of colored
  //         "system" boxes, stacked top-to-bottom, individually
  //         resizable. Everything else sequence.js had (messages,
  //         activations, notes, loop/alt/opt/par blocks, autonumber,
  //         title) has been deliberately removed -- this is the base
  //         to build a flow-oriented DSL on top of, step by step, and
  //         it's meant to stay this small until the next feature is
  //         asked for, not accumulate sequence-diagram leftovers.
  //
  // This file is fully self-contained: its own (tiny) DSL grammar (parsed
  // below), its own layout math, its own SVG rendering, its own mutation
  // functions (insert/remove/rename a system). It only talks to the rest
  // of the app in two directions:
  //   - IN: calls the generic helpers from js/core/utils.js and
  //     js/core/interactions.js (esc, openInlineEditor, attachDragHandlers,
  //     attachSelectionHandlers, attachRemoveHandlers, attachAddHandlers)
  //     instead of writing its own DOM event wiring, and calls the shared
  //     doRender() (render.js) after any DSL edit.
  //   - OUT: registers one object (see the `return {...}` below) via
  //     registerEngine(SequenceFlowsEngine) at the very end of this file.
  //
  // The full contract for that returned object -- every field, which ones
  // are required, and the DOM/CSS conventions this file's SVG output must
  // follow for the generic interactions above to work -- is documented
  // once, in full, in js/core/state.js under "ADDING A NEW DRAWING STYLE".
  // Read that before changing this file's shape, or before copying this
  // file as a starting point for a new engine.
  //
  // This file can be edited, tested, and reasoned about without reading
  // js/engines/sequence.js, js/engines/swimlane.js (or any future engine)
  // at all -- there is no dependency between engine files.
  //
  // DSL SYNTAX REFERENCE: js/engines/sequenceflows.md -- keep it in sync
  // with this file's grammar (and with the helpHTML block below, which is
  // the in-app copy users see) whenever a statement is added/changed here.
  // ================================================================
  const SequenceFlowsEngine = (function(){

    const SAMPLE = `system Customer
system SSFF
process Login in SSFF
process Verify2FA as Verify 2FA in SSFF
system CIAM
process CreateProfile as Create Profile in CIAM
system MktApps as Marketing Applications`;

    const EMPTY_MESSAGE = 'Add at least one system to see a diagram.';

    // Each system's colored box can be resized by dragging its own bottom
    // edge. Boxes are laid out as a strict top-to-bottom flow, touching
    // edge-to-edge: box[i+1]'s top edge is always box[i]'s bottom edge, by
    // construction (see the cumulativeShift recurrence in parseAndLayout)
    // -- so growing or shrinking one box always pushes every box after it
    // along by the same amount, rather than leaving a gap or causing an
    // overlap. There's deliberately no top-edge handle: box
    // i's bottom edge *is* the shared boundary with box i+1, so a separate
    // "box i+1's top edge" handle at the same spot would just be a
    // duplicate control for the same drag. Only what's stored is a HEIGHT
    // DELTA from box i's natural (tiling-based) height -- never an absolute
    // edge position -- which is what makes the cascade automatic instead
    // of needing to re-anchor every box after a resize. A box's WIDTH is
    // fixed (BOX_W in parseAndLayout) -- only height flows/resizes.
    // The dragged edge snaps to a grid -- GRID_UNIT_PX is the pixel size of
    // one grid unit, and stepper2Value (state.js; this engine's topbar
    // "Grid size" stepper) is how many of those units make up one snap
    // step, adjustable 1-8.
    const GRID_UNIT_PX = 8;
    const MIN_BOX_H = 60;
    function deltaKey(name){ return name + ':d'; } // customLayout key for a box's height-delta-from-natural override -- ':' can't appear in a \w+ system name, so this never collides with a real one
    // customLayout keys for a process chip's own free-drag position, once
    // it's been dragged at least once -- pixel offset from its (current)
    // system box's own top-left (boxLeft, visualTop in parseAndLayout).
    // Both must be set (and finite) for a chip to render free instead of
    // in the automatic flow -- see the free-drag gesture and the chip
    // render loop in parseAndLayout.
    function posXKey(name){ return name + ':px'; }
    function posYKey(name){ return name + ':py'; }
    let lastGridSteps = 3; // gridSteps from the most recent parseAndLayout call -- read by the resize drag below, which runs between renders
    function currentGridPx(){ return GRID_UNIT_PX * (lastGridSteps || 3); }

    let lastOrder = [];
    let lastProcesses = []; // flat list across every system, [{name, label, systemName}]
    // Geometry snapshots from the most recent parseAndLayout call, read by
    // the process-chip drag gesture below (which runs between renders, same
    // reason lastGridSteps/lastOrder/lastProcesses exist) to figure out
    // which system box the pointer is over and which chip it's nearest to.
    let lastSystemBoxes = []; // [{name, top, bottom}] -- each system's VISIBLE rect bounds (post content-pad inset)
    let lastChipGeom = [];    // [{name, systemName, x, y, w, h}] -- one per process chip, in flow order
    let lastBoxLeft = 30, lastBoxRight = 290;

    const systemRe = /^system\s+(\w+)(?:\s+as\s+(.+))?$/i;
    const processRe = /^process\s+(\w+)(?:\s+as\s+(.+?))?\s+in\s+(\w+)$/i;

    function parseAndLayout(text, spacing, gridSteps){
      spacing = spacing || 150;
      lastGridSteps = gridSteps || 3;
      const rawLines = text.split('\n');
      linecount.textContent = rawLines.length + ' line' + (rawLines.length===1?'':'s');

      const lines = rawLines
        .map((l,i)=>({raw:l, i}))
        .filter(l=>{
          const t = l.raw.trim();
          if(!t.length) return false;
          if(/^(#|\/\/|%%)/.test(t)) return false;
          return true;
        });

      const order = [];
      const seenSystems = new Set();
      const processes = [];
      const seenProcesses = new Set();
      for(const {raw, i} of lines){
        const t = raw.trim();
        let m;
        if((m = t.match(systemRe))){
          if(!seenSystems.has(m[1])){
            seenSystems.add(m[1]);
            order.push({name:m[1], label:m[2]?m[2].trim():m[1]});
          }
          continue;
        }
        if((m = t.match(processRe))){
          const [, name, labelRaw, systemName] = m;
          if(seenProcesses.has(name)) continue;
          seenProcesses.add(name);
          processes.push({name, label: labelRaw ? labelRaw.trim() : name, systemName, lineIndex:i});
          continue;
        }
        throw new Error(`Line ${i+1}: could not parse — "${t}"`);
      }

      if(order.length === 0){
        lastOrder = []; // discard any stale system list so the + button starts fresh
        lastProcesses = [];
        lastSystemBoxes = [];
        lastChipGeom = [];
        throw new Error(EMPTY_MESSAGE);
      }

      // A process's system doesn't have to be declared before it in the
      // script -- checked after the full pass above so declaration order
      // between the two statements is free.
      for(const proc of processes){
        if(!seenSystems.has(proc.systemName)){
          throw new Error(`Line ${proc.lineIndex+1}: unknown system "${proc.systemName}"`);
        }
      }
      const processesBySystem = {};
      order.forEach(p=> processesBySystem[p.name] = []);
      processes.forEach(pr=> processesBySystem[pr.systemName].push(pr));

      // Systems stack top-to-bottom now (horizontal boxes), not
      // left-to-right (vertical ones) -- everything below is the same
      // shape of logic as the old x-flow version, just transposed onto y.
      // A box's WIDTH is fixed (BOX_W, every box the same) since that's no
      // longer the resizable axis; only HEIGHT flows/resizes now.
      const minGap = spacing;
      const ys = [];
      let cursorY = 90;
      for(const p of order){
        ys.push(cursorY);
        cursorY += minGap;
      }
      // A system's y is never user-repositioned -- it's always the
      // deterministic auto layout above, in declaration order. Only its
      // box's own bottom edge (see the resize handles below) is
      // user-adjustable.
      order.forEach((p,idx)=>{ p.y = ys[idx]; });

      // Each system gets its own distinct color (cycling through the shared
      // PALETTE by declaration order) instead of the single diagram-wide
      // accent every other engine uses -- that's the whole point of the
      // per-system colored "space" below. A user's own pick via the
      // properties panel (customColors[name], the same generic mechanism
      // sequence/swimlane already use) always wins over the auto-assigned
      // default.
      order.forEach((p, idx)=>{
        const custom = customColors[p.name];
        p.colorKey = (custom && PALETTE[custom]) ? custom : PALETTE_ORDER[idx % PALETTE_ORDER.length];
        p.colorHex = PALETTE[p.colorKey].hex;
      });

      // A fixed margin, not spacing/2 -- spacing/2 could shrink below what
      // the "add before first" / "add after last" +'s (see addZones below)
      // need to fully fit on-canvas (they used to get clipped at the
      // default spacing), and there's no reason this margin should track
      // the *distance between* systems in the first place.
      const EDGE_PAD = 30;
      const topBound = Math.min(...order.map(p=>p.y)) - EDGE_PAD;
      const bottomBound = Math.max(...order.map(p=>p.y)) + EDGE_PAD;

      // Fixed for every box (only height is resizable) but sized to fill
      // the actual canvas pane width, not an arbitrary constant --
      // canvasPaneEl is the same shared DOM ref every engine's shell reads
      // (state.js), and CANVAS_SCROLL_PAD/leftPad/rightPad mirror
      // .canvas-scroll's own 40px padding and our own left/right margins
      // so the box visually reaches the pane's edges on an ordinary
      // window. Capped at MAX_BOX_W though -- on a genuinely wide monitor,
      // filling the *entire* pane would make the box absurdly wide, so
      // past that cap it renders at a reasonable fixed portion instead and
      // .canvas-scroll's own centering (justify-content:safe center)
      // takes care of positioning it in the middle of the extra space.
      // Recomputed on every render, so resizing the window fits correctly
      // on the next edit (there's no live resize listener -- no other
      // engine has one either, so this stays consistent with that).
      const leftPad = 30;
      const rightPad = 30;
      const CANVAS_SCROLL_PAD = 80; // .canvas-scroll's 40px padding, both sides
      const MIN_BOX_W_FLOOR = 260;
      const MAX_BOX_W = 1200; // an ordinary laptop/desktop window fills fully (well under this); only a genuinely wide monitor's pane hits the cap
      const paneW = (canvasPaneEl && canvasPaneEl.clientWidth) || 0;
      const BOX_W = Math.max(MIN_BOX_W_FLOOR, Math.min(MAX_BOX_W, paneW - CANVAS_SCROLL_PAD - leftPad - rightPad));
      const boxLeft = leftPad;
      const boxRight = boxLeft + BOX_W;

      // Each system's own colored box, one per system, stacked top-to-
      // bottom across [topBound, bottomBound], touching edge-to-edge --
      // no gap between boxes. Each box's natural height comes from the
      // midpoint-tiling between neighboring systems, but its ACTUAL
      // rendered position is its natural position plus cumulativeShift --
      // the running total of every earlier box's own height delta. That
      // single recurrence is what guarantees box[i+1].top === box[i].bottom
      // always, no matter what's been resized: resizing box i changes only
      // its own height delta, which shifts every later box by exactly that
      // amount and leaves every earlier box untouched.
      // Every box's own top/bottom is snapped to the nearest grid line
      // (snapToGrid) so its border actually starts/ends ON a grid line
      // rather than floating between two -- since two touching boxes
      // share the same natural boundary (their midpoint), and that
      // boundary is what gets snapped, both sides of the shared border
      // snap to the identical grid line, so they still meet exactly with
      // no gap or overlap after snapping.
      const gridPxForBoxes = currentGridPx();
      function snapToGrid(v){ return Math.round(v / gridPxForBoxes) * gridPxForBoxes; }
      // Each box's own VISIBLE rect is inset a quarter-grid from its slot's
      // top and bottom -- the slot boundaries (by/byEnd) still touch
      // edge-to-edge exactly as before (cumulativeShift, resize deltas,
      // hotzones all keep working off those), but the colored rect drawn
      // inside that slot stops a quarter-grid short on each side, so the
      // diagram's white background actually shows through as a visible gap
      // above and below every box instead of two boxes' colors touching.
      const contentPadY = gridPxForBoxes / 4;
      let cumulativeShift = 0;
      let maxBandBottom = bottomBound; // box edges only, used to place the "add after last" +
      let maxContentBottom = bottomBound; // box edges AND any overflowing process chips, used for the canvas height
      // Process chips render as their OWN top-level [data-node] elements,
      // siblings of the system boxes rather than nested inside a system's
      // own <g data-node="...">. Nesting would work visually, but a
      // process chip's dblclick-to-rename would then bubble up into its
      // parent system's own dblclick listener too (attachDragHandlers
      // wires every [data-node] it finds, nested or not) and open both
      // rename popups at once.
      const allProcessChips = [];
      // Resize handles render as their own top-level layer too, after
      // every box, for a different reason: with boxes touching edge-to-
      // edge (no gap), box i's resize handle sits exactly on the shared
      // boundary with box i+1 -- half its hit-area is geometrically
      // "inside" box i+1's own rect. If the handle were still nested
      // inside box i's own <g> (and so painted before box i+1, which
      // comes later in systemBoxes), box i+1's rect would sit on top and
      // silently swallow clicks on that half. Rendering every handle in
      // one pass after all the boxes guarantees they're always topmost.
      const allResizeHandles = [];
      const systemBoxRects = []; // fed into lastSystemBoxes at the end -- read by the process-chip drag gesture
      const chipGeomAccum = [];  // fed into lastChipGeom at the end -- ditto
      const systemBoxes = order.map((p, idx)=>{
        const naturalTop = idx === 0 ? topBound : (order[idx-1].y + p.y) / 2;
        const naturalBottom = idx === order.length-1 ? bottomBound : (p.y + order[idx+1].y) / 2;
        const delta = customLayout[deltaKey(p.name)] || 0;
        let by = snapToGrid(naturalTop + cumulativeShift);
        let byEnd = snapToGrid(Math.max(by + MIN_BOX_H, naturalBottom + delta + cumulativeShift));
        if(byEnd - by < MIN_BOX_H) byEnd = by + snapToGrid(MIN_BOX_H); // snapping both edges independently could round a very short box below its floor
        cumulativeShift = byEnd - naturalBottom; // carries into every later box's naturalTop/naturalBottom
        maxBandBottom = Math.max(maxBandBottom, byEnd);
        maxContentBottom = Math.max(maxContentBottom, byEnd);
        const cy = (by + byEnd) / 2; // the label centers on the box's ACTUAL height, not p.y, so it stays centered even after a resize shifts this box
        // The rendered rect's own top/bottom -- inset from the slot
        // (by/byEnd) by contentPadY on each side. Symmetric, so the
        // label's cy above (the slot's own midpoint) is still exactly the
        // visible rect's midpoint too -- no separate centering needed.
        const visualTop = by + contentPadY;
        const visualBottom = Math.max(visualTop + 1, byEnd - contentPadY);
        systemBoxRects.push({name:p.name, top:visualTop, bottom:visualBottom});
        const colorStyle = ` style="--amber:${p.colorHex};--teal:${p.colorHex};"`;
        const removeBtn = `
            <g class="remove-btn">
              <circle cx="${boxRight-15}" cy="${visualTop+15}" r="8" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.3"/>
              <text x="${boxRight-15}" y="${visualTop+15+3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                    font-size="10.5" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
            </g>`;
        allResizeHandles.push(`
            <g class="resize-handle" data-resize="${esc(p.name)}">
              <rect x="${boxLeft}" y="${byEnd-5}" width="${BOX_W}" height="10" fill="transparent" style="cursor:ns-resize;"/>
              <rect x="${(boxLeft+boxRight)/2-16}" y="${byEnd-1}" width="32" height="3" rx="1.5"
                    fill="${p.colorHex}" fill-opacity="0.7" style="pointer-events:none;"/>
            </g>`);

        // Each system's own processes -- small chips. A chip the user has
        // never dragged flows left-to-right (wrapping to a new row inside
        // the box once one would run past its right edge), starting well
        // clear of the rotated label -- the original, purely-automatic
        // layout. Once a chip HAS been dragged (see the free-drag gesture
        // below), it carries an explicit pixel position in customLayout
        // (posXKey/posYKey, relative to this box's own top-left) and is
        // rendered exactly there instead -- it opts out of the flow
        // entirely (doesn't consume a flow slot or push later chips
        // around), so it can sit anywhere in the box, including on top of
        // or between flowing chips. Neither kind is part of the height-
        // flow/resize math above: a chip that overflows the box's own
        // (possibly small) height just draws past its bottom edge rather
        // than forcing the box to grow -- resizing the box to fit is still
        // a manual drag, same as everything else in this engine.
        const chipAreaLeft = boxLeft + 50;
        const chipAreaRight = boxRight - 16;
        // Sized in grid units (the same GRID_UNIT_PX/Grid-size-stepper
        // unit a box's own resize snaps to, currentGridPx() above) rather
        // than plain pixels -- a 2x4 grid cell by default, so a process
        // chip's size responds to the topbar's "Grid size" stepper the
        // same way box resizing already does. rx is a fixed, modest
        // corner radius (a rounded rectangle) rather than height/2 (a
        // full pill/stadium shape, which is what the previous fixed
        // 26px-tall chip rounded into).
        const gridPx = currentGridPx();
        const chipH = 2 * gridPx;
        const chipMinW = 4 * gridPx;
        const chipRadius = 8;
        const chipGapX = 8, chipGapY = 8;
        let chipX = chipAreaLeft, chipRowY = visualTop + 40;
        (processesBySystem[p.name] || []).forEach(pr=>{
          const w = Math.max(chipMinW, pr.label.length * 6.5 + 24);
          const freeX = customLayout[posXKey(pr.name)];
          const freeY = customLayout[posYKey(pr.name)];
          let x, y;
          if(isFinite(freeX) && isFinite(freeY)){
            // Freely placed -- clamped to stay horizontally inside this
            // box (a fixed width, so it can never spill off the box's own
            // left/right edge), but not vertically: same overflow-past-
            // the-bottom allowance every flow chip already gets.
            x = boxLeft + Math.max(8, Math.min(BOX_W - w - 8, freeX));
            y = visualTop + Math.max(0, freeY);
            maxContentBottom = Math.max(maxContentBottom, y + chipH + 20);
          } else {
            if(chipX + w > chipAreaRight && chipX > chipAreaLeft){ chipX = chipAreaLeft; chipRowY += chipH + chipGapY; }
            x = chipX; y = chipRowY;
            chipX += w + chipGapX;
          }
          chipGeomAccum.push({name:pr.name, systemName:p.name, x, y, w, h:chipH});
          allProcessChips.push(`
            <g data-node="${esc(pr.name)}" data-node-kind="process" class="has-remove">
              <rect x="${x}" y="${y}" width="${w}" height="${chipH}" rx="${chipRadius}" fill="#FFFFFF" stroke="${p.colorHex}" stroke-width="1.3"/>
              <text x="${x+w/2}" y="${y+chipH/2+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                    font-size="10.5" font-weight="600" fill="#1F2430" style="pointer-events:none;">${esc(pr.label)}</text>
              <g class="remove-btn">
                <circle cx="${x+w-10}" cy="${y+10}" r="6" fill="#D0453A" stroke="#FFFFFF" stroke-width="1"/>
                <text x="${x+w-10}" y="${y+10+2.8}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                      font-size="8" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
              </g>
            </g>`);
        });
        // A single red "+" right after the last chip (or where the first
        // would go, if the system has none) -- click it to add a new
        // process to this system. Not draggable -- just a plain button,
        // same red as every other "add" control in this engine (the
        // add-system hotzones below) and the remove badges, rather than
        // the system's own tinted color, so it reads as an action rather
        // than part of the box's own content.
        const ADD_PROCESS_BTN_W = 26;
        if(chipX + ADD_PROCESS_BTN_W > chipAreaRight && chipX > chipAreaLeft){ chipX = chipAreaLeft; chipRowY += chipH + chipGapY; }
        const addProcessCx = chipX + 11, addProcessCy = chipRowY + chipH/2;
        maxContentBottom = Math.max(maxContentBottom, addProcessCy + 20);
        allProcessChips.push(`
          <g class="add-process-btn" data-add-process="${esc(p.name)}" style="cursor:pointer;">
            <circle cx="${addProcessCx}" cy="${addProcessCy}" r="11" fill="#D0453A"/>
            <text x="${addProcessCx}" y="${addProcessCy+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="13" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">+</text>
          </g>`);

        // No data-x -- a system box is selectable/renamable (dblclick
        // anywhere on it)/removable (data-node), but deliberately never
        // draggable, unlike sequence/swimlane's nodes.
        return `
          <g data-node="${esc(p.name)}" data-node-kind="system" class="has-remove"${colorStyle}>
            <rect x="${boxLeft}" y="${visualTop}" width="${BOX_W}" height="${visualBottom-visualTop}" rx="8"
                  fill="${p.colorHex}" opacity="0.1" stroke="var(--amber,#2F6FED)" stroke-width="1.3"/>
            <text x="${boxLeft+20}" y="${cy}" text-anchor="middle" transform="rotate(-90 ${boxLeft+20} ${cy})"
                  font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="#1F2430"
                  style="pointer-events:none;">${esc(p.label)}</text>
            ${removeBtn}
          </g>`;
      }).join('');

      const totalW = boxRight + rightPad;
      const totalH = maxContentBottom + 40; // the "add after last" + (see addZones below) sits below maxContentBottom -- this needs enough room for it to not get clipped

      // Only "add before first" (index 0) and "add after last" (index
      // order.length) -- no zone between every pair of boxes anymore.
      // The hit area is a small circle around the visible +, not a strip
      // spanning the box's full width -- clicking empty space to its
      // right used to insert a system too, which read as a stray click
      // doing something unexpected.
      const addZones = [0, order.length].map(idx=>{
        const gy = idx === 0 ? topBound - 14 : maxContentBottom + 14;
        const gx = boxLeft + 20; // left side, lined up with the rotated label's own anchor -- not centered
        return `
          <g class="add-hotzone" data-insert-index="${idx}">
            <circle cx="${gx}" cy="${gy}" r="14" fill="transparent"/>
            <circle class="add-btn" cx="${gx}" cy="${gy}" r="10" fill="#D0453A"/>
            <text class="add-btn" x="${gx}" y="${gy+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="14" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">+</text>
          </g>`;
      });

      lastOrder = order.map(p=>({name:p.name, label:p.label}));
      lastProcesses = processes.map(pr=>({name:pr.name, label:pr.label, systemName:pr.systemName}));
      lastSystemBoxes = systemBoxRects;
      lastChipGeom = chipGeomAccum;
      lastBoxLeft = boxLeft;
      lastBoxRight = boxRight;

      // A faint dot grid across the whole canvas, spaced at currentGridPx()
      // -- the same increment box-resize and process-chip sizing already
      // snap to -- so it visually shows people where things will land
      // instead of just being decorative. Pure background: no
      // pointer-events, drawn once behind everything via an SVG <pattern>
      // rather than a rect per dot (cheap regardless of canvas size).
      const bgGridPx = currentGridPx();
      const bgGrid = `
        <defs>
          <pattern id="bgGrid" width="${bgGridPx}" height="${bgGridPx}" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--line-soft,#D6DAE1)"/>
          </pattern>
        </defs>
        <rect x="0" y="0" width="${totalW}" height="${totalH}" fill="url(#bgGrid)" style="pointer-events:none;"/>`;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}"
                    viewBox="0 0 ${totalW} ${totalH}" font-family="IBM Plex Sans, sans-serif" style="${accentStyleAttr()}">
          <rect class="diagram-bg" x="0" y="0" width="${totalW}" height="${totalH}" fill="#FFFFFF"/>
          ${bgGrid}
          ${addZones.join('')}
          ${systemBoxes}
          ${allProcessChips.join('')}
          ${allResizeHandles.join('')}
        </svg>`;

      return svg;
    }

    // ---------------- mutations ----------------

    function allDeclaredNames(){
      return [...lastOrder.map(p=>p.name), ...lastProcesses.map(p=>p.name)];
    }

    function insertSystemAt(index){
      const names = lastOrder.map(p=>p.name);
      const taken = allDeclaredNames();
      let n = 1;
      while(taken.includes('P'+n)) n++;
      const newName = 'P' + n;

      const declRe = /^\s*system\s+(\w+)(?:\s+as\s+(.+))?\s*$/i;
      const lines = dslEl.value.split('\n');
      const declByName = {};
      const rest = []; // everything that isn't a system decl -- process lines, blanks -- preserved as-is
      lines.forEach(line=>{
        const m = line.match(declRe);
        if(m) declByName[m[1]] = line.trim();
        else rest.push(line);
      });
      while(rest.length && rest[0].trim() === '') rest.shift();

      const finalNames = names.slice();
      finalNames.splice(index, 0, newName);
      const declLines = finalNames.map(nm =>
        nm === newName ? `system ${newName}` : (declByName[nm] || `system ${nm}`)
      );

      const newText = declLines.join('\n') + '\n\n' + rest.join('\n');
      dslEl.value = newText;
      doRender();

      const pos = newText.indexOf(newName);
      if(pos !== -1){
        dslEl.focus();
        dslEl.setSelectionRange(pos, pos + newName.length);
      }
    }

    function removeSystem(name){
      lastProcesses.filter(pr=>pr.systemName===name).forEach(pr=>{
        delete customLayout[posXKey(pr.name)];
        delete customLayout[posYKey(pr.name)];
      });
      const lines = dslEl.value.split('\n').filter(rawLine=>{
        const t = rawLine.trim();
        const sysM = t.match(systemRe);
        if(sysM && sysM[1] === name) return false; // the system itself
        const procM = t.match(processRe);
        if(procM && procM[3] === name) return false; // every process that belonged to it goes with it
        return true;
      });

      let text = lines.join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n');

      delete customLayout[name]; // legacy cleanup -- headers no longer write a position override themselves, but a file saved before that change might still carry a stale one
      delete customLayout[deltaKey(name)];
      // legacy cleanup -- a brief since-reverted version let the "add
      // process" button itself carry a free position under these keys
      delete customLayout[name + ':bx'];
      delete customLayout[name + ':by'];
      // legacy cleanup -- an even older version stored two independent edge overrides instead of one delta
      delete customLayout[name + ':bl'];
      delete customLayout[name + ':br'];
      dslEl.value = text;
      doRender();
    }

    function renameSystem(name, newLabel){
      const lines = dslEl.value.split('\n');
      const declText = (newLabel === name) ? `system ${name}` : `system ${name} as ${newLabel}`;

      let foundIdx = -1;
      lines.forEach((line, idx)=>{
        const m = line.trim().match(systemRe);
        if(m && m[1] === name) foundIdx = idx;
      });

      if(foundIdx !== -1){
        const leading = lines[foundIdx].match(/^\s*/)[0];
        lines[foundIdx] = leading + declText;
      } else {
        lines.push(declText);
      }

      dslEl.value = lines.join('\n');
      doRender();
    }

    // A process is declared right after the last existing process for its
    // system (or right after the system's own declaration, if it has none
    // yet), never just appended to the end of the file -- keeps every
    // system's processes textually grouped under it, same as how a
    // person would naturally write this by hand.
    function insertProcessFor(systemName){
      const taken = allDeclaredNames();
      let n = 1;
      while(taken.includes('Proc'+n)) n++;
      const newName = 'Proc' + n;

      const lines = dslEl.value.split('\n');
      let insertAfter = -1;
      lines.forEach((line, idx)=>{
        const t = line.trim();
        const sysM = t.match(systemRe);
        if(sysM && sysM[1] === systemName) insertAfter = idx;
        const procM = t.match(processRe);
        if(procM && procM[3] === systemName) insertAfter = idx;
      });
      if(insertAfter === -1) insertAfter = lines.length - 1;

      const newLine = `process ${newName} in ${systemName}`;
      lines.splice(insertAfter + 1, 0, newLine);
      const newText = lines.join('\n');
      dslEl.value = newText;
      doRender();

      const pos = newText.indexOf(newName);
      if(pos !== -1){
        dslEl.focus();
        dslEl.setSelectionRange(pos, pos + newName.length);
      }
    }

    // Moves an existing process to a new spot -- a new system (drag it into
    // a different box) and/or a new position among its (possibly new)
    // system's other processes (drag it left/right past a sibling chip).
    // Same underlying edit either way: pull the process's own line out and
    // reinsert it elsewhere, rewriting its `in <System>` if the system
    // changed. `beforeName`/`afterName` (at most one set) name the sibling
    // process to land next to in the TARGET system; if neither is given,
    // the target system has no other processes (or none were findable), so
    // it's placed the same way insertProcessFor places a brand new one --
    // right after that system's own declaration or last process line.
    function moveProcess(name, targetSystemName, beforeName, afterName){
      const lines = dslEl.value.split('\n');
      let ownIdx = -1, ownLabel = null;
      lines.forEach((line, idx)=>{
        const m = line.trim().match(processRe);
        if(m && m[1] === name){ ownIdx = idx; ownLabel = m[2] ? m[2].trim() : name; }
      });
      if(ownIdx === -1) return;

      lines.splice(ownIdx, 1); // pull it out first -- every index below is relative to the trimmed array

      let insertAt = -1;
      const refName = beforeName || afterName;
      if(refName){
        lines.forEach((line, idx)=>{
          const m = line.trim().match(processRe);
          if(m && m[1] === refName) insertAt = idx;
        });
        if(insertAt !== -1 && afterName) insertAt += 1; // "before" lands AT the ref's index; "after" lands one past it
      }
      if(insertAt === -1){
        // No sibling to anchor to (target system is empty, or its sibling
        // vanished) -- fall back to insertProcessFor's own placement rule.
        lines.forEach((line, idx)=>{
          const t = line.trim();
          const sysM = t.match(systemRe);
          if(sysM && sysM[1] === targetSystemName) insertAt = idx;
          const procM = t.match(processRe);
          if(procM && procM[3] === targetSystemName) insertAt = idx;
        });
        insertAt = insertAt === -1 ? lines.length : insertAt + 1;
      }

      const newLine = (ownLabel === name)
        ? `process ${name} in ${targetSystemName}`
        : `process ${name} as ${ownLabel} in ${targetSystemName}`;
      lines.splice(insertAt, 0, newLine);
      dslEl.value = lines.join('\n');
      doRender();
    }

    function removeProcess(name){
      const lines = dslEl.value.split('\n').filter(rawLine=>{
        const m = rawLine.trim().match(processRe);
        return !(m && m[1] === name);
      });
      delete customLayout[posXKey(name)];
      delete customLayout[posYKey(name)];
      dslEl.value = lines.join('\n').replace(/\n{3,}/g, '\n\n');
      doRender();
    }

    function renameProcess(name, newLabel){
      const lines = dslEl.value.split('\n');
      let foundIdx = -1, systemName = null;
      lines.forEach((line, idx)=>{
        const m = line.trim().match(processRe);
        if(m && m[1] === name){ foundIdx = idx; systemName = m[3]; }
      });
      if(foundIdx === -1) return;
      const leading = lines[foundIdx].match(/^\s*/)[0];
      lines[foundIdx] = leading + ((newLabel === name)
        ? `process ${name} in ${systemName}`
        : `process ${name} as ${newLabel} in ${systemName}`);
      dslEl.value = lines.join('\n');
      doRender();
    }

    // ---------------- inline edit: rename a system or process ----------------

    function startNodeRename(g){
      const name = g.getAttribute('data-node');
      if(!name) return;
      const kind = g.getAttribute('data-node-kind');
      const list = kind === 'process' ? lastProcesses : lastOrder;
      const p = list.find(x => x.name === name);
      const currentLabel = p ? p.label : name;
      const rectEl = g.querySelector('rect');
      const box = (rectEl || g).getBoundingClientRect();
      openInlineEditor({
        anchorRect: box,
        initialValue: currentLabel,
        textAlign: 'center',
        onCommit: (val)=>{
          if(!val || val === currentLabel) return;
          if(kind === 'process') renameProcess(name, val);
          else renameSystem(name, val);
        }
      });
    }

    // ---------------- drag a system box's bottom edge to resize it ----------------
    // Not a generic interactions.js helper (that only covers x-position
    // dragging via data-x) -- a bespoke gesture. Only a height DELTA is
    // stored (never an absolute edge position) -- see the cumulativeShift
    // recurrence above parseAndLayout's systemBoxes for why that's what
    // makes resizing one box automatically push every later box along by
    // the same amount.

    let resizeState = null;

    function onResizeStart(e){
      if(e.type === 'mousedown' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      const name = handle.getAttribute('data-resize');
      const svg = holder.querySelector('svg');
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      resizeState = {
        name,
        startDelta: customLayout[deltaKey(name)] || 0,
        startMouseY: svgClientY(svg, clientY)
      };
      window.addEventListener('mousemove', onResizeMove);
      window.addEventListener('touchmove', onResizeMove, {passive:false});
      window.addEventListener('mouseup', onResizeEnd);
      window.addEventListener('touchend', onResizeEnd);
    }

    function onResizeMove(e){
      if(!resizeState) return;
      if(e.touches) e.preventDefault();
      const svg = holder.querySelector('svg');
      if(!svg) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const curY = svgClientY(svg, clientY);
      const dy = curY - resizeState.startMouseY;
      const grid = currentGridPx();
      customLayout[deltaKey(resizeState.name)] = resizeState.startDelta + Math.round(dy / grid) * grid;
      doRender();
    }

    function onResizeEnd(){
      resizeState = null;
      window.removeEventListener('mousemove', onResizeMove);
      window.removeEventListener('touchmove', onResizeMove);
      window.removeEventListener('mouseup', onResizeEnd);
      window.removeEventListener('touchend', onResizeEnd);
    }

    // ---------------- drag a process chip to place it freely, or into another system ----------------
    // Not the generic interactions.js drag helper (that's a single x-only
    // position) -- a bespoke 2D gesture. A dragged chip gets an explicit
    // pixel position (posXKey/posYKey, relative to its system box's own
    // top-left) that parseAndLayout renders it at exactly, opting it out
    // of the automatic flow layout entirely -- it can land anywhere inside
    // the box, not just wherever the flow would have put it. Dragging it
    // into a DIFFERENT system box also rewrites that line's `in <System>`
    // (via moveProcess, always appending -- textual order among a
    // system's processes is cosmetic once a chip has a free position, so
    // there's no "before/after sibling" to compute here the way the
    // previous slot-based version needed).

    let processDragState = null;
    const DRAG_THRESHOLD = 4; // px of real movement before a mousedown becomes a drag, so a plain click/dblclick still works

    function findTargetSystem(svgY){
      if(!lastSystemBoxes.length) return null;
      const first = lastSystemBoxes[0], last = lastSystemBoxes[lastSystemBoxes.length-1];
      if(svgY <= first.top) return first.name;
      if(svgY >= last.bottom) return last.name;
      for(const sb of lastSystemBoxes){
        if(svgY >= sb.top && svgY <= sb.bottom) return sb.name;
      }
      // Between two boxes (inside the quarter-grid visual gap) -- whichever edge is closer.
      let best = first, bestDist = Infinity;
      for(const sb of lastSystemBoxes){
        const d = svgY < sb.top ? sb.top - svgY : svgY - sb.bottom;
        if(d < bestDist){ bestDist = d; best = sb; }
      }
      return best.name;
    }

    const NS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs){
      const el = document.createElementNS(NS, tag);
      for(const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }

    function onProcessDragStart(e){
      if(e.type === 'mousedown' && e.button !== 0) return;
      const g = e.currentTarget;
      const name = g.getAttribute('data-node');
      const proc = lastProcesses.find(p=>p.name === name);
      if(!proc) return;
      const svg = holder.querySelector('svg');
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const geom = lastChipGeom.find(c=>c.name === name) || {x:0,y:0,w:120,h:24};
      processDragState = {
        name,
        originSystem: proc.systemName,
        g,
        geom,
        startClientX: clientX,
        startClientY: clientY,
        startSvgX: svgClientX(svg, clientX),
        startSvgY: svgClientY(svg, clientY),
        moved: false,
        ghostEl: null,
        hintRectEl: null,
        target: null
      };
      window.addEventListener('mousemove', onProcessDragMove);
      window.addEventListener('touchmove', onProcessDragMove, {passive:false});
      window.addEventListener('mouseup', onProcessDragEnd);
      window.addEventListener('touchend', onProcessDragEnd);
    }

    function beginProcessGhost(){
      const svg = holder.querySelector('svg');
      if(!svg) return;
      const {geom} = processDragState;
      const ghost = svgEl('g', {style:'pointer-events:none; opacity:0.85;'});
      ghost.appendChild(svgEl('rect', {width:geom.w, height:geom.h, rx:8, fill:'#FFFFFF', stroke:'#2F6FED', 'stroke-width':2}));
      const label = lastProcesses.find(p=>p.name===processDragState.name);
      const text = svgEl('text', {x:geom.w/2, y:geom.h/2+4, 'text-anchor':'middle', 'font-family':'IBM Plex Mono, monospace', 'font-size':10.5, 'font-weight':600, fill:'#1F2430'});
      text.textContent = label ? label.label : processDragState.name;
      ghost.appendChild(text);
      svg.appendChild(ghost);
      processDragState.ghostEl = ghost;

      const hintRect = svgEl('rect', {rx:8, fill:'none', stroke:'#2F6FED', 'stroke-width':2, 'stroke-dasharray':'6,4', style:'pointer-events:none;'});
      svg.appendChild(hintRect);
      processDragState.hintRectEl = hintRect;

      processDragState.g.style.opacity = '0.3';
    }

    function onProcessDragMove(e){
      if(!processDragState) return;
      if(e.touches) e.preventDefault();
      const svg = holder.querySelector('svg');
      if(!svg) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      if(!processDragState.moved){
        if(Math.hypot(clientX - processDragState.startClientX, clientY - processDragState.startClientY) < DRAG_THRESHOLD) return;
        processDragState.moved = true;
        beginProcessGhost();
      }

      const svgX = svgClientX(svg, clientX);
      const svgY = svgClientY(svg, clientY);
      const grabDX = processDragState.startSvgX - processDragState.geom.x;
      const grabDY = processDragState.startSvgY - processDragState.geom.y;
      const {geom} = processDragState;

      const targetSystemName = findTargetSystem(svgY);
      const sb = lastSystemBoxes.find(b=>b.name === targetSystemName);

      // Position relative to the target box's own top-left, snapped to the
      // grid (the same currentGridPx() every other placement in this
      // engine snaps to) -- clamped horizontally so the chip can't spill
      // off the box's fixed-width edges, but not vertically: same
      // overflow-past-the-bottom allowance every flow chip already gets.
      const grid = currentGridPx();
      const rawX = svgX - grabDX - lastBoxLeft;
      const rawY = sb ? (svgY - grabDY - sb.top) : 0;
      const relX = Math.max(8, Math.min((lastBoxRight - lastBoxLeft) - geom.w - 8, Math.round(rawX / grid) * grid));
      const relY = Math.max(0, Math.round(rawY / grid) * grid);
      processDragState.target = {systemName: targetSystemName, relX, relY};

      if(sb){
        processDragState.ghostEl.setAttribute('transform', `translate(${lastBoxLeft + relX}, ${sb.top + relY})`);
        processDragState.hintRectEl.setAttribute('x', lastBoxLeft);
        processDragState.hintRectEl.setAttribute('y', sb.top);
        processDragState.hintRectEl.setAttribute('width', lastBoxRight - lastBoxLeft);
        processDragState.hintRectEl.setAttribute('height', sb.bottom - sb.top);
      } else {
        processDragState.ghostEl.setAttribute('transform', `translate(${svgX - grabDX}, ${svgY - grabDY})`);
      }
    }

    function onProcessDragEnd(){
      if(!processDragState) return;
      const {g, ghostEl, hintRectEl, moved, name, originSystem, target} = processDragState;
      if(ghostEl) ghostEl.remove();
      if(hintRectEl) hintRectEl.remove();
      if(g) g.style.opacity = '';

      if(moved){
        // The drag's mouseup/touchend lands on whatever element is under the
        // pointer (often a sibling chip or another system box) -- swallow
        // the synthetic click that follows so it doesn't also select that
        // element right after the move.
        const swallow = (ev)=>{ ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', swallow, {capture:true, once:true});
        setTimeout(()=> document.removeEventListener('click', swallow, {capture:true}), 0);

        if(target && target.systemName){
          customLayout[posXKey(name)] = target.relX;
          customLayout[posYKey(name)] = target.relY;
          if(target.systemName !== originSystem) moveProcess(name, target.systemName, null, null);
          else doRender();
        }
      }

      processDragState = null;
      window.removeEventListener('mousemove', onProcessDragMove);
      window.removeEventListener('touchmove', onProcessDragMove);
      window.removeEventListener('mouseup', onProcessDragEnd);
      window.removeEventListener('touchend', onProcessDragEnd);
    }

    // ---------------- attach ----------------

    function attach(svg){
      attachDragHandlers(svg, startNodeRename);
      attachSelectionHandlers(svg);

      svg.querySelectorAll('.resize-handle').forEach(g=>{
        g.addEventListener('mousedown', onResizeStart);
        g.addEventListener('touchstart', onResizeStart, {passive:false});
      });

      attachRemoveHandlers(svg, (btn)=>{
        const nodeG = btn.closest('[data-node]');
        if(!nodeG) return;
        const name = nodeG.getAttribute('data-node');
        if(nodeG.getAttribute('data-node-kind') === 'process') removeProcess(name);
        else removeSystem(name);
      });

      attachAddHandlers(svg, insertSystemAt);

      svg.querySelectorAll('[data-node-kind="process"]').forEach(g=>{
        g.addEventListener('mousedown', onProcessDragStart);
        g.addEventListener('touchstart', onProcessDragStart, {passive:false});
      });

      svg.querySelectorAll('.add-process-btn').forEach(g=>{
        g.addEventListener('click', (e)=>{
          e.stopPropagation();
          insertProcessFor(g.getAttribute('data-add-process'));
        });
      });
    }

    return {
      id: 'sequenceflows',
      label: 'Sequence Flows',
      mark: 'SEQF',
      sample: SAMPLE,
      emptyMessage: EMPTY_MESSAGE,
      emptyLabel: 'system',
      exportBaseName: 'sequenceflows-diagram',
      // Small (~100x56) inline SVG shown as this type's card in the "New
      // diagram" modal -- purely decorative, doesn't need to match the real
      // renderer's output.
      thumbnail: `<svg width="100" height="56" viewBox="0 0 100 56" fill="none">
          <rect x="10" y="4" width="80" height="12" rx="4" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.4"/>
          <rect x="10" y="22" width="80" height="12" rx="4" fill="#E5F9F6" stroke="#0EA5A5" stroke-width="1.4"/>
          <rect x="10" y="40" width="80" height="12" rx="4" fill="#F1ECFE" stroke="#7C5CFC" stroke-width="1.4"/>
        </svg>`,
      // Shown in the right-hand properties panel when nothing on the
      // canvas is selected -- tells the user what they can click.
      selectionHint: 'Click a system or process on the canvas to edit its text or color.',
      spacing: {label:'Row spacing', min:90, max:360, step:10, default:150},
      toggle: {label:'Grid size', type:'stepper', min:1, max:8, step:1, default:3},
      snippets: [
        {key:'system', label:'+ system', text:'system Name\n'},
        {key:'process', label:'+ process', text:'process Name in System\n'}
      ],
      helpHTML: `
        <div><b>system</b> Name [as Label]</div>
        <div><b>process</b> Name [as Label] <b>in</b> System</div>
        <div>Each system gets its own colored box, one per declared system, stacked top-to-bottom in declaration order.</div>
        <div>Systems are laid out automatically — they can't be dragged.</div>
        <div>Drag a system box's bottom edge to resize it — every box after it slides down to keep the same gap; height snaps to the topbar's <b>Grid size</b> stepper (bigger number = coarser, more spread-out snapping); use <b>Reset layout</b> to undo.</div>
        <div>Hover just above the first box or just below the last one and click the red <b>+</b> to add a system there.</div>
        <div>Hover a system box and click the red <b>×</b> in its corner to remove it — every process inside it goes with it.</div>
        <div>Double-click a system box to rename it in place — Enter to save, Esc to cancel.</div>
        <div>Click the red <b>+</b> inside a system box to add a process to it — processes flow left to right, wrapping to a new line inside the box.</div>
        <div>Double-click a process chip to rename it, or click the red <b>×</b> on it to remove just that process.</div>
        <div>Drag a process chip anywhere inside its system box to place it freely, or drop it into a different system box to move it there.</div>`,
      parseAndLayout,
      insertPrimaryAt: insertSystemAt,
      attach,
      // ---- uniform hooks the right-hand properties panel uses ----
      getNodeLabel: (id)=>{
        const s = lastOrder.find(x=>x.name===id);
        if(s) return s.label;
        const p = lastProcesses.find(x=>x.name===id);
        return p ? p.label : undefined;
      },
      renameNode: (id, val)=>{
        if(lastOrder.find(x=>x.name===id)) renameSystem(id, val);
        else renameProcess(id, val);
      },
      removeNode: (id)=>{
        if(lastOrder.find(x=>x.name===id)) removeSystem(id);
        else removeProcess(id);
      }
    };
  })();

  registerEngine(SequenceFlowsEngine);
