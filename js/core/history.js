  // ================================================================
  // FILE: js/core/history.js
  // WHAT: Undo/redo. Entirely engine-agnostic -- it snapshots
  //       {content, layout, type} as opaque values (the DSL text +
  //       customLayout + which engine was active), never anything
  //       engine-specific, so no engine needs to know this exists.
  // DEPENDS ON: state.js (dslEl, customLayout, currentType), render.js
  //       (doRender, activateEngine -- called on undo/redo to restore a
  //       snapshot that used a different engine).
  // USED BY: render.js (scheduleHistoryCommit, called at the end of every
  //       doRender()), chrome.js (the undo/redo buttons).
  // ================================================================
  // ---------------- Undo / redo history ----------------
  // Tracks {content, layout, type} snapshots so Ctrl/Cmd+Z and the undo/redo
  // buttons work across every way the diagram can change -- typing, dragging,
  // any click-to-add/remove action, or even a type switch -- for whichever
  // engine is current at the time.

  let history = [];
  let historyIndex = -1;
  let historyCommitTimer = null;
  let applyingHistory = false;

  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');

  function snapshotState(){
    return {content: dslEl.value, layout: JSON.stringify(customLayout), type: currentType};
  }
  function statesEqual(a, b){
    return !!a && !!b && a.content === b.content && a.layout === b.layout && a.type === b.type;
  }
  function updateHistoryButtons(){
    if(undoBtn) undoBtn.disabled = historyIndex <= 0;
    if(redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
  }
  function commitHistory(){
    if(applyingHistory) return;
    const snap = snapshotState();
    if(statesEqual(history[historyIndex], snap)) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snap);
    if(history.length > 100) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }
  function scheduleHistoryCommit(){
    if(applyingHistory) return;
    clearTimeout(historyCommitTimer);
    historyCommitTimer = setTimeout(commitHistory, 400);
  }
  function resetHistory(){
    clearTimeout(historyCommitTimer);
    history = [snapshotState()];
    historyIndex = 0;
    updateHistoryButtons();
  }
  function applyState(snap){
    applyingHistory = true;
    clearTimeout(historyCommitTimer);
    if(snap.type !== currentType) activateEngine(snap.type);
    dslEl.value = snap.content;
    try{ customLayout = snap.layout ? JSON.parse(snap.layout) : {}; }catch(e){ customLayout = {}; }
    doRender();
    applyingHistory = false;
    updateHistoryButtons();
  }
  function undo(){
    clearTimeout(historyCommitTimer);
    commitHistory();
    if(historyIndex <= 0) return;
    historyIndex--;
    applyState(history[historyIndex]);
  }
  function redo(){
    if(historyIndex >= history.length - 1) return;
    historyIndex++;
    applyState(history[historyIndex]);
  }
  if(undoBtn) undoBtn.addEventListener('click', undo);
  if(redoBtn) redoBtn.addEventListener('click', redo);

  document.addEventListener('keydown', (e)=>{
    const mod = e.metaKey || e.ctrlKey;
    if(!mod) return;
    const key = e.key.toLowerCase();
    if(key === 'z' && e.shiftKey){ e.preventDefault(); redo(); }
    else if(key === 'z'){ e.preventDefault(); undo(); }
    else if(key === 'y'){ e.preventDefault(); redo(); }
  });

