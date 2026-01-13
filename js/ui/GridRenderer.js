export class GridRenderer {
  constructor(root, doc) {
    this.root = root;
    this.doc = doc;
    this.gridEl = null;
    this.overlayEl = null;
  }

  mount() {
    this.root.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'worksheet-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${this.doc.cols}, 48px)`;
    grid.style.gap = '0';
    grid.style.userSelect = 'none';
    grid.style.position = 'relative';
    // Expose column count for print CSS overrides
    grid.style.setProperty('--cols', this.doc.cols);

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

  clear() {
    if (!this.gridEl) return;
    this.doc.clearAll();
    this.renderAll();
    this.clearAllDecorations();
    if (this.overlayEl) this.overlayEl.style.display = 'none';
  }

  renderAll() {
    if (!this.gridEl) return;
    const cells = Array.from(this.gridEl.children);
    let idx = 0;
    for (let r = 0; r < this.doc.rows; r++) {
      for (let c = 0; c < this.doc.cols; c++) {
        const el = cells[idx++];
        el.textContent = this.doc.getCell(r, c)?.char || '';
      }
    }
  }

  updateCell(r, c) {
    if (!this.gridEl) return;
    const idx = r * this.doc.cols + c;
    const el = this.gridEl.children[idx];
    if (el) el.textContent = this.doc.getCell(r, c)?.char || '';
  }

  updateCursor(r, c) {
    if (!this.gridEl) return;
    Array.from(this.gridEl.children).forEach(el => el.classList.remove('is-cursor', 'box-selected'));
    if (this.overlayEl) this.overlayEl.style.display = 'none';
    const idx = r * this.doc.cols + c;
    const el = this.gridEl.children[idx];
    if (el) el.classList.add('is-cursor');
  }

  ensureOverlay() {
    if (this.overlayEl) return this.overlayEl;
    const ov = document.createElement('div');
    ov.style.position = 'absolute';
    ov.style.border = '2px solid var(--color-primary)';
    ov.style.borderRadius = '4px';
    ov.style.boxSizing = 'border-box';
    ov.style.pointerEvents = 'none';
    ov.style.zIndex = '2';
    ov.style.display = 'none';
    this.gridEl.appendChild(ov);
    this.overlayEl = ov;
    return ov;
  }

  highlightBox(topRow, bottomRow, startCol, endCol) {
    if (!this.gridEl) return;
    // Restore cell-level highlighting for the whole box selection
    Array.from(this.gridEl.children).forEach(el => el.classList.remove('is-cursor', 'box-selected'));
    for (let r = topRow; r <= bottomRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const idx = r * this.doc.cols + c;
        const el = this.gridEl.children[idx];
        if (el) el.classList.add('box-selected');
      }
    }
    const ov = this.ensureOverlay();
    const firstIdx = topRow * this.doc.cols + startCol;
    const lastIdx = bottomRow * this.doc.cols + endCol;
    const firstEl = this.gridEl.children[firstIdx];
    const lastEl = this.gridEl.children[lastIdx];
    if (!firstEl || !lastEl) return;
    // Use offsets (relative to grid) for pixel-precise overlay placement
    const left = firstEl.offsetLeft;
    const top = firstEl.offsetTop;
    const right = lastEl.offsetLeft + lastEl.offsetWidth;
    const bottom = lastEl.offsetTop + lastEl.offsetHeight;
    ov.style.left = `${left}px`;
    ov.style.top = `${top}px`;
    ov.style.width = `${right - left}px`;
    ov.style.height = `${bottom - top}px`;
    ov.style.display = 'block';
  }

  clearAllDecorations() {
    if (!this.gridEl) return;
    Array.from(this.gridEl.children).forEach((el) => {
      el.classList.remove('underline');
      el.classList.remove('result');
      el.classList.remove('result-correct');
      el.classList.remove('result-wrong');
      el.classList.remove('box-selected');
      el.classList.remove('is-cursor');
    });
    if (this.overlayEl) this.overlayEl.style.display = 'none';
  }

  // Optional helpers for future operation strategies
  addUnderline(row, startCol, endCol) {
    if (!this.gridEl) return;
    const s = Math.max(0, Math.min(startCol, endCol));
    const e = Math.min(this.doc.cols - 1, Math.max(startCol, endCol));
    for (let c = s; c <= e; c++) {
      const idx = row * this.doc.cols + c;
      const el = this.gridEl.children[idx];
      if (el) el.classList.add('underline');
    }
  }

  removeUnderline(row, startCol, endCol) {
    if (!this.gridEl) return;
    const s = Math.max(0, Math.min(startCol, endCol));
    const e = Math.min(this.doc.cols - 1, Math.max(startCol, endCol));
    for (let c = s; c <= e; c++) {
      const idx = row * this.doc.cols + c;
      const el = this.gridEl.children[idx];
      if (el) el.classList.remove('underline');
    }
  }
}
