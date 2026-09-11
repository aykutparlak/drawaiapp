  // ================================================================
  // FILE: js/engines/sequence.js
  // ENGINE: Sequence (UML-style sequence diagrams -- participants,
  //         messages, activations, loop/alt/opt/par blocks, notes).
  //
  // This file is fully self-contained: its own DSL grammar (parsed below),
  // its own layout math, its own SVG rendering, its own mutation functions
  // (insert/remove/rename participant, add a message, ...). It only talks
  // to the rest of the app in two directions:
  //   - IN: calls the generic helpers from js/core/utils.js and
  //     js/core/interactions.js (esc, fitLabel, textBlock, colorStyleFor,
  //     openInlineEditor, showPopupMenu, attachDragHandlers,
  //     attachSelectionHandlers, attachRemoveHandlers, attachAddHandlers,
  //     attachEditableHandlers, attachLinkHandleHandlers) instead of
  //     writing its own DOM event wiring, and calls the shared doRender()
  //     (render.js) after any DSL edit.
  //   - OUT: registers one object (see the `return {...}` below) via
  //     registerEngine(SequenceEngine) at the very end of this file.
  //
  // The full contract for that returned object -- every field, which ones
  // are required, and the DOM/CSS conventions this file's SVG output must
  // follow for the generic interactions above to work -- is documented
  // once, in full, in js/core/state.js under "ADDING A NEW DRAWING STYLE".
  // Read that before changing this file's shape, or before copying this
  // file as a starting point for a new engine.
  //
  // This file can be edited, tested, and reasoned about without reading
  // js/engines/swimlane.js (or any future engine) at all -- there is no
  // dependency between engine files.
  // ================================================================
  const SequenceEngine = (function(){

    const SAMPLE = `title Checkout flow

participant Browser
participant API as Checkout API
participant DB as Database
participant Bank as Payment Gateway

autonumber
Browser->API: POST /checkout
activate API
API->>DB: reserve inventory
note right of API: validating cart\\ncontents & totals
DB-->>API: reserved

loop retry up to 3x
  API->>Bank: charge card
  Bank-->>API: 202 accepted
end

alt payment approved
  API-->>Browser: 200 order confirmed
else payment declined
  API-->>Browser: 402 payment required
end
deactivate API

note over Browser,API: session closed`;

    const EMPTY_MESSAGE = 'Add at least one participant or message to see a diagram.';

    let lastOrder = [];
    let lastEventYMap = [];
    let lastLifelineBounds = {top:0, bottom:0};

    const arrowRe = /^(\w+)\s*(-->>|-->|->>|->)\s*(\w+)\s*:\s*(.*)$/;
    const participantRe = /^participant\s+(\w+)(?:\s+as\s+(.+))?$/i;
    const titleRe = /^title\s+(.+)$/i;
    const noteRe = /^note\s+(over|left of|right of)\s+([\w\s,]+?):\s*(.*)$/i;
    const activateRe = /^activate\s+(\w+)$/i;
    const deactivateRe = /^deactivate\s+(\w+)$/i;
    const blockStartRe = /^(loop|alt|opt|par|critical|rect)\b\s*(.*?)\s*(?:\[([^\]]+)\])?$/i;
    const elseRe = /^else\b\s*(.*)$/i;
    const endRe = /^end$/i;
    const autonumberRe = /^autonumber(?:\s+(on|off))?$/i;
    const ARROW_LINE_RE = /^(\w+)\s*(-->>|-->|->>|->)\s*(\w+)\s*:\s*(.*)$/;
    const NOTE_LINE_RE = /^note\s+(over|left of|right of)\s+([\w\s,]+?):\s*(.*)$/i;
    const BLOCK_LINE_RE = /^(loop|alt|opt|par|critical)\b\s*(.*?)\s*(?:\[([^\]]+)\])?$/i;

    function parseAndLayout(text, spacing, showBottom){
      spacing = spacing || 150;
      showBottom = showBottom !== false;
      const rawLines = text.split('\n');
      linecount.textContent = rawLines.length + ' line' + (rawLines.length===1?'':'s');

      const lines = rawLines
        .map((l,i)=>({raw:l, i}))
        .filter(l=>{
          const t = l.raw.trim();
          if(!t.length) return false;
          if(/^(#|\/\/|%%)/.test(t)) return false;
          if(/^sequenceDiagram\b/i.test(t)) return false;
          return true;
        });

      const explicit = [];
      const explicitSet = new Set();
      let title = null;

      for(const {raw} of lines){
        const t = raw.trim();
        let m;
        if((m = t.match(titleRe))){ title = m[1]; continue; }
        if((m = t.match(participantRe))){
          if(!explicitSet.has(m[1])){
            explicit.push({name:m[1], label:m[2]?m[2].trim():m[1]});
            explicitSet.add(m[1]);
          }
        }
      }

      const seen = new Set(explicit.map(p=>p.name));
      const order = explicit.slice();

      function ensure(name){
        if(!seen.has(name)){
          seen.add(name);
          order.push({name, label:name});
        }
      }

      for(const {raw} of lines){
        const t = raw.trim();
        let m;
        if((m = t.match(arrowRe))){ ensure(m[1]); ensure(m[3]); continue; }
        if((m = t.match(noteRe))){
          m[2].split(',').map(s=>s.trim()).forEach(ensure);
          continue;
        }
        if((m = t.match(activateRe))){ ensure(m[1]); continue; }
        if((m = t.match(deactivateRe))){ ensure(m[1]); continue; }
      }

      if(order.length === 0){
        lastOrder = []; // discard any stale participant list so the + button starts fresh
        throw new Error(EMPTY_MESSAGE);
      }

      const charW = 7.3;
      const minGap = spacing;
      const xs = [];
      let cursorX = 90;
      for(const p of order){
        const w = Math.max(90, p.label.length * charW + 40);
        p._w = w;
        xs.push(cursorX);
        cursorX += Math.max(minGap, w/2 + 90);
      }
      order.forEach((p,idx)=>{
        const override = customLayout[p.name];
        p.x = (override !== undefined) ? override : xs[idx];
      });
      const byName = {};
      order.forEach(p=> byName[p.name]=p);

      const maxHalfW = Math.max(...order.map(p=>p._w/2));
      const leftBound = Math.min(...order.map(p=>p.x)) - maxHalfW - 30;
      const rightBound = Math.max(...order.map(p=>p.x)) + maxHalfW + 30;
      const diagramWidth = rightBound + 30;

      const titleLines = title ? title.split(/<br\s*\/?>/i).map(s=>s.trim()).filter(l=>l.length) : [];
      let titleH, titleSvg;
      if(titleLines.length === 0){
        titleH = 20;
        titleSvg = '';
      } else if(titleLines.length === 1){
        titleH = 56;
        titleSvg = `<text x="${diagramWidth/2}" y="30" text-anchor="middle" font-family="IBM Plex Sans, sans-serif"
                      font-size="17" font-weight="700" fill="#1F2430">${esc(titleLines[0])}</text>
                      <line x1="${leftBound}" y1="42" x2="${rightBound}" y2="42" stroke="var(--grid-line,#1B3352)" stroke-width="1"/>`;
      } else {
        const SUBTITLE_LINE_H = 13;
        const mainY = 22;
        let cursorY = mainY + 15;
        let subtitleSvg = '';
        for(let k=1; k<titleLines.length; k++){
          subtitleSvg += `<text x="${diagramWidth/2}" y="${cursorY}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                        font-size="10.5" fill="#767E8C">${esc(titleLines[k])}</text>`;
          cursorY += SUBTITLE_LINE_H;
        }
        const dividerY = cursorY + 6;
        titleH = dividerY + 14;
        titleSvg = `<text x="${diagramWidth/2}" y="${mainY}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif"
                      font-size="16" font-weight="700" fill="#1F2430">${esc(titleLines[0])}</text>
                      ${subtitleSvg}
                      <line x1="${leftBound}" y1="${dividerY}" x2="${rightBound}" y2="${dividerY}" stroke="var(--grid-line,#1B3352)" stroke-width="1"/>`;
      }
      const headerH = 42;
      let y = titleH + headerH + 26;

      const svgParts = [];
      const activationStacks = {};
      order.forEach(p=> activationStacks[p.name] = []);

      const blockStack = [];

      function drawParticipantHeader(atY, removable){
        order.forEach(p=>{
          svgParts.push(headerBox(p, atY, removable));
        });
      }

      function headerBox(p, atY, removable){
        const w = p._w, x = p.x - w/2;
        const removeBtn = removable ? `
            <g class="remove-btn">
              <circle cx="${x+w-3}" cy="${atY-3}" r="8" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.3"/>
              <text x="${x+w-3}" y="${atY-3+3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                    font-size="10.5" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
            </g>` : '';
        const nodeAttrs = removable ? `data-node="${esc(p.name)}" data-node-kind="participant" data-x="${p.x}"` : '';
        const colorStyle = colorStyleFor(p.name);
        return `
          <g ${nodeAttrs} class="${removable?'has-remove':''}"${colorStyle}>
            <rect x="${x}" y="${atY}" width="${w}" height="${headerH}" rx="6"
                  fill="#F7F8FA" stroke="var(--amber,#2F6FED)" stroke-width="1.3"/>
            <text x="${p.x}" y="${atY+headerH/2+5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="13" font-weight="600" fill="#1F2430" style="pointer-events:none;">${esc(p.label)}</text>
            ${removeBtn}
          </g>`;
      }

      drawParticipantHeader(titleH, true);
      const lifelineTop = titleH + headerH;

      function activationXOffset(name){
        return activationStacks[name].length * 6;
      }

      function messageLine(fromX, toX, atY, dashed, async){
        return `<line x1="${fromX}" y1="${atY}" x2="${toX}" y2="${atY}" stroke="var(--amber,#2F6FED)" stroke-width="1.6"
                stroke-dasharray="${dashed?'6,4':'0'}" marker-end="url(#${async?'arrowOpen':'arrowFilled'})"/>`;
      }

      let autonumberOn = false;
      let msgCounter = 1;
      const BADGE_R = 10;

      function numberBadge(cx, cy, num){
        return `<circle cx="${cx}" cy="${cy}" r="${BADGE_R}" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.5"/>
                <text x="${cx}" y="${cy+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                      font-size="11" font-weight="700" fill="#FFFFFF">${num}</text>`;
      }

      const eventYMap = [];

      for(const {raw, i} of lines){
        const t = raw.trim();
        let m;

        if(titleRe.test(t) || participantRe.test(t)) continue;

        if((m = t.match(autonumberRe))){
          autonumberOn = m[1] ? m[1].toLowerCase() !== 'off' : true;
          continue;
        }

        eventYMap.push({y, lineIndex:i});

        if((m = t.match(blockStartRe))){
          blockStack.push({type:m[1].toLowerCase(), label:m[2]||'', span:m[3]||null, startY:y, dividers:[], lineIndex:i, svgIndex: svgParts.length});
          y += 34;
          continue;
        }
        if((m = t.match(elseRe))){
          if(blockStack.length===0) throw new Error(`Line ${i+1}: "else" with no matching block start`);
          blockStack[blockStack.length-1].dividers.push({y, label:m[1]||''});
          y += 30;
          continue;
        }
        if(endRe.test(t)){
          const blk = blockStack.pop();
          if(!blk) throw new Error(`Line ${i+1}: "end" with no matching block start`);
          let left = leftBound, right = rightBound;
          if(blk.span){
            const spanNames = blk.span.split(',').map(s=>s.trim()).filter(Boolean);
            const spanXs = spanNames.filter(n=>byName[n]).map(n=>byName[n].x);
            if(spanXs.length){
              left = Math.min(...spanXs) - 40;
              right = Math.max(...spanXs) + 40;
              if(right - left < 140){
                const c = (left + right) / 2;
                left = c - 70; right = c + 70;
              }
              left = Math.max(left, leftBound);
              right = Math.min(right, rightBound);
            }
          }
          const bx = left, bw = right-left, bh = y - blk.startY + 14;
          const by = blk.startY - 4;

          if(blk.type === 'rect'){
            const rawColor = (blk.label || '').trim();
            const color = /^[a-zA-Z0-9#(),.\s-]{1,40}$/.test(rawColor) ? rawColor : '#F0F0F0';
            svgParts.splice(blk.svgIndex, 0,
              `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${color}" opacity="0.55" data-line="${blk.lineIndex}"/>`);
            y += 20;
            continue;
          }

          let inner = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="none"
                       stroke="var(--teal,#2F6FED)" stroke-width="1.3" stroke-dasharray="5,4" opacity="0.85"/>`;
          const tabW = Math.min(bw-10, 34 + (blk.type.length+ (blk.label?blk.label.length:0))*6.4);
          inner += `<path d="M ${bx} ${by} h ${tabW} v 16 l -8 8 h -${tabW-8} z" fill="var(--panel,#F7F8FA)" stroke="var(--teal,#2F6FED)" stroke-width="1.2"/>
              <text x="${bx+8}" y="${by+16}" font-family="IBM Plex Mono, monospace" font-size="10.5" font-weight="600" fill="var(--teal,#2F6FED)">${esc(blk.type.toUpperCase())}${blk.label? '  '+esc(blk.label):''}</text>`;
          blk.dividers.forEach(d=>{
            inner += `<line x1="${bx}" y1="${d.y-6}" x2="${bx+bw}" y2="${d.y-6}" stroke="var(--teal,#2F6FED)" stroke-width="1" stroke-dasharray="4,4" opacity="0.7"/>`;
            if(d.label) inner += `<text x="${bx+10}" y="${d.y+10}" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="var(--teal,#2F6FED)">[${esc(d.label)}]</text>`;
          });
          inner += removeBadgeSvg(bx + bw - 6, by - 4);
          svgParts.push(`<g class="editable-label" data-edit="block" data-line="${blk.lineIndex}">${inner}</g>`);
          y += 20;
          continue;
        }

        if((m = t.match(activateRe))){
          const name = m[1];
          if(!byName[name]) throw new Error(`Line ${i+1}: unknown participant "${name}"`);
          activationStacks[name].push({startY:y});
          continue;
        }
        if((m = t.match(deactivateRe))){
          const name = m[1];
          if(!byName[name]) throw new Error(`Line ${i+1}: unknown participant "${name}"`);
          const stack = activationStacks[name];
          const open = stack.pop();
          if(!open) throw new Error(`Line ${i+1}: deactivate "${name}" with no matching activate`);
          const depth = stack.length;
          const x = byName[name].x - 6 + depth*6;
          svgParts.push(`<rect x="${x}" y="${open.startY}" width="12" height="${y-open.startY}" rx="2"
                         fill="var(--panel-raised,#FFFFFF)" stroke="var(--amber,#2F6FED)" stroke-width="1.2"/>`);
          continue;
        }

        if((m = t.match(noteRe))){
          const pos = m[1].toLowerCase();
          const names = m[2].split(',').map(s=>s.trim());
          names.forEach(n=>{ if(!byName[n]) throw new Error(`Line ${i+1}: unknown participant "${n}"`); });
          const noteText = m[3];
          const textLines = noteText.split(/\\n|<br\s*\/?>/i).map(s=>s.trim());
          const boxH = 24 + textLines.length*15;
          let bx, bw;
          if(pos === 'over'){
            const xs2 = names.map(n=>byName[n].x);
            const c = (Math.min(...xs2)+Math.max(...xs2))/2;
            bw = Math.max(120, Math.max(...textLines.map(l=>l.length))*7 + 30, (Math.max(...xs2)-Math.min(...xs2))+60);
            bx = c - bw/2;
          } else if(pos === 'left of'){
            bw = Math.max(110, Math.max(...textLines.map(l=>l.length))*7 + 24);
            bx = byName[names[0]].x - 20 - bw;
          } else {
            bw = Math.max(110, Math.max(...textLines.map(l=>l.length))*7 + 24);
            bx = byName[names[0]].x + 20;
          }
          let g = `<rect x="${bx}" y="${y}" width="${bw}" height="${boxH}" rx="3"
                   fill="var(--panel,#F7F8FA)" stroke="var(--amber,#2F6FED)" stroke-width="1.1"/>`;
          textLines.forEach((tl,idx)=>{
            g += `<text x="${bx+bw/2}" y="${y+20+idx*15}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="11" fill="#1F2430">${esc(tl)}</text>`;
          });
          g += removeBadgeSvg(bx + bw - 6, y - 4);
          svgParts.push(`<g class="editable-label" data-edit="note" data-line="${i}">${g}</g>`);
          y += boxH + 18;
          continue;
        }

        if((m = t.match(arrowRe))){
          const [, from, arrow, to, label] = m;
          if(!byName[from]) throw new Error(`Line ${i+1}: unknown participant "${from}"`);
          if(!byName[to]) throw new Error(`Line ${i+1}: unknown participant "${to}"`);
          const dashed = arrow.startsWith('-->');
          const async = arrow.endsWith('>>');

          const fromOff = activationXOffset(from);
          const toOff = activationXOffset(to);

          if(from === to){
            let x = byName[from].x + 6 + fromOff;
            const loopW = 56;
            let badge = '';
            if(autonumberOn){
              badge = numberBadge(x, y, msgCounter++);
              x += BADGE_R + 4;
            }
            const fit = fitLabel(label, loopW + 40);
            const wrapped = fit.lines.length > 1;
            const lineHeight = fit.fontSize + 3;
            const firstBaseline = wrapped ? y+10 : y+16;
            const textEls = fit.lines.map((ln, idx)=>
              `<text x="${x+10}" y="${firstBaseline + idx*lineHeight}" font-family="IBM Plex Mono, monospace" font-size="${fit.fontSize}" fill="#1F2430">${esc(ln)}</text>`
            ).join('\n');
            const maxLen = Math.max(1, ...fit.lines.map(l=>l.length));
            const hitW = Math.max(50, maxLen * fit.fontSize * 0.62 + 14);
            const hitH = (fit.lines.length-1)*lineHeight + fit.fontSize + (wrapped ? 16 : 12);
            const hitY = firstBaseline - fit.fontSize - 2;
            const labelSvg = `<g class="editable-label" data-edit="msg" data-line="${i}">
                <rect x="${x+6}" y="${hitY}" width="${hitW}" height="${hitH}" fill="transparent"/>
                ${textEls}
              </g>`;
            svgParts.push(`
              <path d="M ${x} ${y} C ${x+loopW} ${y}, ${x+loopW} ${y+34}, ${x} ${y+34}"
                    fill="none" stroke="var(--amber,#2F6FED)" stroke-width="1.6" stroke-dasharray="${dashed?'6,4':'0'}"
                    marker-end="url(#${async?'arrowOpen':'arrowFilled'})"/>
              ${labelSvg}
              ${badge}
            `);
            y += wrapped ? 50 + (fit.lines.length-1)*lineHeight : 50;
            continue;
          }

          const fx = byName[from].x, tx = byName[to].x;
          const dir = tx > fx ? 1 : -1;
          const fxAdj = fx + dir*(6+fromOff);
          const txAdj = tx - dir*(6+toOff);
          let lineStartX = fxAdj;
          let badge = '';
          if(autonumberOn){
            badge = numberBadge(fxAdj, y, msgCounter++);
            lineStartX = fxAdj + dir*(BADGE_R + 3);
          }
          const fit = fitLabel(label, Math.abs(txAdj - fxAdj));
          const wrapped = fit.lines.length > 1;
          const lineHeight2 = fit.fontSize + 3;
          const lastBaseline = y-8;
          const topBaseline = lastBaseline - (fit.lines.length-1)*lineHeight2;
          const midX = (fxAdj+txAdj)/2;
          const textEls = fit.lines.map((ln, idx)=>
            `<text x="${midX}" y="${topBaseline + idx*lineHeight2}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="${fit.fontSize}" fill="#1F2430">${esc(ln)}</text>`
          ).join('\n');
          const maxLen2 = Math.max(1, ...fit.lines.map(l=>l.length));
          const hitW2 = Math.max(50, maxLen2 * fit.fontSize * 0.62 + 14);
          const hitH2 = (fit.lines.length-1)*lineHeight2 + fit.fontSize + (wrapped ? 18 : 12);
          const hitY2 = topBaseline - fit.fontSize - 2;
          const labelSvg = `<g class="editable-label" data-edit="msg" data-line="${i}">
              <rect x="${midX-hitW2/2}" y="${hitY2}" width="${hitW2}" height="${hitH2}" fill="transparent"/>
              ${textEls}
            </g>`;

          svgParts.push(`
            ${labelSvg}
            ${messageLine(lineStartX, txAdj, y, dashed, async)}
            ${badge}
          `);
          y += wrapped ? 46 + (fit.lines.length-1)*lineHeight2 : 46;
          continue;
        }

        throw new Error(`Line ${i+1}: could not parse — "${t}"`);
      }

      if(blockStack.length){
        throw new Error(`Missing "end" for open block: ${blockStack[blockStack.length-1].type}`);
      }
      Object.keys(activationStacks).forEach(name=>{
        activationStacks[name].forEach(open=>{
          const x = byName[name].x - 6;
          svgParts.push(`<rect x="${x}" y="${open.startY}" width="12" height="${y-open.startY}" rx="2"
                         fill="var(--panel-raised,#FFFFFF)" stroke="var(--amber,#2F6FED)" stroke-width="1.2"/>`);
        });
      });

      const bottomY = y + 10;
      if(showBottom){
        drawParticipantHeader(bottomY, false);
      }
      const totalH = bottomY + (showBottom ? headerH + 20 : 16);

      const lifelineBottom = showBottom ? bottomY : bottomY - 10;
      const lifelines = order.map(p=>
        `<line x1="${p.x}" y1="${lifelineTop}" x2="${p.x}" y2="${lifelineBottom}" stroke="var(--line-soft,#D6DAE1)" stroke-width="1.2" stroke-dasharray="3,4"/>`
      ).join('');

      const defs = `
        <defs>
          <marker id="arrowFilled" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--amber,#2F6FED)"/>
          </marker>
          <marker id="arrowOpen" markerWidth="12" markerHeight="10" refX="8" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="none" stroke="var(--amber,#2F6FED)" stroke-width="1.4"/>
          </marker>
        </defs>`;

      const viewX = Math.min(0, leftBound - 10);
      const viewW = diagramWidth - viewX;

      const addZones = [];
      for(let idx=0; idx<=order.length; idx++){
        let gx;
        if(idx === 0) gx = order[0].x - order[0]._w/2 - 26;
        else if(idx === order.length) gx = order[order.length-1].x + order[order.length-1]._w/2 + 26;
        else gx = (order[idx-1].x + order[idx].x)/2;
        const gy = titleH + headerH/2;
        addZones.push(`
          <g class="add-hotzone" data-insert-index="${idx}">
            <rect x="${gx-16}" y="${titleH-4}" width="32" height="${headerH+8}" fill="transparent"/>
            <circle class="add-btn" cx="${gx}" cy="${gy}" r="10" fill="#D0453A"/>
            <text class="add-btn" x="${gx}" y="${gy+4}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
                  font-size="14" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">+</text>
          </g>`);
      }

      const linkHandles = order.map(p => `
        <g class="link-handle" data-linksrc="${esc(p.name)}">
          <rect x="${p.x-14}" y="${lifelineTop}" width="28" height="${lifelineBottom-lifelineTop}" fill="transparent"/>
          <circle class="link-add-btn" cx="${p.x}" cy="${lifelineTop+20}" r="9" fill="#2F6FED"/>
          <text class="link-add-btn" x="${p.x}" y="${lifelineTop+24}" text-anchor="middle"
                font-family="IBM Plex Mono, monospace" font-size="13" font-weight="700" fill="#FFFFFF"
                style="pointer-events:none;">+</text>
        </g>`).join('');

      lastOrder = order.map(p=>({name:p.name, label:p.label, x:p.x}));
      lastEventYMap = eventYMap;
      lastLifelineBounds = {top: lifelineTop, bottom: lifelineBottom};

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewW}" height="${totalH}"
                    viewBox="${viewX} 0 ${viewW} ${totalH}" font-family="IBM Plex Sans, sans-serif" style="${accentStyleAttr()}">
          <rect class="diagram-bg" x="${viewX}" y="0" width="${viewW}" height="${totalH}" fill="#FFFFFF"/>
          ${defs}
          ${titleSvg}
          ${lifelines}
          ${addZones.join('')}
          ${svgParts.join('\n')}
          ${linkHandles}
        </svg>`;

      return svg;
    }

    // ---------------- mutations ----------------

    function insertParticipantAt(index){
      const names = lastOrder.map(p=>p.name);
      let n = 1;
      while(names.includes('P'+n)) n++;
      const newName = 'P' + n;

      const declRe = /^\s*participant\s+(\w+)(?:\s+as\s+(.+))?\s*$/i;
      const lines = dslEl.value.split('\n');
      const declByName = {};
      const rest = [];
      lines.forEach(line=>{
        const m = line.match(declRe);
        if(m) declByName[m[1]] = line.trim();
        else rest.push(line);
      });
      while(rest.length && rest[0].trim() === '') rest.shift();

      const finalNames = names.slice();
      finalNames.splice(index, 0, newName);
      const declLines = finalNames.map(nm =>
        nm === newName ? `participant ${newName}` : (declByName[nm] || `participant ${nm}`)
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

    function removeParticipant(name){
      const rawLines = dslEl.value.split('\n');
      const kept = [];

      for(const rawLine of rawLines){
        const leading = rawLine.match(/^\s*/)[0];
        const line = rawLine.trim();
        let m;

        if((m = line.match(participantRe))){
          if(m[1] !== name) kept.push(rawLine);
          continue;
        }
        if((m = line.match(arrowRe))){
          if(m[1] !== name && m[3] !== name) kept.push(rawLine);
          continue;
        }
        if((m = line.match(activateRe))){
          if(m[1] !== name) kept.push(rawLine);
          continue;
        }
        if((m = line.match(deactivateRe))){
          if(m[1] !== name) kept.push(rawLine);
          continue;
        }
        if((m = line.match(noteRe))){
          const pos = m[1];
          const names = m[2].split(',').map(s=>s.trim());
          const remaining = names.filter(n=>n!==name);
          if(remaining.length === 0) continue;
          if(remaining.length === names.length){ kept.push(rawLine); continue; }
          kept.push(`${leading}note ${pos} ${remaining.join(',')}: ${m[3]}`);
          continue;
        }

        kept.push(rawLine);
      }

      let text = kept.join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n');

      delete customLayout[name];
      dslEl.value = text;
      doRender();
    }

    function renameParticipant(name, newLabel){
      const lines = dslEl.value.split('\n');
      const declText = (newLabel === name) ? `participant ${name}` : `participant ${name} as ${newLabel}`;

      let foundIdx = -1;
      lines.forEach((line, idx)=>{
        const m = line.trim().match(participantRe);
        if(m && m[1] === name) foundIdx = idx;
      });

      if(foundIdx !== -1){
        const leading = lines[foundIdx].match(/^\s*/)[0];
        lines[foundIdx] = leading + declText;
      } else {
        const names = lastOrder.map(p => p.name);
        const myIndex = names.indexOf(name);
        let insertAt = 0;
        for(let k = myIndex - 1; k >= 0; k--){
          const idx = lines.findIndex(l => {
            const m = l.trim().match(participantRe);
            return m && m[1] === names[k];
          });
          if(idx !== -1){ insertAt = idx + 1; break; }
        }
        lines.splice(insertAt, 0, declText);
      }

      dslEl.value = lines.join('\n');
      doRender();
    }

    function addArrowBetween(from, to, svgY, arrowType, label){
      arrowType = arrowType || '->';
      const finalLabel = (label || '').trim() || `${from} to ${to}`;
      const rawLines = dslEl.value.split('\n');

      let insertAfter = -1;
      for(const ev of lastEventYMap){
        if(ev.y <= svgY) insertAfter = ev.lineIndex;
        else break;
      }
      if(insertAfter === -1){
        rawLines.forEach((line, idx)=>{
          if(participantRe.test(line.trim())) insertAfter = idx;
        });
      }

      const newLine = `${from}${arrowType}${to}: ${finalLabel}`;
      rawLines.splice(insertAfter + 1, 0, newLine);
      dslEl.value = rawLines.join('\n');
      doRender();
    }

    const ARROW_TYPES = [
      {key:'->',   label:'Call',           dashed:false, async:false},
      {key:'->>',  label:'Async call',     dashed:false, async:true},
      {key:'-->',  label:'Response',       dashed:true,  async:false},
      {key:'-->>', label:'Async response', dashed:true,  async:true}
    ];

    function arrowTypeIcon(t){
      const headPath = t.async
        ? `<path d="M32,7 L26,3.2 M32,7 L26,10.8" stroke="#2F6FED" stroke-width="1.6" fill="none"/>`
        : `<path d="M32,7 L25,3.2 L25,10.8 Z" fill="#2F6FED"/>`;
      return `<svg width="40" height="14" viewBox="0 0 40 14">
        <line x1="2" y1="7" x2="32" y2="7" stroke="#2F6FED" stroke-width="1.8"
              stroke-dasharray="${t.dashed ? '5,3' : '0'}"/>
        ${headPath}
      </svg>`;
    }

    function showArrowTypePicker(from, to, svgY, clientX, clientY){
      showPopupMenu({
        labelText: (from === to) ? `${from} — self message` : `${from} → ${to}`,
        clientX, clientY,
        items: ARROW_TYPES.map(t=>({
          html: `${arrowTypeIcon(t)}<span>${t.label}</span>`,
          onChoose: ()=>{
            const defaultLabel = (from === to) ? `${t.label} ${from}` : `${t.label} ${from} to ${to}`;
            addArrowBetween(from, to, svgY, t.key, defaultLabel);
          }
        }))
      });
    }

    // ---------------- inline edit: message / note / block label ----------------

    function startLabelEdit(g){
      const lineIndex = parseInt(g.getAttribute('data-line'), 10);
      const rawLines = dslEl.value.split('\n');
      const rawLine = rawLines[lineIndex] || '';
      const leading = rawLine.match(/^\s*/)[0];
      const m = rawLine.trim().match(ARROW_LINE_RE);
      if(!m) return;
      const [, from, arrow, to, currentLabel] = m;
      openInlineEditor({
        anchorRect: g.getBoundingClientRect(),
        initialValue: currentLabel,
        onCommit: (val)=>{
          const lines = dslEl.value.split('\n');
          lines[lineIndex] = `${leading}${from}${arrow}${to}: ${val}`;
          dslEl.value = lines.join('\n');
          doRender();
        }
      });
    }

    function startParticipantRename(g){
      const name = g.getAttribute('data-node');
      if(!name) return;
      const p = lastOrder.find(p => p.name === name);
      const currentLabel = p ? p.label : name;
      const rectEl = g.querySelector('rect');
      const box = (rectEl || g).getBoundingClientRect();
      openInlineEditor({
        anchorRect: box,
        initialValue: currentLabel,
        textAlign: 'center',
        onCommit: (val)=>{
          if(val && val !== currentLabel) renameParticipant(name, val);
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
      const [, pos, names, currentText] = m;
      openInlineEditor({
        anchorRect: g.getBoundingClientRect(),
        initialValue: currentText.replace(/\\n/g, ' '),
        textAlign: 'center',
        minWidth: 90,
        onCommit: (val)=>{
          const lines = dslEl.value.split('\n');
          lines[lineIndex] = `${leading}note ${pos} ${names}: ${val}`;
          dslEl.value = lines.join('\n');
          doRender();
        }
      });
    }

    function startBlockLabelEdit(g){
      const lineIndex = parseInt(g.getAttribute('data-line'), 10);
      const rawLines = dslEl.value.split('\n');
      const rawLine = rawLines[lineIndex] || '';
      const leading = rawLine.match(/^\s*/)[0];
      const m = rawLine.trim().match(BLOCK_LINE_RE);
      if(!m) return;
      const [, type, currentLabel, span] = m;
      const spanSuffix = span ? ` [${span}]` : '';
      openInlineEditor({
        anchorRect: g.getBoundingClientRect(),
        initialValue: currentLabel,
        minWidth: 110,
        onCommit: (val)=>{
          const lines = dslEl.value.split('\n');
          lines[lineIndex] = val ? `${leading}${type} ${val}${spanSuffix}` : `${leading}${type}${spanSuffix}`;
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

    function removeBlock(startLineIndex){
      const blockOpenRe = /^(loop|alt|opt|par|critical)\b/i;
      const elseOpenRe = /^else\b/i;
      const endOpenRe = /^end$/i;

      const lines = dslEl.value.split('\n');
      if(startLineIndex < 0 || startLineIndex >= lines.length) return;

      let depth = 0;
      let endLineIndex = -1;
      const elseIndices = [];
      for(let k = startLineIndex + 1; k < lines.length; k++){
        const t = lines[k].trim();
        if(blockOpenRe.test(t)){ depth++; continue; }
        if(endOpenRe.test(t)){
          if(depth === 0){ endLineIndex = k; break; }
          depth--;
          continue;
        }
        if(elseOpenRe.test(t) && depth === 0){ elseIndices.push(k); continue; }
      }
      if(endLineIndex === -1) return;

      for(let k = startLineIndex + 1; k < endLineIndex; k++){
        if(elseIndices.includes(k)) continue;
        lines[k] = lines[k].replace(/^ {1,2}/, '');
      }

      const toRemove = [endLineIndex, ...elseIndices, startLineIndex].sort((a,b)=>b-a);
      toRemove.forEach(idx => lines.splice(idx, 1));

      dslEl.value = lines.join('\n');
      doRender();
    }

    // ---------------- drag-select an area to wrap in a block, or drop a note ----------------

    let selectState = null;
    let confirmedSelectionEl = null;

    function onSelectStart(e){
      if(e.type === 'mousedown' && e.button !== 0) return;
      e.preventDefault();
      const svg = holder.querySelector('svg');
      if(!svg) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const startX = svgClientX(svg, clientX);
      const startY = svgClientY(svg, clientY);

      const ns = 'http://www.w3.org/2000/svg';
      const rectEl = document.createElementNS(ns, 'rect');
      rectEl.setAttribute('x', startX);
      rectEl.setAttribute('y', startY);
      rectEl.setAttribute('width', 0);
      rectEl.setAttribute('height', 0);
      rectEl.setAttribute('fill', 'rgba(47,111,237,0.10)');
      rectEl.setAttribute('stroke', '#2F6FED');
      rectEl.setAttribute('stroke-width', '1.5');
      rectEl.setAttribute('stroke-dasharray', '5,4');
      rectEl.setAttribute('pointer-events', 'none');
      svg.appendChild(rectEl);

      selectState = {startX, startY, rectEl};
      window.addEventListener('mousemove', onSelectMove);
      window.addEventListener('touchmove', onSelectMove, {passive:false});
      window.addEventListener('mouseup', onSelectEnd);
      window.addEventListener('touchend', onSelectEnd);
    }

    function onSelectMove(e){
      if(!selectState) return;
      if(e.touches) e.preventDefault();
      const svg = holder.querySelector('svg');
      if(!svg) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = svgClientX(svg, clientX);
      const y = svgClientY(svg, clientY);
      const {startX, startY, rectEl} = selectState;
      rectEl.setAttribute('x', Math.min(startX, x));
      rectEl.setAttribute('y', Math.min(startY, y));
      rectEl.setAttribute('width', Math.abs(x - startX));
      rectEl.setAttribute('height', Math.abs(y - startY));
    }

    function onSelectEnd(e){
      if(!selectState) return;
      const {startX, startY, rectEl} = selectState;
      const evt = (e && e.changedTouches) ? e.changedTouches[0] : e;
      const svg = holder.querySelector('svg');
      let endX = startX, endY = startY;
      if(svg && evt){
        endX = svgClientX(svg, evt.clientX);
        endY = svgClientY(svg, evt.clientY);
      }
      rectEl.remove();
      window.removeEventListener('mousemove', onSelectMove);
      window.removeEventListener('touchmove', onSelectMove);
      window.removeEventListener('mouseup', onSelectEnd);
      window.removeEventListener('touchend', onSelectEnd);
      selectState = null;

      const x1 = Math.min(startX, endX), x2 = Math.max(startX, endX);
      const y1 = Math.min(startY, endY), y2 = Math.max(startY, endY);
      if(x2 - x1 < 15 || y2 - y1 < 15) return;

      const clientX = evt ? evt.clientX : window.innerWidth/2;
      const clientY = evt ? evt.clientY : window.innerHeight/2;
      finalizeSelection(x1, y1, x2, y2, clientX, clientY);
    }

    function finalizeSelection(x1, y1, x2, y2, clientX, clientY){
      const svg = holder.querySelector('svg');
      if(!svg) return;

      const ns = 'http://www.w3.org/2000/svg';
      const highlight = document.createElementNS(ns, 'rect');
      highlight.setAttribute('x', x1);
      highlight.setAttribute('y', y1);
      highlight.setAttribute('width', x2 - x1);
      highlight.setAttribute('height', y2 - y1);
      highlight.setAttribute('fill', 'rgba(47,111,237,0.08)');
      highlight.setAttribute('stroke', '#2F6FED');
      highlight.setAttribute('stroke-width', '1.5');
      highlight.setAttribute('stroke-dasharray', '5,4');
      highlight.setAttribute('pointer-events', 'none');
      svg.appendChild(highlight);
      confirmedSelectionEl = highlight;

      showBlockPicker(x1, y1, x2, y2, clientX, clientY);
    }

    const BLOCK_PICKER_TYPES = [
      {key:'loop', label:'Loop', defaultLabel:'repeat'},
      {key:'alt',  label:'Alt/Else', defaultLabel:'condition'},
      {key:'opt',  label:'Opt', defaultLabel:'optional'},
      {key:'par',  label:'Par', defaultLabel:'in parallel'}
    ];

    function showBlockPicker(x1, y1, x2, y2, clientX, clientY){
      const items = BLOCK_PICKER_TYPES.map(t=>({
        html: t.label,
        onChoose: ()=> wrapSelectionInBlock(t.key, t.defaultLabel, x1, y1, x2, y2)
      }));
      items.push({
        html: 'Note',
        onChoose: ()=> addNoteAtSelection(x1, y1, x2)
      });
      showPopupMenu({
        labelText: 'Wrap selection in',
        clientX, clientY, items,
        onClose: ()=>{
          // whether an option was chosen (doRender() already replaced the
          // SVG) or the popup was dismissed, drop the stale JS reference
          if(confirmedSelectionEl){ confirmedSelectionEl.remove(); confirmedSelectionEl = null; }
        }
      });
    }

    function findInsertAfter(rawLines, y){
      let insertAfter = -1;
      for(const ev of lastEventYMap){
        if(ev.y <= y) insertAfter = ev.lineIndex;
        else break;
      }
      if(insertAfter === -1){
        rawLines.forEach((line, idx)=>{
          if(participantRe.test(line.trim())) insertAfter = idx;
        });
      }
      return insertAfter;
    }

    function coveredParticipantSpan(x1, x2){
      const covered = lastOrder.filter(p => p.x >= x1 - 20 && p.x <= x2 + 20);
      if(covered.length > 0){
        return {leftName: covered[0].name, rightName: covered[covered.length - 1].name};
      }
      if(lastOrder.length === 0) return null;
      const cx = (x1 + x2) / 2;
      let nearest = lastOrder[0], best = Infinity;
      for(const p of lastOrder){
        const d = Math.abs(p.x - cx);
        if(d < best){ best = d; nearest = p; }
      }
      return {leftName: nearest.name, rightName: nearest.name};
    }

    function wrapSelectionInBlock(type, defaultLabel, x1, y1, x2, y2){
      const lines = dslEl.value.split('\n');

      const span = coveredParticipantSpan(x1, x2);
      const spanSuffix = span
        ? (span.leftName === span.rightName ? ` [${span.leftName}]` : ` [${span.leftName},${span.rightName}]`)
        : '';
      const covered = lastEventYMap.filter(ev => ev.y >= y1 && ev.y <= y2);
      const startLine = `${type} ${defaultLabel}${spanSuffix}`;

      if(covered.length === 0){
        const insertAfter = findInsertAfter(lines, y1);
        lines.splice(insertAfter + 1, 0, startLine, '  ', 'end');
      } else {
        const firstLine = Math.min(...covered.map(ev => ev.lineIndex));
        const lastLine = Math.max(...covered.map(ev => ev.lineIndex));
        for(let k = firstLine; k <= lastLine; k++){
          lines[k] = '  ' + lines[k];
        }
        lines.splice(lastLine + 1, 0, 'end');
        lines.splice(firstLine, 0, startLine);
      }

      dslEl.value = lines.join('\n');
      doRender();
    }

    function addNoteAtSelection(x1, y1, x2){
      const span = coveredParticipantSpan(x1, x2);
      if(!span) return;
      const {leftName, rightName} = span;

      const lines = dslEl.value.split('\n');
      const insertAfter = findInsertAfter(lines, y1);
      const spanText = (leftName === rightName)
        ? `note over ${leftName}: note`
        : `note over ${leftName},${rightName}: note`;
      lines.splice(insertAfter + 1, 0, spanText);
      dslEl.value = lines.join('\n');
      doRender();
    }

    // ---------------- attach ----------------

    function attach(svg){
      attachDragHandlers(svg, startParticipantRename);
      attachSelectionHandlers(svg);

      attachRemoveHandlers(svg, (btn)=>{
        const nodeG = btn.closest('[data-node]');
        if(nodeG){ removeParticipant(nodeG.getAttribute('data-node')); return; }
        const editG = btn.closest('.editable-label');
        if(editG){
          const kind = editG.getAttribute('data-edit');
          const lineIndex = parseInt(editG.getAttribute('data-line'), 10);
          if(kind === 'note') removeNote(lineIndex);
          else if(kind === 'block') removeBlock(lineIndex);
        }
      });

      attachAddHandlers(svg, insertParticipantAt);

      attachEditableHandlers(svg, {
        msg: startLabelEdit,
        note: startNoteEdit,
        block: startBlockLabelEdit
      });

      attachLinkHandleHandlers(svg, (g, pressClientY)=>{
        const rect = g.querySelector('rect');
        const svgEl = holder.querySelector('svg');
        const top = parseFloat(rect.getAttribute('y'));
        const bottom = top + parseFloat(rect.getAttribute('height'));
        const clampY = (y)=> Math.max(top + 14, Math.min(bottom - 14, y));
        const pressY = clampY(svgClientY(svgEl, pressClientY));
        return {
          startY: pressY,
          clampY,
          snapRadius: 40,
          distance: (pt, x, y)=> Math.abs(pt.x - x), // lifelines: 1D snap by x only
          // every lifeline's "point" tracks the current (clamped) mouse y,
          // since a lifeline isn't a single fixed coordinate like a step box
          getPoints: (mx, my)=> lastOrder.map(p=>({id:p.name, x:p.x, y: my!==undefined ? my : pressY})),
          onDrop: (from, to, clientX, clientY, range)=>{
            const svgY = range ? (range.startY + range.lastY) / 2 : pressY;
            showArrowTypePicker(from, to, svgY, clientX, clientY);
          }
        };
      });

      // hover the "+" along a lifeline so it tracks the mouse before a drag starts
      svg.querySelectorAll('.link-handle').forEach(g=>{
        const rect = g.querySelector('rect');
        const circle = g.querySelector('circle.link-add-btn');
        const label = g.querySelector('text.link-add-btn');
        const top = parseFloat(rect.getAttribute('y'));
        const bottom = top + parseFloat(rect.getAttribute('height'));
        g.addEventListener('mousemove', (e)=>{
          if(linkState) return;
          const svgEl = holder.querySelector('svg');
          const y = Math.max(top + 14, Math.min(bottom - 14, svgClientY(svgEl, e.clientY)));
          circle.setAttribute('cy', y);
          label.setAttribute('y', y + 4);
        });
      });

      const bg = svg.querySelector('.diagram-bg');
      if(bg){
        bg.addEventListener('mousedown', onSelectStart);
        bg.addEventListener('touchstart', onSelectStart, {passive:false});
      }
    }

    return {
      id: 'sequence',
      label: 'Sequence',
      mark: 'SEQ',
      sample: SAMPLE,
      emptyMessage: EMPTY_MESSAGE,
      emptyLabel: 'participant',
      exportBaseName: 'sequence-diagram',
      // Small (~100x56) inline SVG shown as this type's card in the "New
      // diagram" modal -- purely decorative, doesn't need to match the real
      // renderer's output.
      thumbnail: `<svg width="100" height="56" viewBox="0 0 100 56" fill="none">
          <rect x="8" y="4" width="28" height="14" rx="3" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.4"/>
          <rect x="64" y="4" width="28" height="14" rx="3" fill="#EAF1FE" stroke="#2F6FED" stroke-width="1.4"/>
          <line x1="22" y1="18" x2="22" y2="50" stroke="#D6DAE1" stroke-width="1.3" stroke-dasharray="3,3"/>
          <line x1="78" y1="18" x2="78" y2="50" stroke="#D6DAE1" stroke-width="1.3" stroke-dasharray="3,3"/>
          <line x1="22" y1="27" x2="74" y2="27" stroke="#2F6FED" stroke-width="1.5"/>
          <path d="M74,27 L68,23.5 M74,27 L68,30.5" stroke="#2F6FED" stroke-width="1.5" fill="none"/>
          <line x1="78" y1="39" x2="26" y2="39" stroke="#2F6FED" stroke-width="1.5" stroke-dasharray="4,3"/>
          <path d="M26,39 L32,35.5 M26,39 L32,42.5" stroke="#2F6FED" stroke-width="1.5" fill="none"/>
        </svg>`,
      // Shown in the right-hand properties panel when nothing on the
      // canvas is selected -- tells the user what they can click.
      selectionHint: 'Click a participant on the canvas to edit its text or color.',
      spacing: {label:'Node spacing', min:90, max:360, step:10, default:150},
      toggle: {label:'Bottom boxes', default:true},
      snippets: [
        {key:'participant', label:'+ participant', text:'participant Name\n'},
        {key:'message', label:'+ message', text:'A->B: message\n'},
        {key:'async', label:'+ async', text:'A->>B: async message\n'},
        {key:'note', label:'+ note', text:'note over A: a short note\n'},
        {key:'loop', label:'+ loop', text:'loop condition\n  A->B: repeated message\nend\n'},
        {key:'alt', label:'+ alt/else', text:'alt condition met\n  A->B: happy path\nelse condition failed\n  A->B: fallback\nend\n'},
        {key:'activate', label:'+ activate', text:'activate A\nA->B: doing work\ndeactivate A\n'},
        {key:'autonumber', label:'+ autonumber', text:'autonumber\n'}
      ],
      helpHTML: `
        <div><b>title</b> text &nbsp;— add <b>&lt;br/&gt;</b> for a smaller byline underneath, e.g. author/date</div>
        <div><b>participant</b> Name [as Label]</div>
        <div><b>A-&gt;B:</b> text &nbsp;<b>A--&gt;B:</b> text &nbsp;<b>A-&gt;&gt;B:</b> async &nbsp;<b>A--&gt;&gt;B:</b> async reply</div>
        <div><b>note over/left of/right of</b> A[,B]: text</div>
        <div><b>activate</b> A &nbsp;<b>deactivate</b> A</div>
        <div><b>loop / alt / opt / par</b> label ... <b>else</b> ... <b>end</b></div>
        <div><b>autonumber</b> [on|off] &nbsp;— numbers arrows in a red circle from that point on</div>
        <div>Drag any participant box left/right on the canvas to reposition it — use <b>Reset layout</b> to undo.</div>
        <div>Hover the top row between (or beside) boxes and click the red <b>+</b> to insert a new participant there.</div>
        <div>Hover a participant box and click the red <b>×</b> in its corner to remove it — its arrows, notes, and activations go with it.</div>
        <div>Hover a lifeline, press the blue <b>+</b> and drag — it snaps to the nearest lifeline. Release and pick the arrow type; it's added right away with a default message.</div>
        <div>Double-click any arrow's message text to edit it right there on the diagram — Enter to save, Esc to cancel.</div>
        <div>Double-click a participant box to rename it in place — Enter to save, Esc to cancel.</div>
        <div>Drag over an empty area of the canvas to select it, then choose Loop, Alt/Else, Opt, Par, or Note — the frame stays exactly as wide as you drew it.</div>
        <div>Double-click a note or a loop/alt/opt/par tab to edit its text the same way.</div>
        <div>Hover a note or a block frame and click the red <b>×</b> in its corner to remove it — a removed block keeps the messages inside, just un-wrapped.</div>`,
      parseAndLayout,
      insertPrimaryAt: insertParticipantAt,
      attach,
      // ---- uniform hooks the right-hand properties panel uses ----
      getNodeLabel: (id)=>{ const p = lastOrder.find(x=>x.name===id); return p ? p.label : undefined; },
      renameNode: renameParticipant
    };
  })();

  registerEngine(SequenceEngine);
