  // ================================================================
  // FILE: js/engines/sankey.js
  // ENGINE: Sankey (flow diagrams -- named nodes connected by weighted
  //         flows, node width proportional to total throughput).
  //
  // Adapted from a standalone D3 + d3-sankey sample the user provided.
  // Kept: the DSL grammar (`Source -> Target: value`), d3-sankey for the
  // actual layout math, and 2D node dragging. Dropped, in favor of this
  // app's existing shared UI for the same job: the sample's own sidebar of
  // width/height/node-width/alignment/format/palette controls (this app
  // gives every engine exactly one spacing slider + one toggle -- mapped
  // to node padding and "free horizontal drag" here) and its `@color`
  // DSL-tagging + custom palette picker (this app's properties panel +
  // curated PALETTE already do this job, so color lives in `style`, not
  // in the DSL text, same as every other engine -- see state.js).
  //
  // Like every engine, this file is self-contained and only talks to the
  // rest of the app via the contract documented in full in
  // js/core/state.js ("ADDING A NEW DRAWING STYLE"). Requires the D3 and
  // d3-sankey <script> tags (loaded in index.html right before this file)
  // -- this is the one engine that reaches for an external library, since
  // reimplementing the Sankey layout algorithm by hand is a lot more than
  // "adjust this code to embed it".
  // ================================================================
  const SankeyEngine = (function(){

    const SAMPLE = `title Revenue breakdown

Search -> Ads: 60
YouTube -> Ads: 10
AdMob -> Ads: 10
Ads -> Revenue: 80
Play -> Revenue: 10
Cloud -> Revenue: 25
Other -> Revenue: 5
Revenue -> Costs: 45
Revenue -> Gross Profit: 75
Costs -> TAC: 15
Costs -> Other Costs: 30
Gross Profit -> Operating Expenses: 35
Gross Profit -> Operating Profit: 40
Operating Expenses -> R&D: 20
Operating Expenses -> Sales: 10
Operating Expenses -> Admin: 5
Operating Profit -> Tax: 25
Operating Profit -> Final Profit: 15`;

    const EMPTY_MESSAGE = 'Add at least one flow to see a diagram.';
    const TITLE_RE = /^title\s+(.+)$/i;
    const FLOW_RE = /^(.+?)\s*->\s*(.+?)\s*:\s*(-?\d+(?:\.\d+)?)$/;

    let lastGraph = null;   // {nodes, links} from the most recent successful layout
    let lastWidth = 0;
    let lastHeight = 0;
    let lastSankeyLayout = null; // the d3.sankey() generator itself, kept around so
                                  // attach()'s live drag can call .update(graph) on
                                  // every tick -- see the comment on onDrag below.

    // d3-drag's own mouseup handler unconditionally calls preventDefault()
    // on every mouseup it sees (see d3-drag's mouseupped/noevent), and
    // preventDefault on mouseup cancels the browser's own click synthesis
    // for that gesture -- by design, not a bug in d3-drag, but it means a
    // node with d3.drag() attached NEVER receives a native 'click' or
    // 'dblclick', no matter how little the mouse moved. Click-to-select and
    // double-click-to-rename are reimplemented by hand in onDragEnd below,
    // reading the drag gesture's own start/end instead.
    let lastClickName = null;
    let lastClickTime = 0;
    const CLICK_MOVE_THRESHOLD = 6; // px -- below this, treat the gesture as a click, not a drag
    const DBLCLICK_MS = 400;

    // Sankey resolves color directly to a hex string (rather than via the
    // var(--amber,#2F6FED) CSS-cascade pattern the other engines use)
    // because a link <path> needs its SOURCE node's color, and a link
    // isn't a DOM descendant of that node's <g> -- CSS custom properties
    // only cascade down the tree, not sideways to a sibling. Every node
    // gets the same curated-palette treatment either way (customColors +
    // accentColor + PALETTE, all shared state from state.js).
    function resolveColor(name){
      const key = customColors[name];
      if(key && PALETTE[key]) return PALETTE[key].hex;
      return (PALETTE[accentColor] || PALETTE.blue).hex;
    }

    function parseAndLayout(text, spacing, toggleOn){
      const rawLines = text.split('\n');
      linecount.textContent = rawLines.length + ' line' + (rawLines.length===1?'':'s');

      const lines = rawLines
        .map((l,i)=>({raw:l, i}))
        .filter(l=>{
          const t = l.raw.trim();
          if(!t.length) return false;
          if(/^(#|\/\/)/.test(t)) return false;
          return true;
        });

      let title = null;
      const nodeNames = [];
      const nodeSet = new Set();
      const rawFlows = [];

      for(const {raw, i} of lines){
        const t = raw.trim();
        const mTitle = t.match(TITLE_RE);
        if(mTitle){ title = mTitle[1]; continue; }
        const m = t.match(FLOW_RE);
        if(!m) throw new Error(`Line ${i+1}: could not parse — "${t}". Use: Source -> Target: value`);
        const source = m[1].trim(), target = m[2].trim(), value = Number(m[3]);
        if(!source || !target) throw new Error(`Line ${i+1}: needs both a source and a target.`);
        if(!Number.isFinite(value) || value <= 0) throw new Error(`Line ${i+1}: value must be greater than zero.`);
        if(source === target) throw new Error(`Line ${i+1}: "${source}" can't flow into itself.`);
        if(!nodeSet.has(source)){ nodeSet.add(source); nodeNames.push(source); }
        if(!nodeSet.has(target)){ nodeSet.add(target); nodeNames.push(target); }
        rawFlows.push({source, target, value, lineIndex:i});
      }

      if(nodeNames.length === 0){
        lastGraph = null; // discard any stale layout so the + button starts fresh
        throw new Error(EMPTY_MESSAGE);
      }

      // Fixed canvas, loosely scaled by node count (this engine's diagrams
      // don't grow left/right with more declarations the way a sequence
      // diagram's participants do -- d3-sankey decides column count from
      // the graph's own topology). Wide/tall diagrams still work fine via
      // the canvas-pane's own scrolling.
      const width = 1100;
      const height = Math.max(600, Math.min(1400, nodeNames.length * 42));
      const topMargin = title ? 50 : 24;
      const nodePadding = spacing || 24;
      const NODE_WIDTH = 16;

      const sankeyLayout = d3.sankey()
        .nodeId(d=>d.name)
        .nodeWidth(NODE_WIDTH)
        .nodePadding(nodePadding)
        .nodeAlign(d3.sankeyJustify)
        .nodeSort(null)
        .extent([[24, topMargin], [width-24, height-24]]);

      let graph;
      try{
        graph = sankeyLayout({
          nodes: nodeNames.map(name=>({name})),
          // lineIndex rides along on each link object purely for our own
          // use (splitLink, below) -- d3-sankey only ever reads
          // source/target/value off these and leaves anything else alone.
          links: rawFlows.map(f=>({source:f.source, target:f.target, value:f.value, lineIndex:f.lineIndex}))
        });
      }catch(err){
        lastGraph = null;
        throw new Error('These flows form a loop — a Sankey diagram needs one-way, acyclic flows.');
      }

      // Re-apply any manually dragged positions on top of the fresh
      // auto-layout, then ask d3-sankey to recompute just the link paths
      // (not the whole layout) to match -- same "auto-layout, then
      // override from customLayout" pattern the other engines use for
      // their 1D positions, just storing {x0,y0} objects here instead of
      // a single number. A dragged node keeps its auto-computed size.
      let repositioned = false;
      graph.nodes.forEach(n=>{
        const override = customLayout[n.name];
        if(override && typeof override.x0 === 'number' && typeof override.y0 === 'number'){
          const w = n.x1 - n.x0, h = n.y1 - n.y0;
          n.x0 = override.x0; n.x1 = override.x0 + w;
          n.y0 = override.y0; n.y1 = override.y0 + h;
          repositioned = true;
        }
      });
      if(repositioned) sankeyLayout.update(graph);

      const linkPath = d3.sankeyLinkHorizontal();
      const fmt = d3.format(',');

      const titleSvg = title
        ? `<text x="${width/2}" y="24" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="16" font-weight="700" fill="#1F2430">${esc(title)}</text>`
        : '';

      const linkParts = graph.links.map(link=>{
        const d = linkPath(link);
        const color = resolveColor(link.source.name);
        const w = Math.max(1, link.width);
        return `<path class="sankey-link" d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-opacity="0.35"><title>${esc(link.source.name)} → ${esc(link.target.name)}: ${esc(fmt(link.value))}</title></path>`;
      }).join('');

      const nodeParts = graph.nodes.map(n=>{
        const w = n.x1 - n.x0, h = Math.max(1, n.y1 - n.y0);
        const color = resolveColor(n.name);
        const onRight = n.x0 < width/2;
        const lx = onRight ? n.x1 + 8 : n.x0 - 8;
        const anchor = onRight ? 'start' : 'end';
        const incoming = n.targetLinks.reduce((s,l)=>s+l.value, 0);
        const outgoing = n.sourceLinks.reduce((s,l)=>s+l.value, 0);
        const total = Math.max(incoming, outgoing) || n.value || 0;
        const removeBtn = `
          <g class="remove-btn">
            <circle cx="${n.x1-2}" cy="${n.y0-2}" r="8" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.3"/>
            <text x="${n.x1-2}" y="${n.y0-2+3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="10.5" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
          </g>`;
        return `
          <g data-node="${esc(n.name)}" class="has-remove">
            <rect x="${n.x0}" y="${n.y0}" width="${w}" height="${h}" rx="2" fill="${color}" stroke="rgba(0,0,0,0.15)"><title>${esc(n.name)}: ${esc(fmt(total))}</title></rect>
            <text class="node-label" x="${lx}" y="${(n.y0+n.y1)/2-6}" text-anchor="${anchor}" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="600" fill="#1F2430" style="pointer-events:none;">${esc(n.name)}</text>
            <text class="node-value" x="${lx}" y="${(n.y0+n.y1)/2+10}" text-anchor="${anchor}" font-family="IBM Plex Mono, monospace" font-size="10" fill="#767E8C" style="pointer-events:none;">${esc(fmt(total))}</text>
            ${removeBtn}
          </g>`;
      }).join('');

      lastGraph = graph;
      lastWidth = width;
      lastHeight = height;
      lastSankeyLayout = sankeyLayout;

      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
                    viewBox="0 0 ${width} ${height}" font-family="IBM Plex Sans, sans-serif" style="${accentStyleAttr()}">
          <rect class="diagram-bg" x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>
          ${titleSvg}
          ${linkParts}
          ${nodeParts}
        </svg>`;
    }

    // ---------------- mutations ----------------

    function nextFreeNodeName(){
      const existing = lastGraph ? lastGraph.nodes.map(n=>n.name) : [];
      let n = 1;
      while(existing.includes('Node '+n)) n++;
      return 'Node ' + n;
    }

    function insertPrimaryAt(){
      const existing = lastGraph ? lastGraph.nodes.map(n=>n.name) : [];
      let n = 1;
      while(existing.includes('Node '+n)) n++;
      const a = 'Node ' + n, b = 'Node ' + (n+1);
      const lines = dslEl.value.split('\n');
      lines.push(`${a} -> ${b}: 10`);
      dslEl.value = lines.join('\n').replace(/^\n+/, '');
      doRender();
    }

    // Click-to-split: inserting a node ON a specific flow ribbon is the one
    // place a click position has an unambiguous "correct" structural
    // meaning in this DSL -- it can only sensibly mean "put a new node
    // between these two, in this exact flow". Splits "A -> B: value" into
    // "A -> New: value" / "New -> B: value" (the new node just relays the
    // same amount through). Deliberately does NOT pin the new node to the
    // clicked pixel via customLayout -- its real height depends on the
    // flow's value, which isn't known until layout runs, so a raw click
    // point fights d3-sankey's own column/relaxation math and produces
    // overlapping, crossed links. Leaving it to the auto-layout gives a
    // clean, correctly-spaced result every time; the user can still drag it
    // afterward if they want it somewhere specific.
    function splitLink(link){
      if(link.lineIndex === undefined) return;
      const lines = dslEl.value.split('\n');
      const line = lines[link.lineIndex];
      if(!line) return;
      const m = line.trim().match(FLOW_RE);
      if(!m) return;
      const leading = line.match(/^\s*/)[0];
      const source = m[1].trim(), target = m[2].trim();
      const newName = nextFreeNodeName();
      lines.splice(link.lineIndex, 1,
        `${leading}${source} -> ${newName}: ${link.value}`,
        `${leading}${newName} -> ${target}: ${link.value}`
      );
      dslEl.value = lines.join('\n');
      doRender();
    }

    function removeNode(name){
      const lines = dslEl.value.split('\n');
      const kept = lines.filter(line=>{
        const m = line.trim().match(FLOW_RE);
        if(!m) return true; // title/comment/blank lines pass through untouched
        return m[1].trim() !== name && m[2].trim() !== name;
      });
      delete customLayout[name];
      delete customColors[name];
      dslEl.value = kept.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+/,'').replace(/\n+$/,'\n');
      doRender();
    }

    function renameNode(oldName, newName){
      const lines = dslEl.value.split('\n');
      let changed = false;
      const newLines = lines.map(line=>{
        const leading = line.match(/^\s*/)[0];
        const m = line.trim().match(FLOW_RE);
        if(!m) return line;
        let src = m[1].trim(), tgt = m[2].trim();
        if(src === oldName){ src = newName; changed = true; }
        if(tgt === oldName){ tgt = newName; changed = true; }
        return `${leading}${src} -> ${tgt}: ${m[3]}`;
      });
      if(!changed) return;
      if(customLayout[oldName] !== undefined){ customLayout[newName] = customLayout[oldName]; delete customLayout[oldName]; }
      if(customColors[oldName] !== undefined){ customColors[newName] = customColors[oldName]; delete customColors[oldName]; }
      dslEl.value = newLines.join('\n');
      doRender();
    }

    // Click empty canvas to extend a new node from whichever node is
    // currently selected -- "previous node" is that selection, and
    // reselecting the newly-created node afterward lets repeated clicks on
    // empty space chain a whole path node by node, matching how someone
    // would sketch a flow by hand rather than editing the DSL text.
    function extendFromSelected(){
      if(!selectedElement || selectedElement.kind !== 'node') return false;
      const from = selectedElement.id;
      if(!lastGraph || !lastGraph.nodes.some(n=>n.name===from)) return false;
      const newName = nextFreeNodeName();
      const lines = dslEl.value.split('\n');
      lines.push(`${from} -> ${newName}: 10`);
      dslEl.value = lines.join('\n').replace(/^\n+/, '');
      doRender();
      if(selectElement) selectElement({kind:'node', id:newName});
      return true;
    }

    // ---------------- attach ----------------

    function attach(svgEl){
      // Not attachSelectionHandlers here -- its [data-node] click wiring is
      // dead code on this engine anyway (d3-drag eats native clicks on any
      // element it's attached to; see onDragEnd's comment), and its
      // .diagram-bg handler unconditionally deselects, which would fire
      // AFTER extendFromSelected() re-selects the new node below and
      // immediately undo it if both were wired. This replaces that single
      // bg-click behavior with one that does either job: extend a path
      // from whatever's selected, or fall back to the plain deselect.
      const bg = svgEl.querySelector('.diagram-bg');
      if(bg) bg.addEventListener('click', ()=>{
        if(!extendFromSelected() && selectElement) selectElement(null);
      });
      attachRemoveHandlers(svgEl, (btn)=>{
        const nodeG = btn.closest('[data-node]');
        if(nodeG) removeNode(nodeG.getAttribute('data-node'));
      });

      // 2D drag (vertical always, horizontal when the toggle is on) --
      // done with D3 directly rather than the shared attachDragHandlers,
      // which only supports 1D. Live-patches the DOM during the drag for
      // smoothness (matching the original sample this was adapted from),
      // then commits the final position to customLayout and re-renders
      // through the normal doRender() once, on release.
      const linkGen = d3.sankeyLinkHorizontal();

      function onDrag(event, d){
        const h = d.y1 - d.y0, w = d.x1 - d.x0;
        d.y0 = Math.max(0, Math.min(lastHeight - h, event.y - h/2));
        d.y1 = d.y0 + h;
        if(toggle2El.checked){
          d.x0 = Math.max(0, Math.min(lastWidth - w, event.x - w/2));
          d.x1 = d.x0 + w;
        }
        const g = d3.select(this);
        g.select('rect').attr('x', d.x0).attr('y', d.y0);
        const onRight = d.x0 < lastWidth/2;
        const lx = onRight ? d.x1 + 8 : d.x0 - 8;
        g.select('.node-label').attr('x', lx).attr('y', (d.y0+d.y1)/2-6).attr('text-anchor', onRight?'start':'end');
        g.select('.node-value').attr('x', lx).attr('y', (d.y0+d.y1)/2+10).attr('text-anchor', onRight?'start':'end');
        g.select('.remove-btn circle').attr('cx', d.x1-2).attr('cy', d.y0-2);
        g.select('.remove-btn text').attr('x', d.x1-2).attr('y', d.y0-2+3.5);
        // Each link caches its own y0/y1 (its vertical offset where it meets
        // the node) from whenever the layout last ran -- moving a node
        // doesn't touch those cached values on its own, so the path stays
        // put until something recomputes them. d3-sankey's own .update()
        // does exactly that recompute (computeLinkBreadths) without redoing
        // the expensive full relaxation, so it's cheap enough to call on
        // every drag tick -- this is what makes the links visibly follow
        // the node in real time instead of only snapping into place once
        // doRender() reruns parseAndLayout on drag release.
        if(lastSankeyLayout) lastSankeyLayout.update(lastGraph);
        d3.select(svgEl).selectAll('.sankey-link').attr('d', linkGen);
      }
      function onDragEnd(event, d){
        const moved = Math.hypot(d.x0 - d._dragStartX0, d.y0 - d._dragStartY0);
        if(moved > CLICK_MOVE_THRESHOLD){
          customLayout[d.name] = {x0: d.x0, y0: d.y0};
          doRender();
          return;
        }
        // Barely moved -- treat this gesture as a click, and replicate
        // native single-/double-click semantics by hand (see the comment
        // above lastClickName for why the browser never gets the chance).
        const now = Date.now();
        if(lastClickName === d.name && (now - lastClickTime) < DBLCLICK_MS){
          lastClickName = null; lastClickTime = 0;
          const rectEl = this.querySelector('rect');
          openInlineEditor({
            anchorRect: rectEl.getBoundingClientRect(),
            initialValue: d.name,
            textAlign: 'center',
            onCommit: (val)=>{ if(val && val !== d.name) renameNode(d.name, val); }
          });
        } else {
          lastClickName = d.name; lastClickTime = now;
          if(selectElement) selectElement({kind:'node', id: d.name});
        }
      }

      // parseAndLayout's output is raw HTML dropped in via innerHTML, not
      // built through D3's own .data().join() -- so none of these elements
      // have a bound datum yet. .attr('d', linkGen) needs one (linkGen reads
      // d.source/d.target/d.y0/d.y1), so bind each path to its graph.links
      // entry by position: the paths were written out via
      // graph.links.map(...).join('') in that exact order, so the Nth
      // .sankey-link in the DOM IS lastGraph.links[N]. Skipping this was the
      // actual reason links didn't follow a dragged node -- linkGen(undefined)
      // throws inside d3-sankey's own accessor, which silently aborted the
      // whole .attr() call every tick with nothing in the console tying it
      // back to this line.
      const linkSel = d3.select(svgEl).selectAll('.sankey-link');
      linkSel.each(function(_, i){
        const d = lastGraph && lastGraph.links[i];
        if(d) d3.select(this).datum(d);
      });
      // Click a flow ribbon anywhere along its length to drop a new node
      // right there, splitting that one flow -- see splitLink's own comment
      // for why "click position" only has one unambiguous meaning here.
      linkSel.on('click', function(event, d){
        event.stopPropagation();
        splitLink(d);
      });

      const nodeSel = d3.select(svgEl).selectAll('[data-node]');
      nodeSel.each(function(){
        const name = this.getAttribute('data-node');
        const d = lastGraph && lastGraph.nodes.find(n=>n.name===name);
        if(d) d3.select(this).datum(d);
      });
      nodeSel.call(
        d3.drag()
          .on('start', function(event, d){
            d3.select(this).raise();
            // Recorded so onDragEnd can tell a real drag from a plain
            // click -- d3-drag's own mouseup handler calls
            // event.preventDefault() unconditionally on every release
            // (see mouseupped/noevent in d3-drag's source), and
            // preventDefault on mouseup cancels the browser's native click
            // synthesis outright. That's not tunable via clickDistance --
            // it means this element NEVER gets a native 'click' or
            // 'dblclick' once d3.drag() is attached to it, no matter how
            // little the mouse moved. onDragEnd below measures the actual
            // displacement itself and reimplements single-/double-click
            // (select / rename) by hand for whatever didn't move enough to
            // count as a real drag.
            d._dragStartX0 = d.x0; d._dragStartY0 = d.y0;
          })
          .on('drag', onDrag)
          .on('end', onDragEnd)
      );
    }

    return {
      id: 'sankey',
      label: 'Sankey',
      mark: 'SNK',
      sample: SAMPLE,
      emptyMessage: EMPTY_MESSAGE,
      emptyLabel: 'flow',
      exportBaseName: 'sankey-diagram',
      spacing: {label:'Node spacing', min:8, max:80, step:2, default:24},
      toggle: {label:'Free horizontal drag', default:true},
      snippets: [
        {key:'flow', label:'+ flow', text:'Source -> Target: 10\n'}
      ],
      helpHTML: `
        <div><b>title</b> text &nbsp;— optional heading shown above the diagram</div>
        <div><b>Source -&gt; Target:</b> value &nbsp;— one flow per line; nodes are created automatically the first time they're named</div>
        <div>Click any flow ribbon to split it, inserting a new node right there.</div>
        <div>Click a node to select it, then click empty canvas to extend a new node from it — keep clicking empty space to chain a path.</div>
        <div>Drag any node to reposition it — vertically always, horizontally too if "Free horizontal drag" is checked.</div>
        <div>Hover a node and click the red <b>×</b> in its corner to remove it — every flow touching it goes with it.</div>
        <div>Double-click a node to rename it — every flow line using that name updates too.</div>
        <div>Click a node to pick its color from the panel on the right, or the empty canvas (with nothing selected) to set the diagram's overall color.</div>`,
      thumbnail: `<svg width="100" height="56" viewBox="0 0 100 56" fill="none">
          <path d="M16,15 C30,15 30,24 45,24" stroke="#2F6FED" stroke-width="5" opacity="0.35" fill="none"/>
          <path d="M16,37 C30,37 30,30 45,30" stroke="#2F6FED" stroke-width="5" opacity="0.35" fill="none"/>
          <path d="M55,24 C68,24 70,14 84,16" stroke="#2F6FED" stroke-width="6" opacity="0.35" fill="none"/>
          <path d="M55,32 C68,32 70,36 84,36" stroke="#2F6FED" stroke-width="6" opacity="0.35" fill="none"/>
          <rect x="6" y="8" width="10" height="14" rx="1.5" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.2"/>
          <rect x="6" y="30" width="10" height="14" rx="1.5" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.2"/>
          <rect x="45" y="17" width="10" height="24" rx="1.5" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.2"/>
          <rect x="84" y="9" width="10" height="12" rx="1.5" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.2"/>
          <rect x="84" y="29" width="10" height="18" rx="1.5" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.2"/>
        </svg>`,
      selectionHint: 'Click a node on the canvas to edit its text or color.',
      parseAndLayout,
      insertPrimaryAt,
      attach,
      getNodeLabel: (name)=>{
        if(!lastGraph) return undefined;
        return lastGraph.nodes.some(n=>n.name===name) ? name : undefined;
      },
      renameNode
    };
  })();

  registerEngine(SankeyEngine);
