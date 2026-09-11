  // ================================================================
  // FILE: js/core/properties-panel.js
  // WHAT: The right-hand rail + slide-out panel. Reads/writes ONLY the
  //       optional half of the engine contract (getNodeLabel/renameNode/
  //       getNodeKind/setNodeShape/getLaneLabel/renameLane/selectionHint,
  //       all documented in state.js) plus the shared PALETTE-based
  //       theming (accentColor/customColors) -- it never assumes any
  //       specific engine exists, and simply omits a control (e.g. the
  //       shape toggle) when the current engine doesn't provide the
  //       matching hook.
  // DEPENDS ON: state.js (selectedElement/currentEngine/accentColor/
  //       customColors/PALETTE/PALETTE_ORDER), render.js (doRender).
  // USED BY: interactions.js calls the shared `selectElement` hook (set
  //       here) whenever a [data-node]/[data-lane]/.diagram-bg is
  //       clicked; render.js calls `refreshPropertiesPanel` (also set
  //       here) at the end of every doRender().
  // ================================================================
  // ---------------- right-hand properties panel ----------------
  // Shows either the diagram's overall color, or -- once something with a
  // stable id (a participant/lane/step/decision) is clicked -- that item's
  // text/color/shape. Colors and shapes are drawn only from the curated
  // PALETTE and (for shape) the DSL's own step/decision vocabulary, so this
  // can't produce an inconsistent look or an invalid diagram; "end" nodes
  // keep their fixed semantic red and aren't recolorable or reshapeable.
  (function(){
    const rail = document.getElementById('rail-style-btn');
    const panel = document.getElementById('side-panel-right');
    const titleEl = document.getElementById('panel-right-title');
    const body = document.getElementById('panel-right-body');
    const closeBtn = document.getElementById('panel-right-close');
    const STORAGE_KEY = 'draw-app-right-panel-open';
    if(!rail || !panel) return;

    function openPanel(){
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      rail.classList.add('active');
      rail.setAttribute('aria-expanded', 'true');
      try{ localStorage.setItem(STORAGE_KEY, '1'); }catch(e){}
    }
    function closePanel(){
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      rail.classList.remove('active');
      rail.setAttribute('aria-expanded', 'false');
      try{ localStorage.setItem(STORAGE_KEY, ''); }catch(e){}
    }
    rail.addEventListener('click', ()=>{
      if(panel.classList.contains('open')) closePanel(); else openPanel();
    });
    closeBtn.addEventListener('click', closePanel);

    function buildSwatchGroup(container, selectedKey, includeAuto, onPick){
      container.innerHTML = '';
      if(includeAuto){
        const auto = document.createElement('button');
        auto.type = 'button';
        auto.className = 'swatch-auto' + (!selectedKey ? ' selected' : '');
        auto.textContent = 'A';
        auto.title = 'Use the diagram default color';
        auto.addEventListener('click', ()=> onPick(null));
        container.appendChild(auto);
      }
      PALETTE_ORDER.forEach(key=>{
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch' + (selectedKey === key ? ' selected' : '');
        btn.style.background = PALETTE[key].hex;
        btn.title = PALETTE[key].label;
        btn.addEventListener('click', ()=> onPick(key));
        container.appendChild(btn);
      });
    }

    // Looks up the current label/kind/colorability of whatever's selected,
    // straight from the active engine -- returns null if it no longer exists
    // (removed, or a stale selection left over from a different file).
    function getSelectedElementInfo(){
      if(!selectedElement) return null;
      const {kind, id} = selectedElement;
      if(kind === 'lane'){
        if(!currentEngine.getLaneLabel) return null;
        const label = currentEngine.getLaneLabel(id);
        if(label === undefined) return null;
        return {kind:'lane', id, label, kindLabel:'Lane', colorable:true, shapeOptions:null, currentShape:null};
      }
      if(kind === 'node'){
        if(!currentEngine.getNodeLabel) return null;
        const label = currentEngine.getNodeLabel(id);
        if(label === undefined) return null;
        let kindLabel = 'Participant', shapeOptions = null, currentShape = null, colorable = true;
        if(currentEngine.getNodeKind){
          currentShape = currentEngine.getNodeKind(id);
          kindLabel = currentShape ? currentShape.charAt(0).toUpperCase() + currentShape.slice(1) : 'Step';
          if(currentShape === 'step' || currentShape === 'decision') shapeOptions = ['step','decision'];
          if(currentShape === 'end') colorable = false; // fixed semantic red, not themeable
        }
        return {kind:'node', id, label, kindLabel, colorable, shapeOptions, currentShape};
      }
      return null;
    }

    function renderPropertiesPanel(){
      const info = getSelectedElementInfo();
      if(selectedElement && !info) selectedElement = null;

      if(!selectedElement){
        titleEl.textContent = 'Diagram style';
        // Each engine supplies its own selectionHint (see js/engines/*.js)
        // so this stays generic across every registered drawing style.
        const hint = currentEngine.selectionHint || 'Click a shape on the canvas to edit it.';
        body.innerHTML = `
          <div class="prop-section">
            <div class="prop-label">Diagram color</div>
            <div class="swatch-group" id="accent-swatch-group"></div>
          </div>
          <div class="prop-empty-hint">${esc(hint)}</div>`;
        buildSwatchGroup(document.getElementById('accent-swatch-group'), accentColor, false, (key)=>{
          accentColor = key;
          doRender();
        });
        return;
      }

      titleEl.textContent = info.kindLabel;
      body.innerHTML = `
        <div class="prop-section">
          <button class="prop-deselect" id="prop-deselect-btn">&lsaquo; Diagram style</button>
        </div>
        <div class="prop-section">
          <span class="prop-kind-badge">${esc(info.kindLabel)}</span>
          <div class="prop-name">${esc(info.id)}</div>
          <div class="prop-label">Text</div>
          <input type="text" class="prop-input" id="prop-text-input" value="${esc(info.label)}">
          ${info.shapeOptions ? `
          <div class="prop-label">Shape</div>
          <div class="shape-toggle" id="prop-shape-toggle">
            <button type="button" data-shape="step" class="${info.currentShape==='step'?'active':''}">Step</button>
            <button type="button" data-shape="decision" class="${info.currentShape==='decision'?'active':''}">Decision</button>
          </div>` : ''}
          ${info.colorable ? `
          <div class="prop-label">Color</div>
          <div class="swatch-group" id="element-swatch-group"></div>` : `
          <div class="prop-label">Color</div>
          <div class="prop-empty-hint" style="padding:0;">Fixed — an end marker always stays this color.</div>`}
        </div>`;

      document.getElementById('prop-deselect-btn').addEventListener('click', ()=>{
        if(selectElement) selectElement(null);
      });

      const textInput = document.getElementById('prop-text-input');
      function applyText(){
        const val = textInput.value.trim();
        if(!val || val === info.label) return;
        if(info.kind === 'lane') currentEngine.renameLane(info.id, val);
        else currentEngine.renameNode(info.id, val);
      }
      textInput.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter'){ e.preventDefault(); applyText(); textInput.blur(); }
        if(e.key === 'Escape'){ e.preventDefault(); textInput.value = info.label; textInput.blur(); }
      });
      textInput.addEventListener('blur', applyText);

      if(info.shapeOptions){
        document.getElementById('prop-shape-toggle').addEventListener('click', (e)=>{
          const btn = e.target.closest('button[data-shape]');
          if(!btn || !currentEngine.setNodeShape) return;
          currentEngine.setNodeShape(info.id, btn.dataset.shape);
        });
      }

      if(info.colorable){
        buildSwatchGroup(document.getElementById('element-swatch-group'), customColors[info.id], true, (key)=>{
          if(key) customColors[info.id] = key; else delete customColors[info.id];
          doRender();
        });
      }
    }

    // Selecting never opens/closes the panel on its own -- toggling it as a
    // *side effect* of clicking (especially right after a drag, which also
    // fires a click) would resize the canvas while the user is still
    // interacting with it, and could shift a shape out from under a
    // double-click mid-gesture. Whether it's open is entirely the user's
    // own choice via the rail button; selecting just keeps its content live
    // once it is open.
    selectElement = function(descriptor){
      selectedElement = descriptor;
      renderPropertiesPanel();
    };
    refreshPropertiesPanel = renderPropertiesPanel;

    let openFlag = false;
    try{ openFlag = !!localStorage.getItem(STORAGE_KEY); }catch(e){}
    if(openFlag) openPanel();

    renderPropertiesPanel();
  })();

