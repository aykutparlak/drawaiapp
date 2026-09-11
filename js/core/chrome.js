  // ================================================================
  // FILE: js/core/chrome.js
  // WHAT: The parts of the app shell that aren't their own dedicated file:
  //       editor textarea wiring, the spacing slider/toggle checkbox
  //       inputs, the editor-pane resize handle, the Sample/Reset/Clear/
  //       Download SVG/PNG buttons and their Menu-panel mirrors, and the
  //       left rail + its two panel views (My diagrams / Menu). All
  //       engine-agnostic -- reads engine-provided labels/config off
  //       currentEngine but never anything engine-specific.
  // DEPENDS ON: state.js (dslEl/spacingEl/toggle2El/mainEl/currentEngine/
  //       customLayout/closeSideMenu/...), render.js (render/doRender).
  // USED BY: nothing calls into this file -- it's pure DOM event wiring,
  //       the leaf of the dependency graph.
  // ================================================================
  // ---------------- wiring: editor input, spacing, toggle, script pane ----------------

  dslEl.addEventListener('input', render);
  spacingEl.addEventListener('input', ()=>{
    spacingVal.textContent = spacingEl.value + 'px';
    render();
  });
  toggle2El.addEventListener('change', doRender);

  dslEl.addEventListener('keydown', (e)=>{
    if(e.key === 'Tab'){
      e.preventDefault();
      const s = dslEl.selectionStart, en = dslEl.selectionEnd;
      dslEl.value = dslEl.value.slice(0,s) + '  ' + dslEl.value.slice(en);
      dslEl.selectionStart = dslEl.selectionEnd = s+2;
      render();
    }
  });

  const scriptToggleBtn = document.getElementById('script-toggle-btn');
  function updateScriptVisibility(){
    mainEl.classList.toggle('script-hidden', !scriptVisible);
    if(scriptToggleBtn) scriptToggleBtn.classList.toggle('active', scriptVisible);
  }
  scriptToggleBtn.addEventListener('click', ()=>{
    scriptVisible = !scriptVisible;
    updateScriptVisibility();
  });
  updateScriptVisibility();

  // ---------------- Script panel resize ----------------
  (function(){
    const paneEl = document.querySelector('.editor-pane');
    const handle = document.getElementById('editor-resize-handle');
    if(!paneEl || !handle) return;

    const MIN_W = 260;
    const MAX_W = 900;
    const STORAGE_KEY = 'draw-app-editor-width';

    function applyWidth(w){
      paneEl.style.width = Math.max(MIN_W, Math.min(w, MAX_W)) + 'px';
    }
    try{
      const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      if(!isNaN(saved)) applyWidth(saved);
    }catch(e){}

    let dragging = false, startX = 0, startW = 0;
    function pointerX(e){ return e.touches ? e.touches[0].clientX : e.clientX; }
    function onMove(e){
      if(!dragging) return;
      applyWidth(startW + (pointerX(e) - startX));
      e.preventDefault();
    }
    function onUp(){
      if(!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try{ localStorage.setItem(STORAGE_KEY, parseInt(paneEl.style.width, 10)); }catch(e){}
    }
    function onDown(e){
      dragging = true;
      startX = pointerX(e);
      startW = paneEl.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    handle.addEventListener('touchstart', onDown, {passive:false});
    window.addEventListener('touchmove', onMove, {passive:false});
    window.addEventListener('touchend', onUp);
  })();

  // ---------------- Sample / reset / clear / export ----------------

  document.getElementById('btn-sample').addEventListener('click', ()=>{
    dslEl.value = currentEngine.sample;
    customLayout = {};
    customColors = {};
    selectedElement = null;
    resetHistory();
    render();
  });
  document.getElementById('btn-reset-layout').addEventListener('click', ()=>{
    customLayout = {};
    render();
  });
  document.getElementById('btn-clear').addEventListener('click', ()=>{
    dslEl.value = '';
    customLayout = {};
    customColors = {};
    selectedElement = null;
    resetHistory();
    render();
  });

  function exportSvgMarkup(svgEl){
    const clone = svgEl.cloneNode(true);
    clone.querySelectorAll('.remove-btn, .inline-remove-btn, .add-hotzone, .link-handle, .step-hitzone')
      .forEach(el => el.remove());
    return clone.outerHTML;
  }

  document.getElementById('btn-svg').addEventListener('click', ()=>{
    const svgEl = holder.querySelector('svg');
    if(!svgEl) return;
    const blob = new Blob([exportSvgMarkup(svgEl)], {type:'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = currentEngine.exportBaseName + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-png').addEventListener('click', ()=>{
    const svgEl = holder.querySelector('svg');
    if(!svgEl) return;
    const w = parseInt(svgEl.getAttribute('width'));
    const h = parseInt(svgEl.getAttribute('height'));
    const scale = 2;
    const svgData = exportSvgMarkup(svgEl);
    const img = new Image();
    const svgBlob = new Blob([svgData], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(svgBlob);
    img.onload = function(){
      const canvas = document.createElement('canvas');
      canvas.width = w*scale; canvas.height = h*scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale,scale);
      ctx.drawImage(img,0,0);
      URL.revokeObjectURL(url);
      canvas.toBlob(function(blob){
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = currentEngine.exportBaseName + '.png';
        a.click();
      });
    };
    img.src = url;
  });

  // ---------------- icon rail + swappable side panel ----------------
  (function(){
    const panel = document.getElementById('side-panel');
    const panelTitle = document.getElementById('panel-title');
    const closeBtn = document.getElementById('panel-close');
    const STORAGE_KEY = 'draw-app-active-panel';

    const panels = {
      files: { btn: document.getElementById('rail-files-btn'), view: document.getElementById('panel-files'), title: 'My diagrams' },
      menu:  { btn: document.getElementById('rail-menu-btn'),  view: document.getElementById('panel-menu'),  title: 'Menu' }
    };

    let activePanel = null;

    function showPanel(name){
      activePanel = name;
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      panelTitle.textContent = panels[name].title;
      Object.keys(panels).forEach(key=>{
        const isActive = key === name;
        panels[key].view.classList.toggle('active', isActive);
        panels[key].btn.classList.toggle('active', isActive);
        panels[key].btn.setAttribute('aria-expanded', isActive ? 'true' : 'false');
      });
      try{ localStorage.setItem(STORAGE_KEY, name); }catch(e){}
    }
    function closePanel(){
      activePanel = null;
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      Object.keys(panels).forEach(key=>{
        panels[key].btn.classList.remove('active');
        panels[key].btn.setAttribute('aria-expanded', 'false');
      });
      try{ localStorage.setItem(STORAGE_KEY, ''); }catch(e){}
    }
    function togglePanel(name){
      if(activePanel === name) closePanel(); else showPanel(name);
    }

    closeSideMenu = closePanel;

    Object.keys(panels).forEach(name=>{
      panels[name].btn.addEventListener('click', ()=> togglePanel(name));
    });
    closeBtn.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape' && activePanel) closePanel();
    });

    let saved = '';
    try{ saved = localStorage.getItem(STORAGE_KEY) || ''; }catch(e){}
    if(panels[saved]) showPanel(saved);

    document.getElementById('menu-new').addEventListener('click', ()=>{
      if(openNewDiagramModal) openNewDiagramModal(null);
    });
    document.getElementById('menu-example').addEventListener('click', ()=>{
      document.getElementById('btn-sample').click();
    });
    document.getElementById('menu-reset-layout').addEventListener('click', ()=>{
      document.getElementById('btn-reset-layout').click();
    });
    const toggle2Btn = document.getElementById('menu-toggle2');
    toggle2Btn.addEventListener('click', ()=>{
      toggle2El.checked = !toggle2El.checked;
      toggle2El.dispatchEvent(new Event('change'));
    });
    toggle2El.addEventListener('change', ()=>{
      toggle2Btn.classList.toggle('active', toggle2El.checked);
    });
    toggle2Btn.classList.toggle('active', toggle2El.checked);
    document.getElementById('menu-svg').addEventListener('click', ()=>{
      document.getElementById('btn-svg').click();
    });
    document.getElementById('menu-png').addEventListener('click', ()=>{
      document.getElementById('btn-png').click();
    });
    document.getElementById('menu-clear').addEventListener('click', ()=>{
      document.getElementById('btn-clear').click();
    });
  })();

