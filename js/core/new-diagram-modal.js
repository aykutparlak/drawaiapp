  // ================================================================
  // FILE: js/core/new-diagram-modal.js
  // WHAT: The "New diagram" modal (name + type + sample-or-blank picker).
  //       The type-card list is built at runtime from Object.values(ENGINES)
  //       -- a new engine appears here automatically, see the module note
  //       below.
  // DEPENDS ON: state.js (ENGINES, currentType), utils.js (esc).
  // USED BY: nothing calls into this file -- it exposes itself as the
  //       shared `openNewDiagramModal` hook (set at the bottom), called by
  //       persistence.js (the tree's per-folder "+" button) and chrome.js
  //       (the Menu panel's "New diagram" item). Calls `createNewFile`
  //       (set by persistence.js) to actually do the work.
  // ================================================================
  // ---------------- "New diagram" modal ----------------
  // Lets the user name the new diagram, pick its type (with a small preview
  // of what each type looks like), and choose whether to start from that
  // type's sample or a blank script. The actual file creation is delegated
  // to createNewFile, set by the saved-drawings module below.
  //
  // MODULARITY NOTE: the type-card list is built from the ENGINES registry
  // (populated by each js/engines/*.js file calling registerEngine() --
  // see js/core/state.js) rather than hardcoded per type. A new engine
  // shows up here automatically as long as it sets `thumbnail` (a small
  // inline SVG string, ~100x56) and `label` on the object it registers --
  // nothing in this file, or index.html, needs to change to add one.
  (function(){
    const overlay = document.getElementById('new-diagram-modal');
    const nameInput = document.getElementById('ndm-name');
    const typeGroup = document.getElementById('ndm-type-group');
    const contentGroup = document.getElementById('ndm-content-group');
    const createBtn = document.getElementById('ndm-create');
    const cancelBtn = document.getElementById('ndm-cancel');
    const closeBtn = document.getElementById('ndm-close');
    if(!overlay) return;

    let pendingParentId = null;
    let selectedType = null;
    let selectedContent = 'sample';

    // Rebuilt from ENGINES every time the modal opens (cheap, and safe if
    // engines were ever registered after this module's own initial load).
    function buildTypeCards(){
      typeGroup.innerHTML = '';
      Object.values(ENGINES).forEach(engine=>{
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'type-card';
        btn.dataset.type = engine.id;
        btn.innerHTML = `${engine.thumbnail || ''}<span>${esc(engine.label)}</span>`;
        typeGroup.appendChild(btn);
      });
    }

    function updateTypeUI(){
      typeGroup.querySelectorAll('.type-card').forEach(btn=>{
        btn.classList.toggle('selected', btn.dataset.type === selectedType);
      });
    }
    function updateContentUI(){
      contentGroup.querySelectorAll('.type-tab').forEach(btn=>{
        btn.classList.toggle('active', btn.dataset.content === selectedContent);
      });
    }

    function open(parentId){
      pendingParentId = parentId || null;
      selectedType = currentType;
      selectedContent = 'sample';
      nameInput.value = '';
      buildTypeCards();
      updateTypeUI();
      updateContentUI();
      overlay.hidden = false;
      document.addEventListener('keydown', onKeydown);
      requestAnimationFrame(()=> nameInput.focus());
    }
    function close(){
      overlay.hidden = true;
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(e){
      if(e.key === 'Escape'){ e.preventDefault(); close(); }
    }
    function create(){
      const name = nameInput.value.trim() || 'Untitled diagram';
      if(createNewFile) createNewFile(pendingParentId, name, selectedType, selectedContent === 'sample');
      close();
      if(closeSideMenu) closeSideMenu();
    }

    typeGroup.addEventListener('click', (e)=>{
      const btn = e.target.closest('.type-card');
      if(!btn) return;
      selectedType = btn.dataset.type;
      updateTypeUI();
    });
    contentGroup.addEventListener('click', (e)=>{
      const btn = e.target.closest('.type-tab');
      if(!btn) return;
      selectedContent = btn.dataset.content;
      updateContentUI();
    });
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    nameInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); create(); } });
    createBtn.addEventListener('click', create);

    openNewDiagramModal = open;
  })();

