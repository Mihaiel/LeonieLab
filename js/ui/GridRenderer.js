/*
  GridRenderer
  -----------------
  Tiny view layer that turns a Document's 2D grid into DOM nodes.
  This takes care of the grid rendering.
  To modify the 2D grid properties (rows, columns), go to the document data model (/models/Document.js).
*/

// Renders the grid as a simple set of fixed-size cells
export class GridRenderer {
  constructor(root, doc) {
    this.root = root;
    this.doc = doc;
    this.gridEl = null;
  }

  mount() {
    // (Re)create a grid element and fill it with cells
    this.root.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'worksheet-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${this.doc.cols}, 48px)`; // 48px square cells
    grid.style.gap = '0';
    grid.style.userSelect = 'none';
    grid.style.setProperty('--cols', this.doc.cols);

    // Create one div per cell and show the current character
    for (let r = 0; r < this.doc.rows; r++) {
      for (let c = 0; c < this.doc.cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'worksheet-cell';
        cell.style.width = '48px';
        cell.style.height = '48px';
        cell.style.border = '1px solid #eee';
        cell.textContent = this.doc.getCell(r, c)?.char || '';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        grid.appendChild(cell);
      }
    }
    this.root.appendChild(grid);
    this.gridEl = grid;
  }
  // Refresh all cells (useful after loading a file)
  renderAll() {
    if (!this.gridEl) return;
    const cells = Array.from(this.gridEl.children);
    let i = 0;
    for (let r = 0; r < this.doc.rows; r++) {
      for (let c = 0; c < this.doc.cols; c++) {
        const el = cells[i++];
        el.textContent = this.doc.getCell(r, c)?.char || '';
      }
    }
  }

  // Refresh a single cell (fast path when typing)
  updateCell(r, c) {
    if (!this.gridEl) return;
    const idx = r * this.doc.cols + c;
    const el = this.gridEl.children[idx];
    if (el) el.textContent = this.doc.getCell(r, c)?.char || '';
  }

  // Visually mark the active cell so the user knows where they are
  updateCursor(r, c) {
    if (!this.gridEl) return;
    Array.from(this.gridEl.children).forEach(el => el.classList.remove('is-cursor'));
    const idx = r * this.doc.cols + c;
    const el = this.gridEl.children[idx];
    if (el) el.classList.add('is-cursor');
  }

  // Erase the document contents and repaint
  clear() {
    this.doc.clearAll();
    this.renderAll();
  }
}
