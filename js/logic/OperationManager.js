import { AddOperation } from '../operations/AddOperation.js';
import { MulOperation } from '../operations/MulOperation.js';
import { SubOperation } from '../operations/SubOperation.js';
import { DivOperation } from '../operations/DivOperation.js';

export class OperationManager {
  constructor() {
    this.active = null; // { op: '+', row, anchorCol }
    
    // Shared instance of DivOperation for state management
    const divOp = new DivOperation(); 
    
    this.registry = { 
      '+': new AddOperation(),
      '*': new MulOperation(),
      'x': new MulOperation(),
      'X': new MulOperation(),
      '/': divOp, //  same instance for both '/' and ':'
      ':': divOp,
      '-': new SubOperation(),
    };
    this.resultRanges = [];
  }

  begin(op, row, anchorCol) { 
    if((op === '/' || op === ':') && this.registry['/']) {
      this.registry['/'].resetState?.(this);
    }    
    this.active = { op, row, anchorCol }; 
  }
  
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
  const entry = (typeof range.entryCol === 'number') ? range.entryCol : range.endCol;
  this.active = { op: 'result', ...range, cursorCol: entry };
  }

  handleResultDigit(doc, grid, digit) {
  if (!this.active || this.active.op !== 'result') return false;

  const { row, cursorCol, startCol, endCol, correctDigits, correctStartCol } = this.active;
  if (cursorCol < startCol || cursorCol > endCol) return false;

  // Always clear classes for the whole editable range (visual cleanup)
  this.clearResultClasses(grid, row, startCol, endCol);

  doc.setCell(row, cursorCol, digit);
  grid?.updateCell?.(row, cursorCol);

  // Move left (school-style typing)
  this.active.cursorCol = Math.max(startCol, cursorCol - 1);

  // For multiplication we only check the real digit zone (right side).
  // For addition, checkStart/checkEnd are undefined -> fallback to full range.
  const checkStart = (typeof this.active.checkStartCol === 'number') ? this.active.checkStartCol : startCol;
  const checkEnd   = (typeof this.active.checkEndCol === 'number')   ? this.active.checkEndCol   : endCol;

  // Only require the CHECK zone to be filled (do not wait for the full box)
  if (this.isResultFilled(doc, row, checkStart, checkEnd)) {
    const typed = this.collectString(doc, row, checkStart, checkEnd);
    const expected = this.buildExpected(correctDigits, correctStartCol, checkStart, checkEnd);
    const ok = (typed === expected);

    const kind = this.active.kind; // 'partial' | 'final' | undefined

    if (kind === 'partial') {
      // Multiplication partial: never show red
      if (ok) this.applyResultClass(grid, row, checkStart, checkEnd, 'result-correct');
      else this.clearResultClasses(grid, row, checkStart, checkEnd);
    } else {
      // Default behavior (addition + multiplication final): blue if correct, red if wrong
      this.applyResultClass(grid, row, checkStart, checkEnd, ok ? 'result-correct' : 'result-wrong');
    }

    if (ok) {
      // Lock only the CHECK zone (not the whole wide box)
      this.markRangeLocked(grid, row, checkStart, checkEnd);

      // Keep your existing locked bookkeeping
      this.resultRanges = this.resultRanges.map(r =>
        (r.row === row && r.startCol === startCol && r.endCol === endCol) ? { ...r, locked: true } : r
      );

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

  reset() { this.active = null; 
            this.resultRanges = [];
            //reset division state in DivOperation
            if (this.registry['/']) {
              this.registry['/'].resetState?.(this);
            }
          }

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
      const idx = row * (grid?.doc?.cols ?? 0) + c;
      const el = grid.gridEl.children[idx];
      if (!el) continue;
      el.classList.add('result-correct');
      el.dataset.locked = '1';
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
