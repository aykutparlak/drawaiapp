  // ================================================================
  // FILE: js/engines/swimlane.js
  // ENGINE: Swimlane (cross-functional flowcharts -- lanes, start/step/
  //         decision/end nodes, flow connectors, notes).
  //
  // This file is fully self-contained: its own DSL grammar (parsed below),
  // its own layout math, its own SVG rendering, its own mutation functions
  // (insert/remove/rename lane or step, reshape a step, add a connector,
  // ...). It only talks to the rest of the app in two directions:
  //   - IN: calls the generic helpers from js/core/utils.js and
  //     js/core/interactions.js (esc, fitLabel, textBlock, colorStyleFor,
  //     openInlineEditor, showPopupMenu, attachDragHandlers,
  //     attachSelectionHandlers, attachRemoveHandlers, attachAddHandlers,
  //     attachEditableHandlers, attachLinkHandleHandlers) instead of
  //     writing its own DOM event wiring, and calls the shared doRender()
  //     (render.js) after any DSL edit.
  //   - OUT: registers one object (see the `return {...}` below) via
  //     registerEngine(SwimlaneEngine) at the very end of this file.
  //
  // The full contract for that returned object -- every field, which ones
  // are required, and the DOM/CSS conventions this file's SVG output must
  // follow for the generic interactions above to work -- is documented
  // once, in full, in js/core/state.js under "ADDING A NEW DRAWING STYLE".
  // Read that before changing this file's shape, or before copying this
  // file as a starting point for a new engine (this one is the better
  // template if your new diagram type also has a "grouping" concept like
  // lanes, or multiple interchangeable node shapes like step/decision --
  // see getLaneLabel/renameLane and getNodeKind/setNodeShape below).
  //
  // This file can be edited, tested, and reasoned about without reading
  // js/engines/sequence.js (or any future engine) at all -- there is no
  // dependency between engine files.
  // ================================================================
  const SwimlaneEngine = (function(){

    const SAMPLE = `title Order fulfillment

lane Sales as Sales Team
lane Warehouse
lane Shipping

start st in Sales: Order received
step s1 in Sales: Confirm details
step s2 in Warehouse: Pick items
decision d1 in Warehouse: In stock?
step s3 in Shipping: Pack & ship
step s4 in Sales: Notify customer of delay
end e1 in Shipping: Delivered

st->s1
s1->s2
s2->d1
d1->s3: yes
d1->s4: no
s3->e1
s4->s2: reorder

note over s2: verify against warehouse system`;

    const EMPTY_MESSAGE = 'Add at least one lane and step to see a diagram.';
    const NODE_LINE_RE = /^(start|end|step|decision)\s+(\w+)\s+in\s+(\w+)(?:\s*:\s*(.*))?$/i;
    const LANE_LINE_RE = /^lane\s+(\w+)(?:\s+as\s+(.+))?$/i;
    const CONN_LINE_RE = /^(\w+)\s*(-->|->)\s*(\w+)\s*(?::\s*(.*))?$/;
    const NOTE_LINE_RE = /^note\s+over\s+([\w\s,]+?)\s*:\s*(.*)$/i;

    let lastOrder = [];
    let lastLanes = [];

    function parseAndLayout(text, spacing, showNotes){
      spacing = spacing || 160;
      showNotes = showNotes !== false;
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

      const titleRe = /^title\s+(.+)$/i;
      const startRe = /^start\s+(\w+)\s+in\s+(\w+)(?:\s*:\s*(.*))?$/i;
      const endRe = /^end\s+(\w+)\s+in\s+(\w+)(?:\s*:\s*(.*))?$/i;
      const stepRe = /^step\s+(\w+)\s+in\s+(\w+)\s*:\s*(.*)$/i;
      const decisionRe = /^decision\s+(\w+)\s+in\s+(\w+)\s*:\s*(.*)$/i;

      let title = null;
      const lanes = [];
      const laneSet = new Set();

      for(const {raw} of lines){
        const t = raw.trim();
        let m;
        if((m = t.match(titleRe))){ title = m[1]; continue; }
        if((m = t.match(LANE_LINE_RE))){
          if(!laneSet.has(m[1])){
            lanes.push({name:m[1], label:m[2]?m[2].trim():m[1]});
            laneSet.add(m[1]);
          }
        }
      }
      if(lanes.length === 0){
        lastOrder = []; lastLanes = []; // discard any stale layout so the + button starts fresh
        throw new Error(EMPTY_MESSAGE);
      }
      const laneByName = {};
      lanes.forEach((l,idx)=>{ l.index = idx; laneByName[l.name] = l; });

      const order = [];
      const nodeSet = new Set();
      const nodeByName = {};

      function declareNode(id, laneName, kind, label){
        if(nodeSet.has(id)) throw new Error(`Duplicate id "${id}"`);
        if(!laneByName[laneName]) throw new Error(`Unknown lane "${laneName}"`);
        const node = {id, label: (label||'').trim() || id, laneName, kind};
        nodeSet.add(id);
        nodeByName[id] = node;
        order.push(node);
      }

      for(const {raw, i} of lines){
        const t = raw.trim();
        let m;
        if((m = t.match(startRe))) declareNode(m[1], m[2], 'start', m[3] || 'Start');
        else if((m = t.match(endRe))) declareNode(m[1], m[2], 'end', m[3] || 'End');
        else if((m = t.match(stepRe))) declareNode(m[1], m[2], 'step', m[3]);
        else if((m = t.match(decisionRe))) declareNode(m[1], m[2], 'decision', m[3]);
      }

      if(order.length === 0){
        lastOrder = []; lastLanes = []; // discard any stale layout so the + button starts fresh
        throw new Error(EMPTY_MESSAGE);
      }

      const charW = 7.3;
      const minGap = spacing;
      const xs = [];
      let cursorX = 90;
      order.forEach(n=>{
        const w = (n.kind === 'decision')
          ? Math.max(120, n.label.length * charW + 60)
          : Math.max(96, n.label.length * charW + 40);
        n._w = w;
        xs.push(cursorX);
        cursorX += Math.max(minGap, w/2 + 90);
      });
      order.forEach((n,idx)=>{
        const override = customLayout[n.id];
        n.x = (override !== undefined) ? override : xs[idx];
      });
      order.forEach(n=>{
        n._hh = (n.kind === 'decision')
          ? Math.max(38, Math.min(60, Math.round(n.label.length*1.8) + 34))
          : 23;
      });

      const maxHalfW = Math.max(...order.map(n=>n._w/2));
      const leftEdge = Math.min(...order.map(n=>n.x)) - maxHalfW - 30;

      const titleLines = title ? title.split(/<br\s*\/?>/i).map(s=>s.trim()).filter(l=>l.length) : [];
      let titleH;
      if(titleLines.length === 0) titleH = 20;
      else if(titleLines.length === 1) titleH = 46;
      else titleH = 46 + (titleLines.length-1)*13;

      const LANE_LABEL_W = 130;
      const LANE_H = 130;
      const laneAreaLeft = Math.min(0, leftEdge);
      const nodesLeft = laneAreaLeft + LANE_LABEL_W + 20;
      const minNodeLeft = Math.min(...order.map(n=>n.x - n._w/2));
      const shift = Math.max(0, nodesLeft - minNodeLeft);
      order.forEach(n=> n.x += shift);

      const rightEdge = Math.max(...order.map(n=>n.x + n._w/2));
      const rightBound = Math.max(rightEdge + 60, nodesLeft + 200);

      lanes.forEach((l,idx)=>{
        l.top = titleH + idx*LANE_H;
        l.bottom = l.top + LANE_H;
        l.cy = l.top + LANE_H/2;
      });
      order.forEach(n=>{ n.y = laneByName[n.laneName].cy; });

      const svgParts = [];

      function rectEdge(cx,cy,hw,hh,tx,ty){
        const dx = tx-cx, dy = ty-cy;
        if(dx===0 && dy===0) return {x:cx,y:cy};
        const scaleX = dx!==0 ? hw/Math.abs(dx) : Infinity;
        const scaleY = dy!==0 ? hh/Math.abs(dy) : Infinity;
        const scale = Math.min(scaleX, scaleY);
        return {x: cx+dx*scale, y: cy+dy*scale};
      }
      function diamondEdge(cx,cy,hw,hh,tx,ty){
        const dx = tx-cx, dy = ty-cy;
        if(dx===0 && dy===0) return {x:cx,y:cy};
        const denom = Math.abs(dx)/hw + Math.abs(dy)/hh;
        const scale = denom===0 ? 0 : 1/denom;
        return {x: cx+dx*scale, y: cy+dy*scale};
      }
      function edgePoint(n, tx, ty){
        return n.kind==='decision' ? diamondEdge(n.x,n.y,n._w/2,n._hh,tx,ty) : rectEdge(n.x,n.y,n._w/2,n._hh,tx,ty);
      }

      // ---- lanes ----
      lanes.forEach(l=>{
        const removeBtn = `
          <g class="remove-btn">
            <circle cx="${laneAreaLeft+LANE_LABEL_W-3}" cy="${l.top+22}" r="8" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.3"/>
            <text x="${laneAreaLeft+LANE_LABEL_W-3}" y="${l.top+22+3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="10.5" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
          </g>`;
        svgParts.push(`
          <g data-lane="${esc(l.name)}" class="has-remove"${colorStyleFor(l.name)}>
            <rect x="${laneAreaLeft}" y="${l.top}" width="${rightBound-laneAreaLeft}" height="${LANE_H}"
                  fill="${l.index%2===0 ? 'var(--panel,#F7F8FA)':'var(--panel-raised,#FFFFFF)'}" opacity="0.6"/>
            <rect x="${laneAreaLeft}" y="${l.top}" width="${LANE_LABEL_W}" height="${LANE_H}" rx="4"
                  fill="#F7F8FA" stroke="var(--amber,#2F6FED)" stroke-width="1.3"/>
            <g class="editable-label" data-edit="lane">
              <rect x="${laneAreaLeft}" y="${l.top}" width="${LANE_LABEL_W}" height="${LANE_H}" fill="transparent"/>
              ${textBlock(laneAreaLeft+LANE_LABEL_W/2, l.cy, l.label, LANE_LABEL_W, {weight:600})}
            </g>
            <line x1="${laneAreaLeft}" y1="${l.bottom}" x2="${rightBound}" y2="${l.bottom}" stroke="var(--grid-line,#E7E9EE)" stroke-width="1"/>
            ${removeBtn}
          </g>`);
      });

      let titleSvg = '';
      if(titleLines.length){
        titleSvg = `<text x="${(laneAreaLeft+rightBound)/2}" y="24" text-anchor="middle" font-family="IBM Plex Sans, sans-serif"
                      font-size="16" font-weight="700" fill="#1F2430">${esc(titleLines[0])}</text>`;
        for(let k=1;k<titleLines.length;k++){
          titleSvg += `<text x="${(laneAreaLeft+rightBound)/2}" y="${24+13*k}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                      font-size="10.5" fill="#767E8C">${esc(titleLines[k])}</text>`;
        }
      }

      function nodeShapeSvg(n){
        const w = n._w, hw = w/2, hh = n._hh;
        if(n.kind === 'decision'){
          const pts = `${n.x},${n.y-hh} ${n.x+hw},${n.y} ${n.x},${n.y+hh} ${n.x-hw},${n.y}`;
          return `<polygon points="${pts}" fill="#F7F8FA" stroke="var(--amber,#2F6FED)" stroke-width="1.3"/>${textBlock(n.x, n.y, n.label, hw*1.1)}`;
        }
        if(n.kind === 'start' || n.kind === 'end'){
          // "end" always stays the fixed semantic red -- a terminal node's
          // meaning isn't part of the diagram's color theme
          const color = n.kind==='end' ? '#D0453A' : 'var(--amber,#2F6FED)';
          const bgColor = n.kind==='end' ? '#FDEDEC' : '#EAF1FE';
          return `<rect x="${n.x-hw}" y="${n.y-hh}" width="${w}" height="${hh*2}" rx="${hh}" fill="${bgColor}" stroke="${color}" stroke-width="1.3"/>${textBlock(n.x, n.y, n.label, w, {weight:600, fill:color})}`;
        }
        return `<rect x="${n.x-hw}" y="${n.y-hh}" width="${w}" height="${hh*2}" rx="6" fill="#F7F8FA" stroke="var(--amber,#2F6FED)" stroke-width="1.3"/>${textBlock(n.x, n.y, n.label, w)}`;
      }

      order.forEach(n=>{
        const removeBtn = `
          <g class="remove-btn">
            <circle cx="${n.x+n._w/2-2}" cy="${n.y-n._hh-2}" r="8" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.3"/>
            <text x="${n.x+n._w/2-2}" y="${n.y-n._hh-2+3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="10.5" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
          </g>`;
        // "end" nodes keep the fixed semantic red and aren't independently
        // recolorable, matching that same rule in nodeShapeSvg above
        const colorAttr = n.kind === 'end' ? '' : colorStyleFor(n.id);
        svgParts.push(`
          <g data-node="${esc(n.id)}" data-node-kind="step" data-node-subkind="${n.kind}" data-x="${n.x}" class="has-remove"${colorAttr}>
            ${nodeShapeSvg(n)}
            ${removeBtn}
          </g>`);
      });

      let noteCursorY = titleH + lanes.length*LANE_H + 20;

      for(const {raw, i} of lines){
        const t = raw.trim();
        if(titleRe.test(t) || LANE_LINE_RE.test(t) || startRe.test(t) || endRe.test(t) || stepRe.test(t) || decisionRe.test(t)) continue;
        let m;
        if((m = t.match(CONN_LINE_RE))){
          const [, from, arrow, to, label] = m;
          const A = nodeByName[from];
          const B = nodeByName[to];
          if(!A) throw new Error(`Line ${i+1}: unknown step "${from}"`);
          if(!B) throw new Error(`Line ${i+1}: unknown step "${to}"`);
          const dashed = arrow === '-->';
          const markerId = dashed ? 'swArrowOpen' : 'swArrowFilled';

          if(from === to){
            const r = 22;
            const cx = A.x + A._w/2 + r;
            const cy = A.y;
            svgParts.push(`<path d="M ${A.x+A._w/2} ${A.y-8} C ${cx+10} ${cy-20}, ${cx+10} ${cy+20}, ${A.x+A._w/2} ${A.y+8}"
                fill="none" stroke="var(--amber,#2F6FED)" stroke-width="1.6" stroke-dasharray="${dashed?'6,4':'0'}" marker-end="url(#${markerId})"/>`);
            const labelText = label || '';
            const hitW = Math.max(50, labelText.length*7+14);
            svgParts.push(`<g class="editable-label" data-edit="conn" data-line="${i}">
                <rect x="${cx-4}" y="${cy-10}" width="${hitW}" height="20" fill="transparent"/>
                ${labelText ? `<text x="${cx+4}" y="${cy+4}" font-family="IBM Plex Mono, monospace" font-size="11" fill="#1F2430">${esc(labelText)}</text>` : ''}
              </g>`);
            continue;
          }

          const p1 = edgePoint(A, B.x, B.y);
          const p2 = edgePoint(B, A.x, A.y);
          svgParts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="var(--amber,#2F6FED)" stroke-width="1.6"
              stroke-dasharray="${dashed?'6,4':'0'}" marker-end="url(#${markerId})"/>`);
          const midX = (p1.x+p2.x)/2, midY = (p1.y+p2.y)/2;
          const fit = fitLabel(label || '', 140);
          const lh = fit.fontSize + 3;
          const totalTextH = (fit.lines.length-1)*lh;
          const firstY = midY - 6 - totalTextH;
          const textEls = fit.lines.map((ln,idx)=>
            `<text x="${midX}" y="${firstY+idx*lh}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="${fit.fontSize}" fill="#1F2430">${esc(ln)}</text>`
          ).join('');
          const maxLen = Math.max(1, ...fit.lines.map(l=>l.length));
          const hitW2 = Math.max(50, maxLen*fit.fontSize*0.62+14);
          const hitH2 = totalTextH + fit.fontSize + 12;
          svgParts.push(`<g class="editable-label" data-edit="conn" data-line="${i}">
              <rect x="${midX-hitW2/2}" y="${firstY-fit.fontSize-2}" width="${hitW2}" height="${hitH2}" fill="transparent"/>
              ${textEls}
            </g>`);
          continue;
        }
        if((m = t.match(NOTE_LINE_RE))){
          if(!showNotes) continue;
          const ids = m[1].split(',').map(s=>s.trim());
          ids.forEach(id=>{ if(!nodeByName[id]) throw new Error(`Line ${i+1}: unknown step "${id}"`); });
          const noteText = m[2];
          const xs3 = ids.map(id=>nodeByName[id].x);
          const cx = (Math.min(...xs3)+Math.max(...xs3))/2;
          const textLines = noteText.split(/\\n|<br\s*\/?>/i).map(s=>s.trim());
          const boxH = 24 + textLines.length*15;
          const bw = Math.max(120, Math.max(...textLines.map(l=>l.length))*7+30, (Math.max(...xs3)-Math.min(...xs3))+60);
          const bx = cx - bw/2;
          const by = noteCursorY;
          let g = `<rect x="${bx}" y="${by}" width="${bw}" height="${boxH}" rx="3" fill="var(--panel,#F7F8FA)" stroke="var(--amber,#2F6FED)" stroke-width="1.1"/>`;
          textLines.forEach((tl,idx2)=>{
            g += `<text x="${bx+bw/2}" y="${by+20+idx2*15}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="#1F2430">${esc(tl)}</text>`;
          });
          g += removeBadgeSvg(bx+bw-6, by-4);
          svgParts.push(`<g class="editable-label" data-edit="note" data-line="${i}">${g}</g>`);
          noteCursorY += boxH + 18;
          continue;
        }
        throw new Error(`Line ${i+1}: could not parse — "${t}"`);
      }

      const totalH = noteCursorY;

      const defs = `<defs>
          <marker id="swArrowFilled" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--amber,#2F6FED)"/></marker>
          <marker id="swArrowOpen" markerWidth="12" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="var(--amber,#2F6FED)" stroke-width="1.4"/></marker>
        </defs>`;

      const viewX = laneAreaLeft - 10;
      const viewW = rightBound - viewX + 10;

      const addZones = [];
      for(let idx=0; idx<=lanes.length; idx++){
        let gy;
        if(idx===0) gy = lanes[0].top - 14;
        else if(idx===lanes.length) gy = lanes[lanes.length-1].bottom + 14;
        else gy = (lanes[idx-1].bottom + lanes[idx].top)/2;
        const gx = laneAreaLeft + LANE_LABEL_W/2;
        addZones.push(`
          <g class="add-hotzone" data-insert-index="${idx}">
            <rect x="${laneAreaLeft}" y="${gy-12}" width="${LANE_LABEL_W}" height="24" fill="transparent"/>
            <circle class="add-btn" cx="${gx}" cy="${gy}" r="10" fill="#D0453A"/>
            <text class="add-btn" x="${gx}" y="${gy+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="14" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">+</text>
          </g>`);
      }

      const stepZones = lanes.map(l => `
        <g class="step-hitzone" data-lane-append="${esc(l.name)}">
          <rect x="${rightBound-40}" y="${l.top}" width="40" height="${LANE_H}" fill="transparent"/>
          <circle class="step-add-btn" cx="${rightBound-20}" cy="${l.cy}" r="9" fill="#2F6FED"/>
          <text class="step-add-btn" x="${rightBound-20}" y="${l.cy+4}" text-anchor="middle"
                font-family="IBM Plex Mono, monospace" font-size="13" font-weight="700" fill="#FFFFFF"
                style="pointer-events:none;">+</text>
        </g>`).join('');

      const linkHandles = order.map(n => `
        <g class="link-handle" data-linksrc="${esc(n.id)}">
          <circle class="link-add-btn" cx="${n.x + n._w/2}" cy="${n.y}" r="9" fill="#2F6FED"/>
          <text class="link-add-btn" x="${n.x + n._w/2}" y="${n.y+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                font-size="12" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">+</text>
        </g>`).join('');

      lastOrder = order.map(n=>({id:n.id, label:n.label, laneName:n.laneName, kind:n.kind, x:n.x, y:n.y, _w:n._w, _hh:n._hh}));
      lastLanes = lanes.map(l=>({name:l.name, label:l.label, top:l.top, bottom:l.bottom, cy:l.cy, index:l.index}));

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewW}" height="${totalH+10}"
                    viewBox="${viewX} 0 ${viewW} ${totalH+10}" font-family="IBM Plex Sans, sans-serif" style="${accentStyleAttr()}">
          <rect class="diagram-bg" x="${viewX}" y="0" width="${viewW}" height="${totalH+10}" fill="#FFFFFF"/>
          ${defs}
          ${titleSvg}
          ${addZones.join('')}
          ${svgParts.join('\n')}
          ${linkHandles}
          ${stepZones}
        </svg>`;

      return svg;
    }

    // ---------------- mutations ----------------

    function insertLaneAt(index){
      const names = lastLanes.map(l=>l.name);
      let n = 1;
      while(names.includes('L'+n)) n++;
      const newName = 'L' + n;

      const lines = dslEl.value.split('\n');
      const declByName = {};
      const rest = [];
      lines.forEach(line=>{
        const m = line.match(/^\s*lane\s+(\w+)(?:\s+as\s+(.+))?\s*$/i);
        if(m) declByName[m[1]] = line.trim();
        else rest.push(line);
      });
      while(rest.length && rest[0].trim() === '') rest.shift();

      const finalNames = names.slice();
      finalNames.splice(index, 0, newName);
      const declLines = finalNames.map(nm =>
        nm === newName ? `lane ${newName}` : (declByName[nm] || `lane ${nm}`)
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

    function stripNodesFromScript(removedIds){
      const nodeRe = /^(start|end|step|decision)\s+(\w+)\s+in\s+(\w+)/i;
      const rawLines = dslEl.value.split('\n');
      const kept = [];
      for(const rawLine of rawLines){
        const line = rawLine.trim();
        let m;
        if((m = line.match(nodeRe))){ if(!removedIds.has(m[2])) kept.push(rawLine); continue; }
        if((m = line.match(CONN_LINE_RE))){ if(!removedIds.has(m[1]) && !removedIds.has(m[3])) kept.push(rawLine); continue; }
        if((m = line.match(NOTE_LINE_RE))){
          const leading = rawLine.match(/^\s*/)[0];
          const ids = m[1].split(',').map(s=>s.trim());
          const remaining = ids.filter(id=>!removedIds.has(id));
          if(remaining.length === 0) continue;
          if(remaining.length === ids.length){ kept.push(rawLine); continue; }
          kept.push(`${leading}note over ${remaining.join(',')}: ${m[2]}`);
          continue;
        }
        kept.push(rawLine);
      }
      removedIds.forEach(id=> delete customLayout[id]);
      return kept.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+/,'').replace(/\n+$/,'\n');
    }

    function removeStep(id){
      dslEl.value = stripNodesFromScript(new Set([id]));
      doRender();
    }

    function removeLane(name){
      const nodeRe = /^(start|end|step|decision)\s+(\w+)\s+in\s+(\w+)/i;
      const rawLines = dslEl.value.split('\n');
      const removedIds = new Set();
      rawLines.forEach(line=>{
        const m = line.trim().match(nodeRe);
        if(m && m[3] === name) removedIds.add(m[2]);
      });
      const stripped = stripNodesFromScript(removedIds);
      delete customLayout[name];
      const finalLines = stripped.split('\n').filter(l=>{
        const m = l.trim().match(LANE_LINE_RE);
        return !(m && m[1] === name);
      });
      dslEl.value = finalLines.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+/,'').replace(/\n+$/,'\n');
      doRender();
    }

    function appendStepToLane(laneName){
      const ids = lastOrder.map(n=>n.id);
      let n = 1;
      while(ids.includes('s'+n)) n++;
      const newId = 's' + n;
      const newLabel = 'New step';
      const newLine = `step ${newId} in ${laneName}: ${newLabel}`;

      const nodeRe = /^(start|end|step|decision)\s+(\w+)\s+in\s+(\w+)/i;
      const lines = dslEl.value.split('\n');
      let insertAt = -1;
      lines.forEach((line, idx)=>{ if(nodeRe.test(line.trim())) insertAt = idx; });
      if(insertAt === -1){
        lines.forEach((line, idx)=>{ if(LANE_LINE_RE.test(line.trim())) insertAt = idx; });
      }
      lines.splice(insertAt+1, 0, newLine);
      dslEl.value = lines.join('\n');
      doRender();

      const lineStart = dslEl.value.lastIndexOf(newLine);
      if(lineStart !== -1){
        const labelStart = lineStart + newLine.indexOf(': ') + 2;
        dslEl.focus();
        dslEl.setSelectionRange(labelStart, labelStart + newLabel.length);
      }
    }

    function renameStep(id, newLabel){
      const lines = dslEl.value.split('\n');
      for(let idx=0; idx<lines.length; idx++){
        const leading = lines[idx].match(/^\s*/)[0];
        const m = lines[idx].trim().match(NODE_LINE_RE);
        if(m && m[2] === id){
          lines[idx] = `${leading}${m[1]} ${id} in ${m[3]}: ${newLabel}`;
          dslEl.value = lines.join('\n');
          doRender();
          return;
        }
      }
    }

    // Only step <-> decision is reassignable -- start/end are structural
    // anchors (a diagram's single entry/exit point), and changing one to a
    // mid-flow shape would break that convention rather than just restyle it.
    function setNodeKind(id, newKind){
      if(newKind !== 'step' && newKind !== 'decision') return;
      const lines = dslEl.value.split('\n');
      for(let idx=0; idx<lines.length; idx++){
        const leading = lines[idx].match(/^\s*/)[0];
        const m = lines[idx].trim().match(NODE_LINE_RE);
        if(m && m[2] === id){
          if(m[1] !== 'step' && m[1] !== 'decision') return;
          lines[idx] = `${leading}${newKind} ${id} in ${m[3]}: ${m[4] || ''}`;
          dslEl.value = lines.join('\n');
          doRender();
          return;
        }
      }
    }

    function renameLane(name, newLabel){
      const lines = dslEl.value.split('\n');
      const declText = (newLabel === name) ? `lane ${name}` : `lane ${name} as ${newLabel}`;
      for(let idx=0; idx<lines.length; idx++){
        const leading = lines[idx].match(/^\s*/)[0];
        const m = lines[idx].trim().match(LANE_LINE_RE);
        if(m && m[1] === name){
          lines[idx] = leading + declText;
          dslEl.value = lines.join('\n');
          doRender();
          return;
        }
      }
    }

    function addConnectorBetween(from, to, arrowType, label){
      const finalLabel = (label || '').trim();
      const newLine = finalLabel ? `${from}${arrowType}${to}: ${finalLabel}` : `${from}${arrowType}${to}`;
      const lines = dslEl.value.split('\n');
      lines.push(newLine);
      dslEl.value = lines.join('\n').replace(/\n{3,}/g, '\n\n');
      doRender();
    }

    const CONN_TYPES = [
      {key:'->',  label:'Flow',   dashed:false, defaultLabel:''},
      {key:'->',  label:'Yes',    dashed:false, defaultLabel:'yes'},
      {key:'-->', label:'No',     dashed:true,  defaultLabel:'no'},
      {key:'-->', label:'Dashed', dashed:true,  defaultLabel:''}
    ];

    function connTypeIcon(t){
      return `<svg width="40" height="14" viewBox="0 0 40 14">
        <line x1="2" y1="7" x2="32" y2="7" stroke="#2F6FED" stroke-width="1.8" stroke-dasharray="${t.dashed?'5,3':'0'}"/>
        <path d="M32,7 L25,3.2 L25,10.8 Z" fill="#2F6FED"/>
      </svg>`;
    }

    function showConnTypePicker(from, to, clientX, clientY){
      showPopupMenu({
        labelText: (from === to) ? `${from} — self loop` : `${from} → ${to}`,
        clientX, clientY,
        items: CONN_TYPES.map(t=>({
          html: `${connTypeIcon(t)}<span>${t.label}</span>`,
          onChoose: ()=> addConnectorBetween(from, to, t.key, t.defaultLabel)
        }))
      });
    }

    // ---------------- inline edit ----------------

    function startStepRename(g){
      const id = g.getAttribute('data-node');
      if(!id) return;
      const n = lastOrder.find(n=>n.id===id);
      const currentLabel = n ? n.label : id;
      const rectEl = g.querySelector('rect, polygon');
      openInlineEditor({
        anchorRect: (rectEl||g).getBoundingClientRect(),
        initialValue: currentLabel,
        textAlign: 'center',
        onCommit: (val)=>{ if(val && val !== currentLabel) renameStep(id, val); }
      });
    }

    function startLaneRename(g){
      const laneG = g.closest('[data-lane]');
      if(!laneG) return;
      const name = laneG.getAttribute('data-lane');
      const l = lastLanes.find(l=>l.name===name);
      const currentLabel = l ? l.label : name;
      openInlineEditor({
        anchorRect: g.getBoundingClientRect(),
        initialValue: currentLabel,
        textAlign: 'center',
        onCommit: (val)=>{ if(val && val !== currentLabel) renameLane(name, val); }
      });
    }

    function startConnLabelEdit(g){
      const lineIndex = parseInt(g.getAttribute('data-line'), 10);
      const rawLines = dslEl.value.split('\n');
      const rawLine = rawLines[lineIndex] || '';
      const leading = rawLine.match(/^\s*/)[0];
      const m = rawLine.trim().match(CONN_LINE_RE);
      if(!m) return;
      const [, from, arrow, to, currentLabel] = m;
      openInlineEditor({
        anchorRect: g.getBoundingClientRect(),
        initialValue: currentLabel || '',
        minWidth: 90,
        onCommit: (val)=>{
          const lines = dslEl.value.split('\n');
          lines[lineIndex] = val ? `${leading}${from}${arrow}${to}: ${val}` : `${leading}${from}${arrow}${to}`;
          dslEl.value = lines.join('\n');
          doRender();
        }
      });
    }

    function startNoteEdit(g){
      const lineIndex = parseInt(g.getAttribute('data-line'), 10);
      const rawLines = dslEl.value.split('\n');
      const rawLine = rawLines[lineIndex] || '';
      const leading = rawLine.match(/^\s*/)[0];
      const m = rawLine.trim().match(NOTE_LINE_RE);
      if(!m) return;
      const [, ids, currentText] = m;
      openInlineEditor({
        anchorRect: g.getBoundingClientRect(),
        initialValue: currentText.replace(/\\n/g, ' '),
        textAlign: 'center',
        minWidth: 90,
        onCommit: (val)=>{
          const lines = dslEl.value.split('\n');
          lines[lineIndex] = `${leading}note over ${ids}: ${val}`;
          dslEl.value = lines.join('\n');
          doRender();
        }
      });
    }

    function removeNote(lineIndex){
      const lines = dslEl.value.split('\n');
      if(lineIndex < 0 || lineIndex >= lines.length) return;
      lines.splice(lineIndex, 1);
      dslEl.value = lines.join('\n');
      doRender();
    }

    // ---------------- attach ----------------

    function attach(svg){
      attachDragHandlers(svg, startStepRename);
      attachSelectionHandlers(svg);

      attachRemoveHandlers(svg, (btn)=>{
        const nodeG = btn.closest('[data-node]');
        if(nodeG){ removeStep(nodeG.getAttribute('data-node')); return; }
        const laneG = btn.closest('[data-lane]');
        if(laneG){ removeLane(laneG.getAttribute('data-lane')); return; }
        const editG = btn.closest('.editable-label');
        if(editG && editG.getAttribute('data-edit') === 'note'){
          removeNote(parseInt(editG.getAttribute('data-line'), 10));
        }
      });

      attachAddHandlers(svg, insertLaneAt);

      attachEditableHandlers(svg, {
        conn: startConnLabelEdit,
        note: startNoteEdit,
        lane: startLaneRename
      });

      svg.querySelectorAll('.step-hitzone').forEach(g=>{
        g.addEventListener('click', ()=>{
          appendStepToLane(g.getAttribute('data-lane-append'));
        });
      });

      attachLinkHandleHandlers(svg, ()=>({
        snapRadius: 40,
        distance: (pt, x, y)=> Math.hypot(pt.x-x, pt.y-y), // steps: 2D snap
        getPoints: ()=> lastOrder.map(n=>({id:n.id, x:n.x, y:n.y})),
        onDrop: (from, to, clientX, clientY)=> showConnTypePicker(from, to, clientX, clientY)
      }));
    }

    return {
      id: 'swimlane',
      label: 'Swimlane',
      mark: 'SWL',
      sample: SAMPLE,
      emptyMessage: EMPTY_MESSAGE,
      emptyLabel: 'lane',
      exportBaseName: 'swimlane-diagram',
      // Small (~100x56) inline SVG shown as this type's card in the "New
      // diagram" modal -- purely decorative, doesn't need to match the real
      // renderer's output.
      thumbnail: `<svg width="100" height="56" viewBox="0 0 100 56" fill="none">
          <rect x="4" y="4" width="92" height="16" fill="#F7F8FA" stroke="#E7E9EE" stroke-width="1"/>
          <rect x="4" y="20" width="92" height="16" fill="#FFFFFF" stroke="#E7E9EE" stroke-width="1"/>
          <rect x="4" y="36" width="92" height="16" fill="#F7F8FA" stroke="#E7E9EE" stroke-width="1"/>
          <rect x="10" y="8" width="24" height="8" rx="2" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.3"/>
          <rect x="55" y="24" width="24" height="8" rx="2" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.3"/>
          <line x1="34" y1="12" x2="52" y2="27" stroke="#2F6FED" stroke-width="1.4"/>
          <path d="M52,27 L48,21.5 M52,27 L45.5,24" stroke="#2F6FED" stroke-width="1.4" fill="none"/>
        </svg>`,
      // Shown in the right-hand properties panel when nothing on the
      // canvas is selected -- tells the user what they can click.
      selectionHint: 'Click a lane or step on the canvas to edit its text, color, or shape.',
      spacing: {label:'Step spacing', min:90, max:360, step:10, default:160},
      toggle: {label:'Notes', default:true},
      snippets: [
        {key:'lane', label:'+ lane', text:'lane L1\n'},
        {key:'step', label:'+ step', text:'step s1 in L1: New step\n'},
        {key:'decision', label:'+ decision', text:'decision d1 in L1: Condition?\n'},
        {key:'start', label:'+ start', text:'start st in L1: Start\n'},
        {key:'end', label:'+ end', text:'end e1 in L1: End\n'},
        {key:'connector', label:'+ connector', text:'s1->s2: next\n'},
        {key:'note', label:'+ note', text:'note over s1: a short note\n'}
      ],
      helpHTML: `
        <div><b>title</b> text &nbsp;— add <b>&lt;br/&gt;</b> for a smaller byline underneath, e.g. author/date</div>
        <div><b>lane</b> Name [as Label] &nbsp;— a horizontal row, in declared order top to bottom</div>
        <div><b>start</b> id in Lane[: text] &nbsp;<b>end</b> id in Lane[: text]</div>
        <div><b>step</b> id in Lane: text &nbsp;— a process box</div>
        <div><b>decision</b> id in Lane: text &nbsp;— a diamond</div>
        <div><b>A-&gt;B:</b> text &nbsp;— solid flow &nbsp;&nbsp;<b>A--&gt;B:</b> text &nbsp;— dashed/alternate flow (e.g. a "no" branch)</div>
        <div><b>note over</b> A[,B]: text</div>
        <div>Drag any step left/right on the canvas to reposition it — use <b>Reset layout</b> to undo.</div>
        <div>Hover the gap between (or beside) lanes and click the red <b>+</b> to insert a new lane there.</div>
        <div>Hover a lane and click the red <b>×</b> in its corner to remove it — its steps and connectors go with it.</div>
        <div>Hover the right edge of a lane's row and click the blue <b>+</b> to append a new step to that lane.</div>
        <div>Hover a step, press the blue <b>+</b> handle and drag to another step — it snaps to the nearest step. Release and pick the connector type.</div>
        <div>Double-click any connector's label, a step, a lane, or a note to edit its text right there — Enter to save, Esc to cancel.</div>
        <div>Hover a step or a note and click the red <b>×</b> in its corner to remove it — its connectors go with it.</div>`,
      parseAndLayout,
      insertPrimaryAt: insertLaneAt,
      attach,
      // ---- uniform hooks the right-hand properties panel uses ----
      getNodeLabel: (id)=>{ const n = lastOrder.find(x=>x.id===id); return n ? n.label : undefined; },
      getNodeKind: (id)=>{ const n = lastOrder.find(x=>x.id===id); return n ? n.kind : null; },
      renameNode: renameStep,
      setNodeShape: setNodeKind,
      getLaneLabel: (name)=>{ const l = lastLanes.find(x=>x.name===name); return l ? l.label : undefined; },
      renameLane
    };
  })();

  registerEngine(SwimlaneEngine);
