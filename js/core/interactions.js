  // ================================================================
  // FILE: js/core/interactions.js
  // WHAT: The generic interaction layer every engine builds on: drag-to-
  //       reposition, click-badge-to-remove, "+" hotzone insert, click-to-
  //       select (drives the properties panel), double-click-to-edit
  //       dispatch, and press-and-drag-to-connect. None of it knows
  //       anything about Sequence or Swimlane specifically -- it only ever
  //       reads the generic data-node/data-lane/.editable-label/
  //       .add-hotzone/.link-handle/.diagram-bg conventions documented in
  //       full in state.js (search "ADDING A NEW DRAWING STYLE" there).
  //       An engine's attach(svgEl) wires these up with small callbacks;
  //       it should almost never need its own raw addEventListener calls.
  // DEPENDS ON: state.js (customLayout, dragState, linkState, selectElement,
  //       canvasPaneEl, linkHintEl, holder), utils.js (svgClientX/Y).
  // USED BY: every js/engines/*.js file, from inside attach(svgEl).
  // ================================================================
  // ---------------- generic drag-to-reposition (x-only) ----------------
  // Both engines render their primary draggable shape with data-node="<id>"
  // and data-x="<current x>"; dragging just rewrites customLayout[id].

  function attachDragHandlers(svg, onRename){
    svg.querySelectorAll('[data-node]').forEach(g=>{
      g.addEventListener('mousedown', onDragStart);
      g.addEventListener('touchstart', onDragStart, {passive:false});
      if(onRename){
        g.addEventListener('dblclick', (e)=>{ e.stopPropagation(); onRename(g); });
      }
    });
  }
  function onDragStart(e){
    const g = e.currentTarget;
    const svg = holder.querySelector('svg');
    const startX = parseFloat(g.getAttribute('data-x'));
    if(!isFinite(startX)) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    e.preventDefault();
    dragState = {
      id: g.getAttribute('data-node'),
      startX,
      startMouseX: svgClientX(svg, clientX)
    };
  }
  function onDragMove(e){
    if(!dragState) return;
    if(e.touches) e.preventDefault();
    const svg = holder.querySelector('svg');
    if(!svg) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const curX = svgClientX(svg, clientX);
    const nextX = dragState.startX + (curX - dragState.startMouseX);
    if(isFinite(nextX)) customLayout[dragState.id] = nextX;
    doRender();
  }
  function onDragEnd(){ dragState = null; }
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchmove', onDragMove, {passive:false});
  window.addEventListener('touchend', onDragEnd);

  // ---------------- generic "click badge to remove" wiring ----------------
  // Covers both the corner .remove-btn (on primary shapes) and the inline
  // .inline-remove-btn (on notes/blocks/etc.) -- the engine's callback
  // inspects the button's ancestry to decide what, specifically, to remove.

  function attachRemoveHandlers(svg, onRemove){
    svg.querySelectorAll('.remove-btn, .inline-remove-btn').forEach(btn=>{
      btn.addEventListener('mousedown', e=> e.stopPropagation());
      btn.addEventListener('touchstart', e=> e.stopPropagation());
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        onRemove(btn);
      });
    });
  }

  // ---------------- generic "+" hotzone wiring (insert primary node) ----------------

  function attachAddHandlers(svg, onInsert){
    svg.querySelectorAll('.add-hotzone').forEach(g=>{
      g.addEventListener('click', ()=>{
        onInsert(parseInt(g.getAttribute('data-insert-index'), 10));
      });
    });
  }

  // ---------------- generic click-to-select (drives the right-hand properties panel) ----------------
  // Only the shapes with a stable id (participants/lanes/steps) are
  // selectable -- arrows, notes, and blocks stay dblclick-to-edit only, same
  // as before. Clicking empty canvas deselects.

  function attachSelectionHandlers(svg){
    svg.querySelectorAll('[data-node]').forEach(g=>{
      g.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(selectElement) selectElement({kind:'node', id: g.getAttribute('data-node')});
      });
    });
    svg.querySelectorAll('[data-lane]').forEach(g=>{
      g.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(selectElement) selectElement({kind:'lane', id: g.getAttribute('data-lane')});
      });
    });
    const bg = svg.querySelector('.diagram-bg');
    if(bg) bg.addEventListener('click', ()=>{ if(selectElement) selectElement(null); });
  }

  // ---------------- generic double-click-to-edit dispatch ----------------
  // Elements carrying class "editable-label" and data-edit="<kind>" get
  // routed to dispatchMap[kind](el) on dblclick.

  function attachEditableHandlers(svg, dispatchMap){
    svg.querySelectorAll('.editable-label').forEach(g=>{
      g.addEventListener('dblclick', (e)=>{
        e.stopPropagation();
        const kind = g.getAttribute('data-edit');
        const fn = dispatchMap[kind];
        if(fn) fn(g);
      });
    });
  }

  // ---------------- generic drag-to-connect ("+" handle -> another node) ----------------
  // Engines call startLinkDrag(fromId, opts) from their own .link-handle
  // mousedown wiring. opts:
  //   getPoints()      -> [{id,x,y}, ...] every point this gesture may snap to
  //   distance(p,x,y)  -> numeric distance function (1D for lifelines, 2D for steps)
  //   snapRadius       -> px
  //   onDrop(fromId,toId,clientX,clientY) -> called on a successful snap-release

  const SHARED_LINK_MARKER_ID = 'sharedLinkArrow';

  function ensureLinkMarker(svg){
    if(svg.querySelector('#'+SHARED_LINK_MARKER_ID)) return;
    const ns = 'http://www.w3.org/2000/svg';
    let defs = svg.querySelector('defs');
    if(!defs){ defs = document.createElementNS(ns, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', SHARED_LINK_MARKER_ID);
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '4');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
    path.setAttribute('fill', '#D0453A');
    marker.appendChild(path);
    defs.appendChild(marker);
  }

  function attachLinkHandleHandlers(svg, optsFor){
    svg.querySelectorAll('.link-handle').forEach(g=>{
      function onPressStart(e){
        e.preventDefault();
        e.stopPropagation();
        const fromId = g.getAttribute('data-linksrc');
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startLinkDrag(fromId, optsFor(g, clientY));
      }
      g.addEventListener('mousedown', onPressStart);
      g.addEventListener('touchstart', onPressStart, {passive:false});
    });
  }

  function startLinkDrag(fromId, opts){
    const svg = holder.querySelector('svg');
    if(!svg) return;
    const points = opts.getPoints();
    const p = points.find(pt=>pt.id === fromId);
    if(!p) return;
    ensureLinkMarker(svg);
    const ns = 'http://www.w3.org/2000/svg';

    const startY = (opts.startY !== undefined) ? opts.startY : p.y;

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', p.x); line.setAttribute('y1', startY);
    line.setAttribute('x2', p.x); line.setAttribute('y2', startY);
    line.setAttribute('stroke', '#D0453A');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6,4');
    line.setAttribute('marker-end', 'url(#'+SHARED_LINK_MARKER_ID+')');
    line.setAttribute('pointer-events', 'none');
    svg.appendChild(line);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', startY);
    dot.setAttribute('r', '4'); dot.setAttribute('fill', '#D0453A');
    dot.setAttribute('pointer-events', 'none');
    svg.appendChild(dot);

    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('r', '15');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#2F6FED');
    ring.setAttribute('stroke-width', '2.5');
    ring.setAttribute('pointer-events', 'none');
    ring.setAttribute('opacity', '0');
    svg.appendChild(ring);

    linkState = {from: fromId, startY, lineEl: line, dotEl: dot, ringEl: ring, magnetTo: null, opts};
    canvasPaneEl.classList.add('linking-mode');
    linkHintEl.classList.add('show');
  }

  function onLinkMove(e){
    if(!linkState) return;
    if(e.touches) e.preventDefault();
    const svg = holder.querySelector('svg');
    if(!svg) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = svgClientX(svg, clientX);
    const yRaw = svgClientY(svg, clientY);
    const {opts} = linkState;
    const y = opts.clampY ? opts.clampY(yRaw) : yRaw;

    const points = opts.getPoints(x, y);
    let nearest = null, nearestDist = Infinity;
    for(const pt of points){
      const d = opts.distance(pt, x, y);
      if(d < nearestDist){ nearestDist = d; nearest = pt; }
    }
    const magnetTo = (nearest && nearestDist <= opts.snapRadius) ? nearest.id : null;
    linkState.magnetTo = magnetTo;
    linkState.lastY = y;

    const targetX = magnetTo ? nearest.x : x;
    const targetY = magnetTo ? nearest.y : y;
    linkState.lineEl.setAttribute('x2', targetX);
    linkState.lineEl.setAttribute('y2', targetY);
    linkState.dotEl.setAttribute('cx', targetX);
    linkState.dotEl.setAttribute('cy', targetY);

    if(magnetTo){
      linkState.ringEl.setAttribute('cx', nearest.x);
      linkState.ringEl.setAttribute('cy', nearest.y);
      linkState.ringEl.setAttribute('opacity', '1');
    } else {
      linkState.ringEl.setAttribute('opacity', '0');
    }
  }

  function onLinkRelease(e){
    if(!linkState) return;
    const {from, magnetTo, opts, startY, lastY} = linkState;
    const evt = (e && e.changedTouches) ? e.changedTouches[0] : e;
    const clientX = evt ? evt.clientX : window.innerWidth/2;
    const clientY = evt ? evt.clientY : window.innerHeight/2;
    cleanupLinkUI();
    linkState = null;
    if(magnetTo){
      opts.onDrop(from, magnetTo, clientX, clientY, {startY, lastY: lastY !== undefined ? lastY : startY});
    }
  }

  function onLinkKeydown(e){
    if(e.key === 'Escape' && linkState){ cleanupLinkUI(); linkState = null; }
  }

  function cleanupLinkUI(){
    if(linkState){
      [linkState.lineEl, linkState.dotEl, linkState.ringEl].forEach(el=>{
        if(el && el.remove) el.remove();
      });
    }
    canvasPaneEl.classList.remove('linking-mode');
    linkHintEl.classList.remove('show');
  }

  window.addEventListener('mousemove', onLinkMove);
  window.addEventListener('touchmove', onLinkMove, {passive:false});
  window.addEventListener('mouseup', onLinkRelease);
  window.addEventListener('touchend', onLinkRelease);
  window.addEventListener('keydown', onLinkKeydown);

