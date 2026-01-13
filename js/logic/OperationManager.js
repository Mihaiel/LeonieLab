import { AddOperation } from '../operations/AddOperation.js';

export class OperationManager {
  constructor() {
    this.active = null; // { op: '+', row, anchorCol }
    this.registry = { '+': new AddOperation() };
    this.resultRanges = [];
  }

  begin(op, row, anchorCol) { this.active = { op, row, anchorCol }; }
  clearActive() { this.active = null; }

  formatActive(doc, grid) {
    if (!this.active) return;
    const strat = this.registry[this.active.op];
    let res;
    if (strat && typeof strat.format === 'function') {
      try { res = strat.format(doc, grid, this.active, this); } catch {}
    }
    this.clearActive();
    return res;
  }

  addResultRange(range) {
    if (!range) return;
    const exists = this.resultRanges.some(r => r.row === range.row && r.startCol === range.startCol && r.endCol === range.endCol);
    if (!exists) this.resultRanges.push({ ...range });
  }

  tryResumeResultAtCursor(row, col) {
    if (this.active && this.active.op === 'result') return true;
    const r = this.resultRanges.find(r => r.row === row && col >= r.startCol && col <= r.endCol);
    if (!r) return false;
    this.beginResultEntry(r);
    this.active.cursorCol = col;
    return true;
  }

  beginResultEntry(range) {
    this.active = { op: 'result', ...range, cursorCol: range.endCol };
  }

  handleResultDigit(doc, grid, digit) {
    if (!this.active || this.active.op !== 'result') return false;
    const { row, cursorCol, startCol, endCol, correctDigits, correctStartCol } = this.active;
    if (cursorCol < startCol || cursorCol > endCol) return false;
    this.clearResultClasses(grid, row, startCol, endCol);
    doc.setCell(row, cursorCol, digit);
    grid?.updateCell?.(row, cursorCol);
    this.active.cursorCol = Math.max(startCol, cursorCol - 1);
    if (this.isResultFilled(doc, row, startCol, endCol)) {
      const typed = this.collectString(doc, row, startCol, endCol);
      const expected = this.buildExpected(correctDigits, correctStartCol, startCol, endCol);
      const ok = (typed === expected);
      this.applyResultClass(grid, row, startCol, endCol, ok ? 'result-correct' : 'result-wrong');
      if (ok) {
        this.markRangeLocked(grid, row, startCol, endCol);
        this.resultRanges = this.resultRanges.map(r => (r.row === row && r.startCol === startCol && r.endCol === endCol) ? { ...r, locked: true } : r);
        this.active = null;
        return true;
      }
    }
    return true;
  }

  handleResultBackspace(doc, grid) {
    if (!this.active || this.active.op !== 'result') return false;
    const { row, cursorCol, startCol, endCol } = this.active;
    doc.setCell(row, cursorCol, '');
    grid?.updateCell?.(row, cursorCol);
    this.clearResultClasses(grid, row, startCol, endCol);
    this.active.cursorCol = Math.min(endCol, cursorCol + 1);
    return true;
  }

  updateResultCursor(row, col) {
    if (!this.active || this.active.op !== 'result') return;
    if (row !== this.active.row || col < this.active.startCol || col > this.active.endCol) {
      this.active = null;
      return;
    }
    this.active.cursorCol = col;
  }

  reset() { this.active = null; this.resultRanges = []; }

  // helpers
  clearResultClasses(grid, row, startCol, endCol) {
    if (!grid?.gridEl) return;
    for (let c = startCol; c <= endCol; c++) {
      const idx = row * (grid?.doc?.cols ?? 0) + c;
      const el = grid.gridEl.children[idx];
      if (el) el.classList.remove('result-correct', 'result-wrong');
    }
  }
  isResultFilled(doc, row, startCol, endCol) {
    for (let c = startCol; c <= endCol; c++) if (!doc.getCell(row, c)?.char) return false;
    return true;
  }
  collectString(doc, row, startCol, endCol) {
    let s = ''; for (let c = startCol; c <= endCol; c++) s += (doc.getCell(row, c)?.char || ''); return s;
  }
  buildExpected(correctDigits, correctStartCol, startCol, endCol) {
    if (!correctDigits || typeof correctStartCol !== 'number') return ''.padStart(endCol - startCol + 1, ' ');
    const width = endCol - startCol + 1; const padLeft = correctStartCol - startCol;
    return ''.padStart(padLeft, ' ') + correctDigits.padEnd(width - padLeft, ' ');
  }
  applyResultClass(grid, row, startCol, endCol, className) {
    if (!grid?.gridEl) return;
    for (let c = startCol; c <= endCol; c++) {
      const idx = row * (grid?.doc?.cols ?? 0) + c; const el = grid.gridEl.children[idx];
      if (!el) continue; el.classList.remove('result-correct', 'result-wrong'); el.classList.add(className);
    }
  }
  markRangeLocked(grid, row, startCol, endCol) {
    if (!grid?.gridEl) return;
    for (let c = startCol; c <= endCol; c++) {
      const idx = row * (grid?.doc?.cols ?? 0) + c; const el = grid.gridEl.children[idx];
      if (!el) continue; el.classList.add('result-correct'); el.dataset.locked = '1';
    }
  }
  isLockedCell(row, col) { return !!this.getLockedRangeAt(row, col); }
  getLockedRangeAt(row, col) {
    const r = this.resultRanges.find(r => r.locked && r.boxRange && (
      (row === r.boxRange.topRow || row === r.boxRange.bRow || row === r.boxRange.resRow) && col >= r.boxRange.startCol && col <= r.boxRange.endCol));
    return r ? { row: r.row, startCol: r.startCol, endCol: r.endCol, boxRange: r.boxRange } : null;
  }
  removeRangeByBox(boxRange){
    if (!boxRange) return;
    this.resultRanges = this.resultRanges.filter(r => {
      const b = r.boxRange; if (!b) return true;
      return !(b.topRow === boxRange.topRow && b.bRow === boxRange.bRow && b.resRow === boxRange.resRow && b.startCol === boxRange.startCol && b.endCol === boxRange.endCol);
    });
  }
}

