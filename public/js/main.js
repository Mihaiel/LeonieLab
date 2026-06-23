// Bootstraps the worksheet page: grid + logic + buttons
import { GridRenderer } from './ui/GridRenderer.js';
import { Document } from './models/Document.js';
import { PDFExporter } from './services/PDFExporter.js';
import { ApplicationLogic } from './logic/ApplicationLogic.js';
import { OperationManager } from './logic/OperationManager.js';
import { DocumentService } from './services/DocumentService.js';
import { UndoManager } from './services/UndoManager.js';
import { AudioFeedback } from './services/AudioFeedback.js';

function setupWorksheet(){
  const main = document.getElementById('main-content');
  if (!main) return;

  // create a root div for grid if missing
  let root = document.getElementById('worksheet-root');
  if (!root){
    root = document.createElement('div');
    root.id = 'worksheet-root';
    main.appendChild(root);
  }

  const doc = new Document();
  const grid = new GridRenderer(root, doc);
  grid.mount();
  const opManager = new OperationManager(doc);
  const logic = new ApplicationLogic(doc, grid, opManager);
  logic.init();
  const undoMgr = new UndoManager();
  const ds = new DocumentService();

  const audio = new AudioFeedback();
  opManager.onVerdict = (verdict) => {
    if (verdict === 'correct') audio.correct();
    else if (verdict === 'wrong') audio.wrong();
  };
  // Rejected-key feedback: fires whenever ApplicationLogic absorbs a key
  // that was invalid for the current mode (non-digit in result entry,
  // ArrowUp with no scratch row, ArrowDown in result entry, completely
  // unrecognised key, …). Gives motor-impaired students an unmistakable
  // "that did nothing" signal instead of silent failures.
  logic.onRejected = () => audio.rejected();

  // buttons
  const q = (id) => document.getElementById(id);
  const btnClear = q('btnClear');
  const btnPrint = q('btnPrint');
  const btnSavePdf = q('btnSavePdf');
  const btnOpen = q('btnOpen');
  const btnSave = q('btnSave');

  // add file input for open if not present
  let fileOpen = q('fileOpen');
  if (!fileOpen){
    fileOpen = document.createElement('input');
    fileOpen.type = 'file';
    fileOpen.id = 'fileOpen';
    fileOpen.accept = '.txt,application/json,text/plain';
    fileOpen.style.display = 'none';
    main.appendChild(fileOpen);
  }

  // Auto-save helpers
  const AUTO_SAVE_KEY = 'leonielab_autosave';
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      try { localStorage.setItem(AUTO_SAVE_KEY, ds.exportToText(doc)); } catch (_) {}
    }, 2000);
  }

  // Restore banner
  function showRestoreBanner() {
    const banner = document.createElement('div');
    banner.textContent = 'Session restored';
    banner.style.cssText = [
      'position:fixed', 'bottom:1.5rem', 'left:50%', 'transform:translateX(-50%)',
      'background:#2d6a4f', 'color:#fff', 'padding:.5rem 1.25rem',
      'border-radius:999px', 'font-size:.875rem', 'opacity:1',
      'transition:opacity 1s ease', 'pointer-events:none', 'z-index:9999',
    ].join(';');
    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = '0'; }, 2000);
    setTimeout(() => { banner.remove(); }, 3000);
  }

  // Restore from auto-save on load
  try {
    const saved = localStorage.getItem(AUTO_SAVE_KEY);
    if (saved) {
      const ok = ds.importFromText(saved, doc);
      if (ok) { grid.renderAll(); showRestoreBanner(); }
    }
  } catch (_) {}

  // Clear button: wipe grid, boxes, and reset cursor
  if (btnClear) btnClear.addEventListener('click', () => {
    grid.clear();
    opManager?.reset?.();
    logic.init();
    undoMgr.clear();
    try { localStorage.removeItem(AUTO_SAVE_KEY); } catch (_) {}
  });

  // Print & Save PDF (both call print dialog)
  const pdf = new PDFExporter();
  const doPrint = () => pdf.print({ orientation: 'portrait', marginMm: 10 });
  if (btnPrint) btnPrint.addEventListener('click', doPrint);
  // Save PDF instantly without print dialog
  if (btnSavePdf) btnSavePdf.addEventListener('click', async () => {
    await pdf.saveInstant(doc);
  });

  // Save/Open with DocumentService
  if (btnSave) btnSave.addEventListener('click', () => {
    const text = ds.exportToText(doc);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leonielab-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  if (btnOpen && fileOpen){
    btnOpen.addEventListener('click', () => fileOpen.click());
    fileOpen.addEventListener('change', async () => {
      const f = fileOpen.files?.[0];
      if (!f) return;
      try{
        const text = await f.text();
        const ok = ds.importFromText(text, doc);
        if (ok){
          grid.mount(); grid.renderAll(); logic.init();
          undoMgr.clear();
          try { localStorage.setItem(AUTO_SAVE_KEY, ds.exportToText(doc)); } catch (_) {}
        } else alert('Invalid file format');
      }catch{ alert('Failed to open file'); }
      finally{ fileOpen.value = ''; }
    });
  }

  // Mouse / touch: click (or tap) a cell to move the cursor there.
  // A tap on a touchscreen fires a synthetic click, so this single handler
  // covers both pointing devices. NOTE: this only handles cell *selection* —
  // typing digits/operators still requires a physical keyboard, since the app
  // has no on-screen keyboard. Delegated on `root` (which survives mount /
  // open re-renders) rather than on the grid element (recreated each mount).
  root.addEventListener('click', (e) => {
    // Scratch overlays have pointer-events:none, so a click on one resolves to
    // its parent .worksheet-cell here — selecting the underlying A-row cell.
    const cell = e.target.closest('.worksheet-cell');
    if (cell && cell.dataset.r != null && cell.dataset.c != null) {
      logic.setCursor(parseInt(cell.dataset.r, 10), parseInt(cell.dataset.c, 10));
      return;
    }
    // Text-strip overlays are siblings of the cells (they cover hidden cells),
    // so they need their own lookup. Landing on a strip's start column makes
    // setCursor auto-enter text-row edit mode.
    const strip = e.target.closest('.text-row-overlay');
    if (strip && strip.dataset.r != null && strip.dataset.startCol != null) {
      logic.setCursor(parseInt(strip.dataset.r, 10), parseInt(strip.dataset.startCol, 10));
    }
  });

  // Keyboard input
    document.addEventListener('keydown', (e) => {
    // Undo: Ctrl+Z / Cmd+Z — handled before the meta guard below
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      const snap = undoMgr.pop();
      if (snap) {
        ds.importFromText(snap.docJson, doc);
        opManager.active = null;
        opManager.divisionState = {};
        grid.renderAll();
        logic.setCursor(snap.cursor.row, snap.cursor.col);
        // Re-enter result-entry mode if the restored cursor is inside an
        // unlocked result range. Without this, undoing into a mid-result
        // state leaves the cursor free to roam the document instead of
        // being locked inside the operation box.
        opManager.tryResumeResultAtCursor(snap.cursor.row, snap.cursor.col);
      }
      e.preventDefault();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Tab moves the cursor one cell to the right (Shift+Tab one cell to the
    // left), with the same row-wrapping as the arrow keys. Normalising it to an
    // arrow key here lets Tab reuse every path below — locked-box exit,
    // result-entry clamp, and the plain wrapping move in ApplicationLogic —
    // instead of duplicating that logic. Tab always reaches one of those paths,
    // which call preventDefault, so focus never escapes the worksheet.
    const key = (e.key === 'Tab') ? (e.shiftKey ? 'ArrowLeft' : 'ArrowRight') : e.key;

    // Allow auto-repeat for Backspace (erase) and arrow keys (navigation)
    if (e.repeat && key !== 'Backspace' && !key.startsWith('Arrow')) return;

    // One-click exit from a locked box selection with arrow keys
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
    const cur = logic.cursor || { row: 0, col: 0 };
    const r = opManager?.getLockedRangeAt?.(cur.row, cur.col);
    if (r && r.boxRange) {
    const b = r.boxRange;
    let nr = cur.row, nc = cur.col;
    switch (key) {
    case 'ArrowLeft':
    if (b.startCol > 0) nc = b.startCol - 1;
    else if (b.topRow > 0) nr = b.topRow - 1;
    else if (b.resRow < doc.rows - 1) nr = b.resRow + 1;
    else if (b.endCol < doc.cols - 1) nc = b.endCol + 1;
    break;
    case 'ArrowRight':
    if (b.endCol < doc.cols - 1) nc = b.endCol + 1;
    else if (b.topRow > 0) nr = b.topRow - 1;
    else if (b.resRow < doc.rows - 1) nr = b.resRow + 1;
    else if (b.startCol > 0) nc = b.startCol - 1;
    break;
    case 'ArrowUp':
    if (b.topRow > 0) nr = b.topRow - 1;
    else if (b.startCol > 0) nc = b.startCol - 1;
    else if (b.endCol < doc.cols - 1) nc = b.endCol + 1;
    else if (b.resRow < doc.rows - 1) nr = b.resRow + 1;
    break;
    case 'ArrowDown':
    if (b.resRow < doc.rows - 1) nr = b.resRow + 1;
    else if (b.startCol > 0) nc = b.startCol - 1;
    else if (b.endCol < doc.cols - 1) nc = b.endCol + 1;
    else if (b.topRow > 0) nr = b.topRow - 1;
    break;
    }
    logic.setCursor(nr, nc);
    e.preventDefault();
    return;
    }
    }

    // Snapshot state before mutation for undo
    undoMgr.push(doc, logic.cursor);
    if (logic.handleKey(key)) {
      e.preventDefault();
      scheduleAutoSave();
    } else {
      undoMgr.pop(); // key was a no-op — discard snapshot
    }
    });
}

document.addEventListener('DOMContentLoaded', setupWorksheet);
