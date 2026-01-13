// Bootstraps the worksheet page: grid + logic + buttons
import { GridRenderer } from './ui/GridRenderer.js';
import { Document } from './models/Document.js';
import { PDFExporter } from './services/PDFExporter.js';
import { ApplicationLogic } from './logic/ApplicationLogic.js';
import { OperationManager } from './logic/OperationManager.js';
import { DocumentService } from './services/DocumentService.js';

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
  const opManager = new OperationManager();
  const logic = new ApplicationLogic(doc, grid, opManager);
  logic.init();

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

  // Clear button: wipe grid, boxes, and reset cursor
  if (btnClear) btnClear.addEventListener('click', () => {
    grid.clear();
    opManager?.reset?.();
    logic.init();
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
  const ds = new DocumentService();
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
        if (ok){ grid.mount(); grid.renderAll(); logic.init(); }
        else alert('Invalid file format');
      }catch{ alert('Failed to open file'); }
      finally{ fileOpen.value = ''; }
    });
  }

  // Keyboard input
    document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Allow auto-repeat only for Backspace (so user can hold to erase)
    if (e.repeat && e.key !== 'Backspace') return;

    // One-click exit from a locked box selection with arrow keys
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const cur = logic.cursor || { row: 0, col: 0 };
    const r = opManager?.getLockedRangeAt?.(cur.row, cur.col);
    if (r && r.boxRange) {
    const b = r.boxRange;
    let nr = cur.row, nc = cur.col;
    switch (e.key) {
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

    if (logic.handleKey(e.key)) e.preventDefault();
    });
}

document.addEventListener('DOMContentLoaded', setupWorksheet);
