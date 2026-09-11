  // ================================================================
  // FILE: js/core/render.js
  // WHAT: The one render loop every code path (typing, dragging, undo,
  //       loading a file, switching engines, ...) ultimately funnels
  //       through -- doRender()/render() -- plus activateEngine() (swap
  //       which engine is current) and updateChromeForEngine() (repaint
  //       the topbar's snippets/spacing/toggle/help/brand to match it).
  //       doRender() is intentionally engine-agnostic: it only ever calls
  //       currentEngine.parseAndLayout(...)/currentEngine.attach(...), so
  //       adding an engine never touches this file.
  // DEPENDS ON: state.js (currentEngine/currentType/ENGINES/dslEl/holder/
  //       errbar/...), interactions.js (attachAddHandlers, for the empty-
  //       state placeholder's "+"), history.js (scheduleHistoryCommit --
  //       loaded after this file, but only called from inside doRender(),
  //       well after every script has finished loading; see state.js's
  //       "classic scripts" note for why forward references like this are
  //       safe here).
  // USED BY: effectively everything; doRender/render/activateEngine are
  //       called from every other core file and from inside every engine.
  // ================================================================

  // All engine files have loaded and self-registered by this point (this
  // script is loaded right after them) -- pick the initial one. state.js's
  // default of 'sequence' might not actually be registered (e.g. it was
  // renamed or removed), so fall back rather than assume it's there.
  if(!ENGINES[currentType]) currentType = defaultEngineId();
  currentEngine = ENGINES[currentType];

  // ---------------- render loop (delegates to currentEngine) ----------------

  function emptyStateHTML(){
    const w=260,h=150,cx=w/2,dotY=78;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="IBM Plex Sans, sans-serif">
        <text x="${cx}" y="22" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="13" font-weight="600" fill="#1F2430">Nothing here yet</text>
        <line x1="${cx}" y1="40" x2="${cx}" y2="${h-8}" stroke="#D6DAE1" stroke-width="1.2" stroke-dasharray="3,4"/>
        <g class="add-hotzone" data-insert-index="0" style="cursor:pointer;">
          <circle cx="${cx}" cy="${dotY}" r="18" fill="#D0453A"/>
          <text x="${cx}" y="${dotY+7.5}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="22" font-weight="700" fill="#FFFFFF" style="pointer-events:none;">+</text>
        </g>
      </svg>`;
    return `
      <div style="display:flex; flex-direction:column; align-items:center; gap:14px; padding-top:50px;">
        ${svg}
        <div style="font-family:'IBM Plex Mono', monospace; font-size:12px; color:#767E8C; text-align:center; max-width:300px; line-height:1.6;">
          Click the <b style="color:#D0453A;">+</b> to add your first ${esc(currentEngine.emptyLabel)}, or
          <span id="empty-state-open-script" style="color:#2F6FED; font-weight:600; cursor:pointer; text-decoration:underline;">open the script panel</span> to type directly.
        </div>
      </div>`;
  }

  function doRender(){
    if(autoSaveCurrentFile) autoSaveCurrentFile();
    try{
      const svg = currentEngine.parseAndLayout(dslEl.value, parseInt(spacingEl.value, 10), toggle2El.checked);
      holder.innerHTML = svg;
      errbar.classList.remove('show');
      errbar.textContent = '';
      currentEngine.attach(holder.querySelector('svg'));
    }catch(err){
      if(err.message === currentEngine.emptyMessage){
        holder.innerHTML = emptyStateHTML();
        errbar.classList.remove('show');
        errbar.textContent = '';
        selectedElement = null;
        attachAddHandlers(holder.querySelector('svg'), currentEngine.insertPrimaryAt);
        const openBtn = document.getElementById('empty-state-open-script');
        if(openBtn) openBtn.addEventListener('click', ()=>{
          scriptVisible = true;
          updateScriptVisibility();
          dslEl.focus();
        });
      } else {
        errbar.textContent = '⚠ ' + err.message;
        errbar.classList.add('show');
      }
    }
    if(refreshPropertiesPanel) refreshPropertiesPanel();
    scheduleHistoryCommit();
  }

  let debounceTimer = null;
  function render(){
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doRender, 120);
  }

  // ---------------- chrome: rebuild topbar/help for the active engine ----------------

  function rebuildSnippets(){
    snippetsEl.innerHTML = '';
    currentEngine.snippets.forEach(s=>{
      const btn = document.createElement('button');
      btn.className = 'tbtn';
      btn.dataset.snippet = s.key;
      btn.textContent = s.label;
      snippetsEl.appendChild(btn);
    });
  }
  snippetsEl.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tbtn');
    if(!btn) return;
    const snip = currentEngine.snippets.find(s=>s.key === btn.dataset.snippet);
    if(!snip) return;
    const el = dslEl;
    const start = el.selectionStart, end = el.selectionEnd;
    const before = el.value.slice(0,start), after = el.value.slice(end);
    const needsNewline = before.length && !before.endsWith('\n');
    const insert = (needsNewline?'\n':'') + snip.text;
    el.value = before + insert + after;
    el.focus();
    const pos = (before+insert).length;
    el.selectionStart = el.selectionEnd = pos;
    render();
  });

  function updateChromeForEngine(){
    brandMarkEl.textContent = currentEngine.mark;
    brandNameEl.textContent = currentEngine.label;
    document.title = currentEngine.label + ' — live diagram drafting';
    rebuildSnippets();
    spacingLabelEl.textContent = currentEngine.spacing.label;
    spacingEl.min = currentEngine.spacing.min;
    spacingEl.max = currentEngine.spacing.max;
    spacingEl.step = currentEngine.spacing.step;
    spacingEl.value = currentEngine.spacing.default;
    spacingVal.textContent = currentEngine.spacing.default + 'px';
    toggle2LabelEl.textContent = currentEngine.toggle.label;
    menuToggle2LabelEl.textContent = currentEngine.toggle.label;
    toggle2El.checked = currentEngine.toggle.default;
    helpEl.innerHTML = currentEngine.helpHTML;
  }

  // activateEngine: switches which engine is "current" -- the brand mark in
  // the topbar is a read-only badge showing whichever type this is; a
  // diagram's type is fixed at creation (via the "New diagram" modal) and
  // otherwise only changes by loading a file of a different type.
  function activateEngine(type){
    if(!ENGINES[type]) return;
    currentType = type;
    currentEngine = ENGINES[type];
    updateChromeForEngine();
  }

  updateChromeForEngine();

