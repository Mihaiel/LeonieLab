export class GridRenderer {
  constructor(root, doc) {
    this.root    = root;
    this.doc     = doc;
    this.gridEl  = null;
    this.overlayEl = null;
    // Rows whose content lives in scratch overlays on the row below, not in their own cells
    this.scratchRows = new Set();
    // Full-width text row overlay elements keyed by row index
    this.textRowOverlays = {};
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
    grid.style.setProperty('--cols', this.doc.cols);

    for (let r = 0; r < this.doc.rows; r++) {
      for (let c = 0; c < this.doc.cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'worksheet-cell';
        cell.style.width = '48px';
        cell.style.height = '48px';
        cell.style.border = '1px solid #eee';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        // Wrap the character in a span so scratch overlay divs can coexist
        const charSpan = document.createElement('span');
        charSpan.className = 'cell-char';
        charSpan.textContent = this.doc.getCell(r, c)?.char || '';
        cell.appendChild(charSpan);
        grid.appendChild(cell);
      }
    }
    this.root.appendChild(grid);
    this.gridEl = grid;
    // Reset text row overlay tracking on fresh mount
    this.textRowOverlays = {};
    this.applyAllDecorations();
  }

  clear() {
    if (!this.gridEl) return;
    this.doc.clearAll();
    this.renderAll();
    if (this.overlayEl) this.overlayEl.style.display = 'none';
  }

  renderAll() {
    if (!this.gridEl) return;
    // Rebuild decorations first so scratchRows is up to date before text pass
    this.applyAllDecorations();
    // Update cell text — scratch rows show content in overlays, not directly
    let idx = 0;
    for (let r = 0; r < this.doc.rows; r++) {
      for (let c = 0; c < this.doc.cols; c++) {
        const cell = this.gridEl.children[idx++];
        if (!cell) continue;
        const span = cell.querySelector('.cell-char');
        if (!span) continue;
        span.textContent = this.scratchRows.has(r) ? '' : (this.doc.getCell(r, c)?.char || '');
      }
    }
  }

  updateCell(r, c) {
    if (!this.gridEl) return;
    const idx = r * this.doc.cols + c;
    const el  = this.gridEl.children[idx];
    if (!el) return;
    if (this.scratchRows.has(r)) {
      // Scratch row — content lives in the overlay on the A-row cell below
      this._updateScratchOverlay(r, r + 1, c);
      return;
    }
    const span = el.querySelector('.cell-char');
    if (span) span.textContent = this.doc.getCell(r, c)?.char || '';
  }

  updateCursor(r, c) {
    if (!this.gridEl) return;
    Array.from(this.gridEl.children).forEach(el => el.classList.remove('is-cursor', 'box-selected'));
    if (this.overlayEl) this.overlayEl.style.display = 'none';
    const el = this.gridEl.children[r * this.doc.cols + c];
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
    Array.from(this.gridEl.children).forEach(el => el.classList.remove('is-cursor', 'box-selected'));
    for (let r = topRow; r <= bottomRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const el = this.gridEl.children[r * this.doc.cols + c];
        if (el) el.classList.add('box-selected');
      }
    }
    const ov = this.ensureOverlay();
    const firstEl = this.gridEl.children[topRow    * this.doc.cols + startCol];
    const lastEl  = this.gridEl.children[bottomRow * this.doc.cols + endCol];
    if (!firstEl || !lastEl) return;
    ov.style.left   = `${firstEl.offsetLeft}px`;
    ov.style.top    = `${firstEl.offsetTop}px`;
    ov.style.width  = `${lastEl.offsetLeft + lastEl.offsetWidth  - firstEl.offsetLeft}px`;
    ov.style.height = `${lastEl.offsetTop  + lastEl.offsetHeight - firstEl.offsetTop}px`;
    ov.style.display = 'block';
  }

  clearAllDecorations() {
    if (!this.gridEl) return;
    Array.from(this.gridEl.children).forEach(el => {
      el.classList.remove('underline', 'result', 'result-correct', 'result-wrong', 'box-selected', 'is-cursor');
    });
    if (this.overlayEl) this.overlayEl.style.display = 'none';
  }

  // Re-derive all persistent decorations from doc and apply to DOM.
  // Called after every full render (mount / renderAll) so DOM never drifts from doc.
  applyAllDecorations() {
    if (!this.gridEl) return;

    // Strip decoration classes and scratch overlays; rebuild scratchRows
    this.scratchRows = new Set();
    Array.from(this.gridEl.children).forEach(el => {
      el.classList.remove('underline', 'result-correct', 'result-wrong');
      delete el.dataset.locked;
      el.querySelectorAll('.scratch-overlay').forEach(ov => ov.remove());
    });

    // Re-apply underlines
    for (const { row, startCol, endCol } of this.doc.underlineRanges) {
      for (let c = startCol; c <= endCol; c++) {
        const el = this.gridEl.children[row * this.doc.cols + c];
        if (el) el.classList.add('underline');
      }
    }

    // Re-apply locked result zones
    for (const range of this.doc.operationRanges) {
      if (!range.locked) continue;
      const s = range.lockedStartCol ?? range.startCol;
      const e = range.lockedEndCol   ?? range.endCol;
      for (let c = s; c <= e; c++) {
        const el = this.gridEl.children[range.row * this.doc.cols + c];
        if (el) { el.classList.add('result-correct'); el.dataset.locked = '1'; }
      }
    }

    // Sync text row overlays with doc.textRows
    const docTextRows = this.doc.textRows || {};
    // Remove overlays whose rows are no longer text rows
    for (const rStr of Object.keys(this.textRowOverlays)) {
      const r = parseInt(rStr);
      if (!(r in docTextRows)) this._removeTextRowOverlay(r);
    }
    // Add/update overlays for all current text rows
    for (const [rStr, entry] of Object.entries(docTextRows)) {
      const r        = parseInt(rStr);
      const text     = typeof entry === 'string' ? entry : (entry?.text ?? '');
      const startCol = typeof entry === 'string' ? 0     : (entry?.startCol ?? 0);
      this.setTextRow(r, text, null, startCol);
    }

    // Re-add scratch overlays on A-row cells and track scratch rows
    const seen = new Set();
    for (const range of this.doc.operationRanges) {
      const b = range.boxRange;
      if (!b || b.scratchRow == null) continue;
      const key = `${b.scratchRow}_${b.topRow}_${b.scratchStart ?? b.startCol}_${b.scratchEnd ?? b.endCol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.scratchRows.add(b.scratchRow);
      const ss = b.scratchStart ?? b.startCol;
      const se = b.scratchEnd   ?? b.endCol;
      for (let c = ss; c <= se; c++) {
        this._addScratchOverlay(b.topRow, c, b.scratchRow);
      }
    }
  }

  // --- Scratch overlay helpers ---

  // Add a scratch overlay div to the top-right corner of an A-row cell.
  // Content is read from doc.grid[scratchRow][col].
  _addScratchOverlay(aRow, col, scratchRow) {
    const idx  = aRow * this.doc.cols + col;
    const cell = this.gridEl.children[idx];
    if (!cell) return;
    // position: relative needed for the absolute overlay child
    cell.style.position = 'relative';
    const ov = document.createElement('div');
    ov.className = 'scratch-overlay';
    ov.dataset.scratchRow = String(scratchRow);
    ov.textContent = this.doc.getCell(scratchRow, col)?.char || '';
    cell.appendChild(ov);
  }

  // Update the overlay content after a scratch digit is written or cleared.
  _updateScratchOverlay(scratchRow, aRow, col) {
    const idx  = aRow * this.doc.cols + col;
    const cell = this.gridEl.children[idx];
    if (!cell) return;
    const ov = cell.querySelector(`.scratch-overlay[data-scratch-row="${scratchRow}"]`);
    if (ov) ov.textContent = this.doc.getCell(scratchRow, col)?.char || '';
  }

  // Called from formatters immediately after format() runs (before operationRanges is populated).
  // aRow = topRow (row of operand A), scratchRow = aRow - 1.
  markScratchRow(scratchRow, aRow, startCol, endCol) {
    if (!this.gridEl || scratchRow == null) return;
    this.scratchRows.add(scratchRow);
    for (let c = startCol; c <= endCol; c++) {
      this._addScratchOverlay(aRow, c, scratchRow);
    }
  }

  // Toggle the active (focused) state of a scratch overlay.
  setScratchCursor(aRow, col, active) {
    if (!this.gridEl) return;
    const idx  = aRow * this.doc.cols + col;
    const cell = this.gridEl.children[idx];
    if (!cell) return;
    const ov = cell.querySelector('.scratch-overlay');
    if (ov) ov.classList.toggle('scratch-active', active);
  }

  // --- Underline helpers ---

  addUnderline(row, startCol, endCol) {
    const s = Math.max(0, Math.min(startCol, endCol));
    const e = Math.min(this.doc.cols - 1, Math.max(startCol, endCol));
    this.doc.underlineRanges.push({ row, startCol: s, endCol: e });
    if (!this.gridEl) return;
    for (let c = s; c <= e; c++) {
      const el = this.gridEl.children[row * this.doc.cols + c];
      if (el) el.classList.add('underline');
    }
  }

  removeUnderline(row, startCol, endCol) {
    const s = Math.max(0, Math.min(startCol, endCol));
    const e = Math.min(this.doc.cols - 1, Math.max(startCol, endCol));
    this.doc.underlineRanges = this.doc.underlineRanges.filter(
      r => !(r.row === row && r.startCol === s && r.endCol === e)
    );
    if (!this.gridEl) return;
    for (let c = s; c <= e; c++) {
      const el = this.gridEl.children[row * this.doc.cols + c];
      if (el) el.classList.remove('underline');
    }
  }

  // --- Text row helpers ---

  // Create or update a text overlay for a row, anchored at startCol.
  // The overlay starts exactly at that column and grows rightward as text is typed.
  // cursorPos = null means display-only (no blinking caret shown).
  setTextRow(r, str, cursorPos, startCol = 0) {
    if (!this.gridEl) return;
    let ov = this.textRowOverlays[r];
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'text-row-overlay';
      this.gridEl.appendChild(ov);
      this.textRowOverlays[r] = ov;
    }
    // Position: left edge anchored to startCol; max-width reaches the right edge of the grid
    const startCell = this.gridEl.children[r * this.doc.cols + startCol];
    const lastCell  = this.gridEl.children[r * this.doc.cols + this.doc.cols - 1];
    if (startCell && lastCell) {
      ov.style.left     = `${startCell.offsetLeft}px`;
      ov.style.top      = `${startCell.offsetTop}px`;
      ov.style.maxWidth = `${lastCell.offsetLeft + lastCell.offsetWidth - startCell.offsetLeft}px`;
      ov.style.height   = `${startCell.offsetHeight}px`;
      ov.style.width    = ''; // max-content via CSS; grows with text
    }
    this._renderTextContent(ov, str, cursorPos);
    // Snap overlay to whole-cell boundaries and record endCol in doc
    this._snapToGrid(r, ov, startCol);
  }

  // Public: remove a text row overlay and restore all cell visibility in that row.
  removeTextRow(r) { this._removeTextRowOverlay(r); }

  _removeTextRowOverlay(r) {
    const ov = this.textRowOverlays[r];
    if (ov) { ov.remove(); delete this.textRowOverlays[r]; }
    this._showRowCells(r);
  }

  // Update only the caret position inside an existing text overlay (no reposition).
  updateTextRowCursor(r, cursorPos) {
    const ov = this.textRowOverlays[r];
    if (!ov) return;
    const entry    = this.doc.textRows?.[r];
    const str      = entry?.text ?? (typeof entry === 'string' ? entry : '');
    const startCol = entry?.startCol ?? 0;
    this._renderTextContent(ov, str, cursorPos);
    this._snapToGrid(r, ov, startCol);
  }

  // Render overlay innerHTML: text split at cursorPos with a blinking caret span.
  _renderTextContent(ov, str, cursorPos) {
    if (cursorPos !== null) {
      ov.classList.add('is-active');
      ov.innerHTML = '';
      ov.appendChild(document.createTextNode(str.slice(0, cursorPos)));
      const caret = document.createElement('span');
      caret.className = 'text-row-caret';
      ov.appendChild(caret);
      ov.appendChild(document.createTextNode(str.slice(cursorPos)));
    } else {
      ov.classList.remove('is-active');
      ov.textContent = str || '';
    }
  }

  // Snap the overlay width to the nearest cell boundary (always covers N complete
  // cells, never a fraction). Reads offsetWidth to trigger a synchronous reflow,
  // then sets an explicit snapped width. Stores endCol in doc.textRows[r] so
  // ApplicationLogic can use it for cursor-range detection without DOM access.
  _snapToGrid(r, ov, startCol) {
    const startCell = this.gridEl.children[r * this.doc.cols + startCol];
    if (!startCell) return;

    // Clear any previously snapped width so the browser sizes by content (max-content)
    ov.style.width = '';

    // Reading offsetWidth after clearing forces a reflow — gives the true natural size
    const cellWidth = startCell.offsetWidth;
    const natural   = ov.offsetWidth;
    const style     = window.getComputedStyle(ov);
    const paddingH  = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const n         = Math.max(1, Math.ceil((natural - paddingH) / cellWidth));
    const endCol    = Math.min(startCol + n - 1, this.doc.cols - 1);

    // Derive width from actual end-cell position to avoid border-width drift
    const endCell  = this.gridEl.children[r * this.doc.cols + endCol];
    const snapped  = endCell.offsetLeft + endCell.offsetWidth - startCell.offsetLeft;
    ov.style.width = `${snapped}px`;

    // Persist endCol so cursor checks don't need DOM access
    const entry = this.doc.textRows?.[r];
    if (entry && typeof entry === 'object') entry.endCol = endCol;

    // Hide exactly the covered cells; show everything else in the row
    for (let c = 0; c < this.doc.cols; c++) {
      const el = this.gridEl.children[r * this.doc.cols + c];
      if (el) el.style.visibility = (c >= startCol && c <= endCol) ? 'hidden' : '';
    }
  }

  _showRowCells(r) {
    for (let c = 0; c < this.doc.cols; c++) {
      const el = this.gridEl.children[r * this.doc.cols + c];
      if (el) el.style.visibility = '';
    }
  }
}
