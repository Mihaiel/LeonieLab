export class GridRenderer {
  constructor(root, doc) {
    this.root    = root;
    this.doc     = doc;
    this.gridEl  = null;
    this.overlayEl = null;
    // On-screen cell size in px (configurable via SettingsService). mount()
    // rebuilds the grid at this size; overlay math reads offset* from the laid
    // out cells, so everything self-corrects after a re-mount.
    this.cellSize = 48;
    // Rows whose content lives in scratch overlays on the row below, not in their own cells
    this.scratchRows = new Set();
    // Text strip overlay elements keyed by "row:startCol" (multiple strips per row)
    this.textRowOverlays = {};
    // Fraction-bar overlay elements keyed by "row:startCol:endCol" (Bruchrechnung)
    this.fractionBarEls = {};
    // Fraction operand text overlays (centered numerator/denominator) keyed the same way
    this.fractionTextEls = {};
    // Cells whose internal vertical borders were suppressed to "merge" a
    // multi-digit fraction number into one box (reset before each rebuild).
    this._mergedCells = [];
  }

  mount() {
    this.root.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'worksheet-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${this.doc.cols}, ${this.cellSize}px)`;
    grid.style.gap = '0';
    grid.style.userSelect = 'none';
    grid.style.position = 'relative';
    grid.style.setProperty('--cols', this.doc.cols);

    for (let r = 0; r < this.doc.rows; r++) {
      for (let c = 0; c < this.doc.cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'worksheet-cell';
        cell.style.width = `${this.cellSize}px`;
        cell.style.height = `${this.cellSize}px`;
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
    // Reset overlay tracking on fresh mount (els live inside the rebuilt grid)
    this.textRowOverlays = {};
    this.fractionBarEls = {};
    this.fractionTextEls = {};
    this._mergedCells = [];
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
      el.querySelectorAll('.unit-exp-overlay').forEach(ov => ov.remove());
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

    // Sync text strip overlays with doc.textRows (supports multiple strips per row)
    const docTextRows = this.doc.textRows || {};
    const currentKeys = new Set();
    for (const [rStr, val] of Object.entries(docTextRows)) {
      const r = parseInt(rStr);
      const strips = Array.isArray(val) ? val : (val ? [val] : []);
      for (const s of strips) currentKeys.add(this._overlayKey(r, s.startCol ?? 0));
    }
    // Remove stale overlays (and remember their rows so we can un-hide cells)
    const affectedRows = new Set();
    for (const key of Object.keys(this.textRowOverlays)) {
      if (!currentKeys.has(key)) {
        const ov = this.textRowOverlays[key];
        if (ov) ov.remove();
        delete this.textRowOverlays[key];
        const [rStr] = key.split(':');
        affectedRows.add(parseInt(rStr));
      }
    }
    // Add/update overlays for all current strips
    for (const [rStr, val] of Object.entries(docTextRows)) {
      const r = parseInt(rStr);
      affectedRows.add(r);
      const strips = Array.isArray(val) ? val : (val ? [val] : []);
      for (const s of strips) {
        const text     = typeof s === 'string' ? s : (s?.text ?? '');
        const startCol = typeof s === 'string' ? 0 : (s?.startCol ?? 0);
        this.setTextRow(r, text, null, startCol);
      }
    }
    for (const r of affectedRows) this._refreshRowVisibility(r);

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

    // Re-add unit exponent overlays (m², cm², mⁿ) from doc.exponents.
    const exps = this.doc.exponents || {};
    for (const key of Object.keys(exps)) {
      if (!exps[key]) continue;
      const [rStr, cStr] = key.split(':');
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);
      if (Number.isInteger(r) && Number.isInteger(c)) this.addUnitExponent(r, c);
    }

    // Rebuild fraction bars (Bruchrechnung) from doc.fractionBars so they
    // survive mount() / renderAll() / load.
    for (const key of Object.keys(this.fractionBarEls)) this.fractionBarEls[key]?.remove();
    this.fractionBarEls = {};
    for (const { row, startCol, endCol } of (this.doc.fractionBars || [])) {
      this._renderFractionBar(row, startCol, endCol);
    }

    // Rebuild fraction operand text overlays (centered numerator/denominator).
    for (const key of Object.keys(this.fractionTextEls)) this.fractionTextEls[key]?.remove();
    this.fractionTextEls = {};
    for (const { row, startCol, endCol, text } of (this.doc.fractionTexts || [])) {
      this._renderFractionText(row, startCol, endCol, text);
    }

    // "Merge" each fraction's cells: drop the internal vertical grid borders
    // across the bar's 3-row span so a multi-digit number (e.g. "16") reads as
    // one box rather than "1 | 6". Outer borders + horizontal lines stay.
    for (const el of this._mergedCells) { el.style.borderLeft = ''; el.style.borderRight = ''; }
    this._mergedCells = [];
    for (const { row, startCol, endCol } of (this.doc.fractionBars || [])) {
      if (endCol <= startCol) continue; // single-digit: nothing to merge
      for (const r of [row - 1, row, row + 1]) {
        for (let c = startCol; c <= endCol; c++) {
          const el = this.gridEl.children[r * this.doc.cols + c];
          if (!el) continue;
          if (c > startCol) { el.style.borderLeft  = 'none'; this._mergedCells.push(el); }
          if (c < endCol)   { el.style.borderRight = 'none'; this._mergedCells.push(el); }
        }
      }
    }
  }

  // --- Fraction bar helpers (Bruchrechnung) ---

  // Record a bar in the doc and draw it. Centered vertically on `row`,
  // spanning columns [startCol, endCol].
  addFractionBar(row, startCol, endCol) {
    const s = Math.min(startCol, endCol);
    const e = Math.max(startCol, endCol);
    if (!Array.isArray(this.doc.fractionBars)) this.doc.fractionBars = [];
    const exists = this.doc.fractionBars.some(b => b.row === row && b.startCol === s && b.endCol === e);
    if (!exists) this.doc.fractionBars.push({ row, startCol: s, endCol: e });
    this._renderFractionBar(row, s, e);
  }

  removeFractionBar(row, startCol, endCol) {
    const s = Math.min(startCol, endCol);
    const e = Math.max(startCol, endCol);
    this.doc.fractionBars = (this.doc.fractionBars || []).filter(
      b => !(b.row === row && b.startCol === s && b.endCol === e)
    );
    const key = `${row}:${s}:${e}`;
    this.fractionBarEls[key]?.remove();
    delete this.fractionBarEls[key];
  }

  _renderFractionBar(row, startCol, endCol) {
    if (!this.gridEl) return;
    const key = `${row}:${startCol}:${endCol}`;
    let el = this.fractionBarEls[key];
    if (!el) {
      el = document.createElement('div');
      el.className = 'fraction-bar-overlay';
      this.gridEl.appendChild(el);
      this.fractionBarEls[key] = el;
    }
    const startCell = this.gridEl.children[row * this.doc.cols + startCol];
    const endCell   = this.gridEl.children[row * this.doc.cols + endCol];
    if (!startCell || !endCell) return;
    const inset = 4; // keep the bar off the cell borders for a clean look
    el.style.left  = `${startCell.offsetLeft + inset}px`;
    el.style.top   = `${startCell.offsetTop + startCell.offsetHeight / 2}px`;
    el.style.width = `${endCell.offsetLeft + endCell.offsetWidth - startCell.offsetLeft - inset * 2}px`;
  }

  // --- Fraction operand text overlay (centered numerator/denominator) ---
  // Renders a number centered across [startCol, endCol] on a row, so a short
  // operand (e.g. "4") sits centered under a wider one (e.g. "12") instead of
  // being stranded under its first cell. The cells underneath stay empty.
  addFractionText(row, startCol, endCol, text) {
    const s = Math.min(startCol, endCol);
    const e = Math.max(startCol, endCol);
    if (!Array.isArray(this.doc.fractionTexts)) this.doc.fractionTexts = [];
    const i = this.doc.fractionTexts.findIndex(t => t.row === row && t.startCol === s && t.endCol === e);
    if (i === -1) this.doc.fractionTexts.push({ row, startCol: s, endCol: e, text });
    else this.doc.fractionTexts[i].text = text;
    this._renderFractionText(row, s, e, text);
  }

  removeFractionText(row, startCol, endCol) {
    const s = Math.min(startCol, endCol);
    const e = Math.max(startCol, endCol);
    this.doc.fractionTexts = (this.doc.fractionTexts || []).filter(
      t => !(t.row === row && t.startCol === s && t.endCol === e)
    );
    const key = `${row}:${s}:${e}`;
    this.fractionTextEls[key]?.remove();
    delete this.fractionTextEls[key];
  }

  _renderFractionText(row, startCol, endCol, text) {
    if (!this.gridEl) return;
    const key = `${row}:${startCol}:${endCol}`;
    let el = this.fractionTextEls[key];
    if (!el) {
      el = document.createElement('div');
      el.className = 'fraction-text-overlay';
      this.gridEl.appendChild(el);
      this.fractionTextEls[key] = el;
    }
    el.textContent = text;
    const startCell = this.gridEl.children[row * this.doc.cols + startCol];
    const endCell   = this.gridEl.children[row * this.doc.cols + endCol];
    if (!startCell || !endCell) return;
    el.style.left   = `${startCell.offsetLeft}px`;
    el.style.top    = `${startCell.offsetTop}px`;
    el.style.width  = `${endCell.offsetLeft + endCell.offsetWidth - startCell.offsetLeft}px`;
    el.style.height = `${startCell.offsetHeight}px`;
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

  // --- Unit exponent overlay helpers (m², cm², mⁿ) ---
  // A superscript overlay in the top-right of a unit's final-letter cell.
  // Content lives in doc.exponents["row:col"].

  _expKey(r, c) { return `${r}:${c}`; }

  // Create the overlay (if absent) and sync its text from the doc.
  addUnitExponent(r, c) {
    const cell = this.gridEl?.children[r * this.doc.cols + c];
    if (!cell) return;
    cell.style.position = 'relative';
    let ov = cell.querySelector('.unit-exp-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'unit-exp-overlay';
      cell.appendChild(ov);
    }
    ov.textContent = this.doc.exponents?.[this._expKey(r, c)] || '';
  }

  // Sync overlay text after a digit is typed/deleted. Creates the overlay if a
  // value exists and it is missing; leaves an empty overlay in place (so the
  // active outline stays visible) — removeUnitExponent tears it down on exit.
  updateUnitExponent(r, c) {
    const cell = this.gridEl?.children[r * this.doc.cols + c];
    if (!cell) return;
    const val = this.doc.exponents?.[this._expKey(r, c)] || '';
    let ov = cell.querySelector('.unit-exp-overlay');
    if (!ov) { if (!val) return; this.addUnitExponent(r, c); ov = cell.querySelector('.unit-exp-overlay'); }
    if (ov) ov.textContent = val;
  }

  // Remove the overlay entirely (used on exit when the exponent is empty).
  removeUnitExponent(r, c) {
    const cell = this.gridEl?.children[r * this.doc.cols + c];
    const ov = cell?.querySelector('.unit-exp-overlay');
    if (ov) ov.remove();
  }

  // Toggle the active (focused) state. When activating an empty unit cell the
  // overlay is created so the student sees where the exponent will go.
  setUnitExpCursor(r, c, active) {
    const cell = this.gridEl?.children[r * this.doc.cols + c];
    if (!cell) return;
    let ov = cell.querySelector('.unit-exp-overlay');
    if (!ov && active) { this.addUnitExponent(r, c); ov = cell.querySelector('.unit-exp-overlay'); }
    if (ov) ov.classList.toggle('unit-exp-active', active);
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

  _overlayKey(r, startCol) { return `${r}:${startCol}`; }

  _findStripEntry(r, startCol) {
    const strips = this.doc.textRows?.[r];
    if (!Array.isArray(strips)) return null;
    return strips.find(s => s.startCol === startCol) || null;
  }

  // Create or update a text strip overlay for (row, startCol).
  // The overlay anchors at startCol and grows rightward; cursorPos = null means
  // display-only (no blinking caret).
  setTextRow(r, str, cursorPos, startCol = 0) {
    if (!this.gridEl) return;
    const key = this._overlayKey(r, startCol);
    let ov = this.textRowOverlays[key];
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'text-row-overlay';
      // Tagged so the click-to-select handler in main.js can map a click on
      // the overlay back to its grid coordinates (strips cover hidden cells,
      // so the cell beneath is not a usable click target).
      ov.dataset.r = String(r);
      ov.dataset.startCol = String(startCol);
      this.gridEl.appendChild(ov);
      this.textRowOverlays[key] = ov;
    }
    const startCell = this.gridEl.children[r * this.doc.cols + startCol];
    const lastCell  = this.gridEl.children[r * this.doc.cols + this.doc.cols - 1];
    if (startCell && lastCell) {
      ov.style.left     = `${startCell.offsetLeft}px`;
      ov.style.top      = `${startCell.offsetTop}px`;
      ov.style.maxWidth = `${lastCell.offsetLeft + lastCell.offsetWidth - startCell.offsetLeft}px`;
      ov.style.height   = `${startCell.offsetHeight}px`;
      ov.style.width    = '';
    }
    this._renderTextContent(ov, str, cursorPos);
    this._snapToGrid(r, ov, startCol);
    this._refreshRowVisibility(r);
  }

  // Remove a single text strip overlay (identified by its startCol) and
  // refresh the row so cells covered by other strips stay hidden.
  removeTextRow(r, startCol) {
    const key = this._overlayKey(r, startCol);
    const ov = this.textRowOverlays[key];
    if (ov) { ov.remove(); delete this.textRowOverlays[key]; }
    this._refreshRowVisibility(r);
  }

  // Update only the caret position inside an existing text strip overlay.
  updateTextRowCursor(r, startCol, cursorPos) {
    const key = this._overlayKey(r, startCol);
    const ov = this.textRowOverlays[key];
    if (!ov) return;
    const entry = this._findStripEntry(r, startCol);
    const str   = entry?.text ?? '';
    this._renderTextContent(ov, str, cursorPos);
    this._snapToGrid(r, ov, startCol);
    this._refreshRowVisibility(r);
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
  // cells). Clamps endCol so this strip never spills into a neighbouring strip
  // further right on the same row. Writes endCol back to the doc entry so
  // ApplicationLogic can test cursor containment without DOM access.
  _snapToGrid(r, ov, startCol) {
    const startCell = this.gridEl.children[r * this.doc.cols + startCol];
    if (!startCell) return;

    // Upper bound = just before the next strip's startCol (or end of row)
    const strips = this.doc.textRows?.[r] || [];
    const nextStart = strips
      .map(s => s.startCol)
      .filter(sc => sc > startCol)
      .reduce((min, sc) => Math.min(min, sc), this.doc.cols);
    const maxEndCol = Math.min(this.doc.cols - 1, nextStart - 1);

    // Clear any previously snapped width so max-content reports the true natural size
    ov.style.width = '';
    const cellWidth = startCell.offsetWidth;
    const natural   = ov.offsetWidth; // border-box: includes text + padding + border
    // The overlay's whole border box must fit inside N cells (overflow:hidden
    // would clip anything past the snapped width), so divide the full natural
    // width — NOT natural minus padding — by cellWidth.
    const n         = Math.max(1, Math.ceil(natural / cellWidth));
    const endCol    = Math.min(startCol + n - 1, maxEndCol);

    const endCell = this.gridEl.children[r * this.doc.cols + endCol];
    if (endCell) {
      const snapped = endCell.offsetLeft + endCell.offsetWidth - startCell.offsetLeft;
      ov.style.width = `${snapped}px`;
    }

    const entry = this._findStripEntry(r, startCol);
    if (entry) entry.endCol = endCol;
  }

  // Recompute cell visibility for a row: hide any cell covered by any strip,
  // show all others. Called whenever strips are added, removed, or resized.
  _refreshRowVisibility(r) {
    if (!this.gridEl) return;
    const strips = this.doc.textRows?.[r] || [];
    const hidden = new Set();
    for (const s of strips) {
      const end = s.endCol ?? s.startCol;
      for (let c = s.startCol; c <= end; c++) hidden.add(c);
    }
    for (let c = 0; c < this.doc.cols; c++) {
      const el = this.gridEl.children[r * this.doc.cols + c];
      if (el) el.style.visibility = hidden.has(c) ? 'hidden' : '';
    }
  }
}
