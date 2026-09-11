  // ================================================================
  // FILE: js/core/persistence.js
  // WHAT: The saved-diagrams folder tree (localStorage-backed) plus the
  //       content/style split every file is stored with: `content` is the
  //       plain DSL text, `style` is presentation-only (dragged positions,
  //       spacing, the secondary toggle, accent color, per-shape color
  //       overrides) and never affects the DSL's meaning. One shared tree
  //       across every engine -- a file's own `type` field says which
  //       engine owns it; loading a file activates that engine via
  //       activateEngine() (render.js) before applying its content/style.
  //       Falls back to defaultEngineId() (state.js), never a hardcoded
  //       engine id, if a file's `type` is missing/unrecognized.
  // DEPENDS ON: state.js (ENGINES/defaultEngineId/currentType/currentEngine/
  //       customLayout/customColors/accentColor/spacingEl/toggle2El/
  //       selectedElement), render.js (activateEngine/render/doRender),
  //       history.js (resetHistory), new-diagram-modal.js (nothing calls
  //       INTO this file from there except through the createNewFile hook
  //       this file sets).
  // USED BY: sets the shared `createNewFile`, `autoSaveCurrentFile`, and
  //       `closeSideMenu` hooks (all declared in state.js) that the rest
  //       of the app calls; also runs the app's initial bootstrap (restore
  //       last-opened file, or fall back to the sample) at the very
  //       bottom of this file -- which is why this is the LAST <script>
  //       tag in index.html: everything it calls must already exist.
  // ================================================================
  // ---------------- saved drawings (folders + files, persisted to localStorage) ----------------
  // A single shared tree across every diagram type. Each file remembers its
  // own `type` (which engine parses/renders it); loading a file switches the
  // active engine to match, and creating a new file stamps it with whichever
  // type is current at that moment.
  (function(){
    const STORAGE_KEY = 'draw-app-drawings-v1';
    const treeEl = document.getElementById('drawings-tree');
    const newFolderBtn = document.getElementById('dr-new-folder');
    const currentFileBar = document.getElementById('current-file-bar');
    const currentFileName = document.getElementById('current-file-name');

    let storageAvailable = true;
    let expanded = new Set();
    let pendingNew = null;
    let renamingId = null;

    function loadStore(){
      try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw) return {folders:{}, files:{}, lastOpenedId: null};
        const parsed = JSON.parse(raw);
        return {folders: parsed.folders || {}, files: parsed.files || {}, lastOpenedId: parsed.lastOpenedId || null};
      }catch(e){
        storageAvailable = false;
        return {folders:{}, files:{}, lastOpenedId: null};
      }
    }
    function saveStore(store){
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        storageAvailable = true;
      }catch(e){
        storageAvailable = false;
        alert('Could not save to local storage — it may be full, disabled, or unavailable in this browser context.');
      }
    }

    let store = loadStore();

    function setCurrentFile(id){
      currentFileId = id;
      store.lastOpenedId = id;
      saveStore(store);
    }
    function genId(){
      return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    }
    function escT(s){
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function icon(name){
      if(name === 'chevron') return '<svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M3 1.5L7.5 5L3 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      if(name === 'folder') return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4.2c0-.66.54-1.2 1.2-1.2h3.2l1.4 1.6h5c.66 0 1.2.54 1.2 1.2v6.2c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2V4.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      if(name === 'file') return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1.8h5l3 3v8.4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 1.8V4.8H12" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      if(name === 'addfile') return '<svg width="19" height="19" viewBox="0 0 16 16" fill="none"><path d="M4 1.8h5l3 3v8.4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 8.5H9.5M8 7V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      if(name === 'addfolder') return '<svg width="19" height="19" viewBox="0 0 16 16" fill="none"><path d="M2 4.2c0-.66.54-1.2 1.2-1.2h3.2l1.4 1.6h5c.66 0 1.2.54 1.2 1.2v6.2c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2V4.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 7.6H10M8 5.6V9.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      if(name === 'rename') return '<svg width="19" height="19" viewBox="0 0 16 16" fill="none"><path d="M11 2.2l2.8 2.8L5.4 13.4l-3.4.6.6-3.4L11 2.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      if(name === 'delete') return '<svg width="19" height="19" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return '';
    }

    function childFolders(parentId){
      return Object.values(store.folders).filter(f=>f.parentId===parentId).sort((a,b)=>a.name.localeCompare(b.name));
    }
    function childFiles(parentId){
      return Object.values(store.files).filter(f=>f.parentId===parentId).sort((a,b)=>a.name.localeCompare(b.name));
    }

    function ensureDefaultFolder(){
      if(!storageAvailable) return;
      if(Object.keys(store.folders).length > 0) return;
      const id = genId();
      store.folders[id] = {id, name: 'My diagrams', parentId: null};
      expanded.add(id);
      saveStore(store);
    }

    function renderTree(){
      ensureDefaultFolder();
      treeEl.innerHTML = '';
      const rootFolders = childFolders(null);
      const rootFiles = childFiles(null);
      const creatingAtRoot = pendingNew && pendingNew.parentId === null;
      if(rootFolders.length === 0 && rootFiles.length === 0 && !creatingAtRoot){
        const empty = document.createElement('div');
        empty.className = 'drawings-empty';
        empty.textContent = storageAvailable
          ? 'Nothing saved yet — use the "New folder" button above to organize, then add a file inside.'
          : 'Local storage is unavailable in this context, so saved diagrams will not persist. Open the downloaded file directly in a browser to enable saving.';
        treeEl.appendChild(empty);
        return;
      }
      renderLevel(null, treeEl, 0);
    }

    function renderLevel(parentId, container, depth){
      if(pendingNew && pendingNew.parentId === parentId){
        container.appendChild(buildNewRow(depth));
      }
      childFolders(parentId).forEach(folder=> container.appendChild(buildFolderRow(folder, depth)));
      childFiles(parentId).forEach(file=> container.appendChild(buildFileRow(file, depth)));
    }

    function wireInlineInput(input, {onCommit, onCancel}){
      let settled = false;
      const commit = ()=>{ if(settled) return; settled = true; onCommit(input.value); };
      const cancel = ()=>{ if(settled) return; settled = true; onCancel(); };
      input.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter'){ e.preventDefault(); commit(); }
        else if(e.key === 'Escape'){ e.preventDefault(); cancel(); }
      });
      input.addEventListener('click', (e)=> e.stopPropagation());
      input.addEventListener('blur', ()=>{ input.value.trim() ? commit() : cancel(); });
      queueMicrotask(()=>{ input.focus(); input.select(); });
    }

    // New diagrams are created through the "New diagram" modal (type +
    // sample/blank picker) rather than this inline row -- only folders still
    // use the plain inline-rename-style row.
    function buildNewRow(depth){
      const row = document.createElement('div');
      row.className = 'tree-row tree-new';
      row.style.paddingLeft = (8 + depth*16) + 'px';
      row.innerHTML = `
        <span class="tree-spacer"></span>
        <span class="tree-icon">${icon('folder')}</span>
        <input type="text" class="tree-new-input" placeholder="Folder name">`;
      wireInlineInput(row.querySelector('input'), {
        onCommit: (val)=> finishCreateFolder(val),
        onCancel: cancelCreate
      });
      return row;
    }

    function startCreateFolder(parentId){
      renamingId = null;
      pendingNew = {parentId: parentId || null};
      if(parentId) expanded.add(parentId);
      renderTree();
    }

    function finishCreateFolder(rawName){
      if(!pendingNew) return;
      const {parentId} = pendingNew;
      const name = rawName.trim() || 'New folder';
      const id = genId();
      store.folders[id] = {id, name, parentId: parentId || null};
      pendingNew = null;
      saveStore(store);
      renderTree();
    }

    // Called by the "New diagram" modal once the user picks a name, type,
    // and sample-or-blank starting point.
    createNewFile = function(parentId, name, type, useSample){
      const finalType = ENGINES[type] ? type : defaultEngineId();
      const engine = ENGINES[finalType];
      const id = genId();
      const content = useSample ? engine.sample : '';
      store.files[id] = {id, name, parentId: parentId || null, type: finalType, content, updatedAt: Date.now()};
      if(parentId) expanded.add(parentId);
      activateEngine(finalType);
      setCurrentFile(id);
      dslEl.value = content;
      customLayout = {};
      accentColor = 'blue';
      customColors = {};
      selectedElement = null;
      resetHistory();
      render();
      updateCurrentFileBar();
      saveStore(store);
      renderTree();
    };

    function cancelCreate(){
      pendingNew = null;
      renderTree();
    }

    function typeTag(file){
      const eng = ENGINES[file.type];
      return eng ? `<span class="tree-type-tag">${eng.mark}</span>` : '';
    }

    function buildFolderRow(folder, depth){
      const wrap = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'tree-row tree-folder';
      row.style.paddingLeft = (8 + depth*16) + 'px';
      const isOpen = expanded.has(folder.id);
      const isRenaming = renamingId === folder.id;

      if(isRenaming){
        row.innerHTML = `
          <span class="tree-toggle${isOpen?' expanded':''}">${icon('chevron')}</span>
          <span class="tree-icon">${icon('folder')}</span>
          <input type="text" class="tree-new-input" value="${escT(folder.name)}">`;
        wireInlineInput(row.querySelector('input'), {
          onCommit: (val)=> commitRenameFolder(folder.id, val),
          onCancel: cancelRename
        });
      } else {
        row.innerHTML = `
          <span class="tree-toggle${isOpen?' expanded':''}">${icon('chevron')}</span>
          <span class="tree-icon">${icon('folder')}</span>
          <span class="tree-label">${escT(folder.name)}</span>
          <span class="tree-actions">
            <button class="tree-action-btn" data-action="add-file" title="New file">${icon('addfile')}</button>
            <button class="tree-action-btn" data-action="add-folder" title="New subfolder">${icon('addfolder')}</button>
            <button class="tree-action-btn" data-action="rename" title="Rename">${icon('rename')}</button>
            <button class="tree-action-btn danger" data-action="delete" title="Delete folder">${icon('delete')}</button>
          </span>`;

        row.addEventListener('click', (e)=>{
          if(e.target.closest('[data-action]')) return;
          if(expanded.has(folder.id)) expanded.delete(folder.id); else expanded.add(folder.id);
          renderTree();
        });
        row.querySelector('[data-action="add-file"]').addEventListener('click', (e)=>{ e.stopPropagation(); if(openNewDiagramModal) openNewDiagramModal(folder.id); });
        row.querySelector('[data-action="add-folder"]').addEventListener('click', (e)=>{ e.stopPropagation(); startCreateFolder(folder.id); });
        row.querySelector('[data-action="rename"]').addEventListener('click', (e)=>{ e.stopPropagation(); startRenameFolder(folder.id); });
        row.querySelector('[data-action="delete"]').addEventListener('click', (e)=>{ e.stopPropagation(); deleteFolder(folder.id); });
      }

      wrap.appendChild(row);
      if(isOpen){
        const childrenContainer = document.createElement('div');
        renderLevel(folder.id, childrenContainer, depth+1);
        wrap.appendChild(childrenContainer);
      }
      return wrap;
    }

    function buildFileRow(file, depth){
      const row = document.createElement('div');
      row.className = 'tree-row tree-file' + (file.id === currentFileId ? ' active' : '');
      row.style.paddingLeft = (8 + depth*16) + 'px';
      const isRenaming = renamingId === file.id;

      if(isRenaming){
        row.innerHTML = `
          <span class="tree-spacer"></span>
          <span class="tree-icon">${icon('file')}</span>
          <input type="text" class="tree-new-input" value="${escT(file.name)}">`;
        wireInlineInput(row.querySelector('input'), {
          onCommit: (val)=> commitRenameFile(file.id, val),
          onCancel: cancelRename
        });
      } else {
        row.innerHTML = `
          <span class="tree-spacer"></span>
          <span class="tree-icon">${icon('file')}</span>
          <span class="tree-label">${escT(file.name)}</span>
          ${typeTag(file)}
          <span class="tree-actions">
            <button class="tree-action-btn" data-action="rename" title="Rename">${icon('rename')}</button>
            <button class="tree-action-btn danger" data-action="delete" title="Delete">${icon('delete')}</button>
          </span>`;
        row.addEventListener('click', (e)=>{
          if(e.target.closest('[data-action]')) return;
          loadFile(file.id);
        });
        row.querySelector('[data-action="rename"]').addEventListener('click', (e)=>{ e.stopPropagation(); startRenameFile(file.id); });
        row.querySelector('[data-action="delete"]').addEventListener('click', (e)=>{ e.stopPropagation(); deleteFile(file.id); });
      }
      return row;
    }

    function startRenameFolder(id){ pendingNew = null; renamingId = id; renderTree(); }
    function startRenameFile(id){ pendingNew = null; renamingId = id; renderTree(); }

    function commitRenameFolder(id, rawName){
      const folder = store.folders[id];
      renamingId = null;
      const name = rawName.trim();
      if(folder && name && name !== folder.name){ folder.name = name; saveStore(store); }
      renderTree();
    }
    function commitRenameFile(id, rawName){
      const file = store.files[id];
      renamingId = null;
      const name = rawName.trim();
      if(file && name && name !== file.name){
        file.name = name;
        saveStore(store);
        if(id === currentFileId) updateCurrentFileBar();
      }
      renderTree();
    }
    function cancelRename(){ renamingId = null; renderTree(); }

    function deleteFolder(id){
      const folder = store.folders[id];
      if(!folder) return;
      if(!confirm(`Delete folder "${folder.name}" and everything inside it? This can't be undone.`)) return;
      let clearedCurrent = false;
      function removeRecursive(fid){
        childFiles(fid).forEach(f=>{
          delete store.files[f.id];
          if(f.id === currentFileId){ setCurrentFile(null); clearedCurrent = true; }
        });
        childFolders(fid).forEach(sub=> removeRecursive(sub.id));
        delete store.folders[fid];
      }
      removeRecursive(id);
      saveStore(store);
      if(clearedCurrent){
        dslEl.value = '';
        customLayout = {};
        resetHistory();
        render();
        updateCurrentFileBar();
      }
      renderTree();
    }

    function deleteFile(id){
      const file = store.files[id];
      if(!file) return;
      if(!confirm(`Delete "${file.name}"? This can't be undone.`)) return;
      delete store.files[id];
      if(id === currentFileId){
        setCurrentFile(null);
        dslEl.value = '';
        customLayout = {};
        resetHistory();
        render();
        updateCurrentFileBar();
      }
      saveStore(store);
      renderTree();
    }

    // Each saved diagram keeps two logically separate pieces of data:
    //  - file.content -- the plain DSL script, exactly what you'd copy/export
    //  - file.style   -- everything about how it's drawn (dragged positions,
    //                    spacing, the secondary toggle) but not part of the
    //                    diagram's meaning
    // applyStyleConfig restores the latter; call it after activateEngine()
    // (which resets spacing/toggle to that engine's defaults) so a file's
    // saved style, if any, properly overrides those defaults.
    function applyStyleConfig(file){
      const style = file.style;
      if(style && style.layout){
        customLayout = {...style.layout};
      } else if(file.layout){
        // legacy files saved before content/style were split apart
        try{ customLayout = JSON.parse(file.layout); }catch(e){ customLayout = {}; }
      } else {
        customLayout = {};
      }
      if(style && typeof style.spacing === 'number'){
        spacingEl.value = style.spacing;
        spacingVal.textContent = style.spacing + 'px';
      }
      if(style && typeof style.secondary === 'boolean'){
        toggle2El.checked = style.secondary;
      }
      accentColor = (style && PALETTE[style.accent]) ? style.accent : 'blue';
      customColors = (style && style.colors) ? {...style.colors} : {};
      selectedElement = null;
    }

    function loadFile(id){
      const file = store.files[id];
      if(!file) return;
      activateEngine(file.type && ENGINES[file.type] ? file.type : defaultEngineId());
      dslEl.value = file.content;
      applyStyleConfig(file);
      resetHistory();
      setCurrentFile(id);
      updateCurrentFileBar();
      render();
      renderTree();
      if(closeSideMenu) closeSideMenu();
    }

    function updateCurrentFileBar(){
      const file = currentFileId ? store.files[currentFileId] : null;
      if(file){
        currentFileBar.style.display = 'flex';
        currentFileName.textContent = file.name;
      } else {
        currentFileBar.style.display = 'none';
      }
    }

    newFolderBtn.addEventListener('click', ()=> startCreateFolder(null));

    autoSaveCurrentFile = function(){
      if(!currentFileId || !store.files[currentFileId]) return;
      const file = store.files[currentFileId];
      const style = {
        layout: {...customLayout},
        spacing: parseInt(spacingEl.value, 10),
        secondary: toggle2El.checked,
        accent: accentColor,
        colors: {...customColors}
      };
      const styleJson = JSON.stringify(style);
      const prevStyleJson = JSON.stringify(file.style || null);
      if(file.content === dslEl.value && prevStyleJson === styleJson && file.type === currentType) return;
      const typeChanged = file.type !== currentType;
      file.content = dslEl.value; // the standard DSL text
      file.style = style;         // layout/spacing/toggle config, kept apart from content
      delete file.layout;         // migrate off the old combined-string field
      file.type = currentType;
      file.updatedAt = Date.now();
      saveStore(store);
      // content/style changes don't need a tree redraw, but the type tag
      // shown in the row does -- refresh it if the tree happens to be open
      if(typeChanged) renderTree();
    };

    if(store.lastOpenedId && store.files[store.lastOpenedId]){
      restoredLastFile = true;
      loadFile(store.lastOpenedId);
    } else {
      renderTree();
      updateCurrentFileBar();
    }
  })();

  // init — the saved-drawings module (above) restores the last-opened file
  // from localStorage if one exists; only fall back to the sample otherwise.
  if(!restoredLastFile){
    dslEl.value = currentEngine.sample;
    resetHistory();
    render();
  }
