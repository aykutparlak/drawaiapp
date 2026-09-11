  // ================================================================
  // FILE: js/core/utils.js
  // WHAT: Small, stateless helpers shared by every engine and by other
  //       core files -- text escaping, the label-fitting/wrapping used for
  //       any SVG <text>, the generic inline-text-edit popup, and the
  //       generic small dropdown/context popup menu. Nothing here knows
  //       about any specific diagram type.
  // DEPENDS ON: state.js (activeInlineEditor/activePopup, both declared
  //       there and only ever mutated from here).
  // USED BY: every js/engines/*.js file (esc/fitLabel/textBlock/
  //       removeBadgeSvg/openInlineEditor/showPopupMenu), and
  //       interactions.js (svgClientX/svgClientY).
  // ================================================================

  function esc(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  const LABEL_BASE_SIZE = 12;
  const LABEL_MIN_SIZE = 8;
  const LABEL_CHAR_RATIO = 0.62; // approx glyph width as a fraction of font-size, IBM Plex
  const BR_RE = /<br\s*\/?>/i;

  function wrapIntoTwoLines(text){
    const words = text.split(' ').filter(Boolean);
    if(words.length <= 1){
      const mid = Math.ceil(text.length/2);
      return [text.slice(0,mid), text.slice(mid)];
    }
    const total = text.length;
    let line1 = words[0], i = 1;
    while(i < words.length){
      const candidate = line1 + ' ' + words[i];
      if(candidate.length <= total/2 + 2 || line1.length === 0){
        line1 = candidate;
        i++;
      } else break;
    }
    const line2 = words.slice(i).join(' ');
    return line2 ? [line1, line2] : [line1];
  }

  // Fits a label to the available horizontal space: shrinks the font down to
  // LABEL_MIN_SIZE first, and if it still doesn't fit on one line, wraps it
  // onto a second line (shrinking further if needed). Shared verbatim by
  // both engines' shape-label and message/connector-label rendering.
  function fitLabel(text, availableWidth){
    if(!text) return {lines:[''], fontSize:LABEL_BASE_SIZE};
    const pad = 10;
    const usable = Math.max(availableWidth - pad, 20);

    if(BR_RE.test(text)){
      const hardLines = text.split(BR_RE).map(s=>s.trim());
      const maxLen = Math.max(1, ...hardLines.map(l=>l.length));
      const neededBase = maxLen * LABEL_BASE_SIZE * LABEL_CHAR_RATIO;
      let fontSize = LABEL_BASE_SIZE;
      if(neededBase > usable){
        fontSize = Math.max(LABEL_MIN_SIZE, usable / (maxLen * LABEL_CHAR_RATIO));
        fontSize = Math.round(fontSize*10)/10;
      }
      return {lines: hardLines, fontSize};
    }

    const neededAtBase = text.length * LABEL_BASE_SIZE * LABEL_CHAR_RATIO;
    if(neededAtBase <= usable) return {lines:[text], fontSize:LABEL_BASE_SIZE};

    const neededAtMin = text.length * LABEL_MIN_SIZE * LABEL_CHAR_RATIO;
    if(neededAtMin <= usable){
      const fitted = usable / (text.length * LABEL_CHAR_RATIO);
      return {lines:[text], fontSize: Math.max(LABEL_MIN_SIZE, Math.round(fitted*10)/10)};
    }

    const lines = wrapIntoTwoLines(text);
    const maxLen = Math.max(...lines.map(l=>l.length));
    const neededWrappedBase = maxLen * LABEL_BASE_SIZE * LABEL_CHAR_RATIO;
    let fontSize = LABEL_BASE_SIZE;
    if(neededWrappedBase > usable){
      fontSize = Math.max(LABEL_MIN_SIZE, usable / (maxLen * LABEL_CHAR_RATIO));
      fontSize = Math.round(fontSize*10)/10;
    }
    return {lines, fontSize};
  }

  // Centered multi-line <text> block built from fitLabel(), used for shape
  // labels (participant/lane/step boxes) by both engines.
  function textBlock(cx, cy, text, availW, opts){
    opts = opts || {};
    const fit = fitLabel(text, availW);
    const lh = fit.fontSize + 3;
    const totalTextH = (fit.lines.length-1)*lh;
    const firstY = cy - totalTextH/2 + fit.fontSize/2.8;
    return fit.lines.map((ln,idx)=>
      `<text x="${cx}" y="${firstY+idx*lh}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="${fit.fontSize}" ${opts.weight?`font-weight="${opts.weight}"`:''} fill="${opts.fill||'#1F2430'}">${esc(ln)}</text>`
    ).join('');
  }

  function removeBadgeSvg(cx, cy){
    return `<g class="inline-remove-btn">
        <circle cx="${cx}" cy="${cy}" r="8" fill="#D0453A" stroke="#FFFFFF" stroke-width="1.3"/>
        <text x="${cx}" y="${cy+3.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace"
              font-size="10.5" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">&#215;</text>
      </g>`;
  }

  function svgClientX(svg, clientX){
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = 0;
    return pt.matrixTransform(svg.getScreenCTM().inverse()).x;
  }
  function svgClientY(svg, clientY){
    const pt = svg.createSVGPoint();
    pt.x = 0; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse()).y;
  }

  // Generic "double-click to edit text right on the diagram" popup input,
  // used for every editable label across both engines (arrow/connector
  // labels, notes, block tabs, participant/lane/step names).
  function openInlineEditor({anchorRect, initialValue, textAlign, minWidth, onCommit}){
    if(activeInlineEditor) activeInlineEditor.finish(true);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'label-edit-input';
    if(textAlign) input.style.textAlign = textAlign;
    input.value = initialValue;
    document.body.appendChild(input);
    input.style.left = anchorRect.left + 'px';
    input.style.top = anchorRect.top + 'px';
    input.style.width = Math.max(minWidth||0, anchorRect.width) + 'px';
    input.style.height = anchorRect.height + 'px';
    input.focus();
    input.select();

    let done = false;
    function finish(save){
      if(done) return;
      done = true;
      const val = input.value.trim();
      input.remove();
      activeInlineEditor = null;
      if(save) onCommit(val);
    }
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); finish(true); }
      if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', ()=> finish(true));
    activeInlineEditor = {el: input, finish};
    return {finish};
  }

  // Generic small popup menu anchored at a client point -- used for the
  // arrow/connector "type" picker and the sequence block-wrap picker.
  // onClose (optional) fires exactly once, whichever way the popup ends:
  // an item chosen, an outside click, or Escape.
  let activePopupOnClose = null;

  function showPopupMenu({labelText, items, clientX, clientY, onClose}){
    closePopupMenu();
    const menu = document.createElement('div');
    menu.className = 'popup-menu';
    menu.addEventListener('click', e=> e.stopPropagation());

    if(labelText){
      const label = document.createElement('div');
      label.className = 'pm-label';
      label.textContent = labelText;
      menu.appendChild(label);
    }
    items.forEach(it=>{
      const btn = document.createElement('button');
      btn.innerHTML = it.html;
      btn.addEventListener('click', ()=>{
        closePopupMenu();
        it.onChoose();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 10;
    const maxTop = window.innerHeight - rect.height - 10;
    menu.style.left = Math.max(10, Math.min(clientX, maxLeft)) + 'px';
    menu.style.top = Math.max(10, Math.min(clientY, maxTop)) + 'px';

    activePopup = menu;
    activePopupOnClose = onClose || null;
    setTimeout(()=> document.addEventListener('click', closePopupMenu), 0);
    document.addEventListener('keydown', onPopupKeydown);
  }
  function onPopupKeydown(e){ if(e.key === 'Escape') closePopupMenu(); }
  function closePopupMenu(){
    if(activePopup){ activePopup.remove(); activePopup = null; }
    document.removeEventListener('click', closePopupMenu);
    document.removeEventListener('keydown', onPopupKeydown);
    if(activePopupOnClose){ const fn = activePopupOnClose; activePopupOnClose = null; fn(); }
  }

