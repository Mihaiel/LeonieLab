import { AddOperation } from '../operations/AddOperation.js';
import { MulOperation } from '../operations/MulOperation.js';
import { SubOperation } from '../operations/SubOperation.js';
import { DivOperation } from '../operations/DivOperation.js';
import { FractionOperation } from '../operations/FractionOperation.js';

export class OperationManager {
  constructor(doc) {
    this.doc = doc;      // Document is the single source of truth for ranges
    this.active = null;  // { op: '+', row, anchorCol }

    // Shared instance of DivOperation for state management
    const divOp = new DivOperation();

    this.registry = {
      '+': new AddOperation(),
      '*': new MulOperation(),
      'x': new MulOperation(),
      'X': new MulOperation(),
      ':': divOp,                      // ':' is long division
      '/': new FractionOperation(),    // '/' is Bruchrechnung (stacked fraction)
      '-': new SubOperation(),
    };
    // resultRanges is now backed by doc.operationRanges — no separate array.
    // Audio hook: assign a function(verdict: 'correct'|'wrong') to receive feedback events.
    this.onVerdict = null;
  }

  // Proxy resultRanges through doc so the data survives mount() / renderAll().
  get resultRanges() { return this.doc?.operationRanges ?? []; }
  set resultRanges(v) { if (this.doc) this.doc.operationRanges = v; }

  begin(op, row, anchorCol) {
    // Reset the relevant strategy's transient state when (re)starting an op.
    // ':' → long division (jumping state); '/' → fraction (no-op).
    if (this.registry[op]?.resetState) this.registry[op].resetState(this);
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
    // Locked ranges are final — never re-enter edit mode on a correct answer.
    const r = this.resultRanges.find(r => !r.locked && r.row === row && col >= r.startCol && col <= r.endCol);
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

  // Fractions/mixed numbers: a GROUP of stacked fields validated as a unit.
  if (this.active.kind === 'fraction-part') return this._handleFractionPartDigit(doc, grid, digit);

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
      if (!ok) this.onVerdict?.('wrong');
    }

    if (ok) {
      this.onVerdict?.('correct');

      // Lock only the CHECK zone (not the whole wide box)
      this.markRangeLocked(grid, row, checkStart, checkEnd);

      // Persist locked zone cols so applyAllDecorations() can restore them after re-renders
      this.resultRanges = this.resultRanges.map(r =>
        (r.row === row && r.startCol === startCol && r.endCol === endCol)
          ? { ...r, locked: true, lockedStartCol: checkStart, lockedEndCol: checkEnd }
          : r
      );

      this.active = null;
      return true;
    }
  }
  
  return true;
}

  // --- Fraction / mixed-number answer entry (grouped fields) ---
  // All fields share a boxRange (kind 'fraction') and carry kind:'fraction-part'
  // + an ordering `seq`. The cursor auto-advances seq → seq+1; the answer is
  // only checked / locked / dinged once EVERY field is filled.
  _sameBox(a, b) {
    return a && b && a.topRow === b.topRow && a.resRow === b.resRow &&
           a.startCol === b.startCol && a.endCol === b.endCol;
  }
  _fractionGroup(box) {
    return this.resultRanges
      .filter(r => r.kind === 'fraction-part' && r.boxRange && this._sameBox(r.boxRange, box))
      .sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));
  }
  _fieldFilled(doc, f)  { return this.isResultFilled(doc, f.row, f.startCol, f.endCol); }
  _fieldCorrect(doc, f) {
    const typed    = this.collectString(doc, f.row, f.startCol, f.endCol);
    const expected = this.buildExpected(f.correctDigits, f.correctStartCol, f.startCol, f.endCol);
    return typed === expected;
  }

  _handleFractionPartDigit(doc, grid, digit) {
    const a   = this.active;
    const box = a.boxRange;
    const fields = this._fractionGroup(box);

    // Clear any prior red/blue across the whole group as the student resumes typing.
    for (const f of fields) this.clearResultClasses(grid, f.row, f.startCol, f.endCol);

    if (a.cursorCol < a.startCol || a.cursorCol > a.endCol) return false;
    doc.setCell(a.row, a.cursorCol, digit);
    grid?.updateCell?.(a.row, a.cursorCol);
    a.cursorCol = Math.max(a.startCol, a.cursorCol - 1);

    // Still filling the current field → keep typing here.
    if (!this._fieldFilled(doc, a)) return true;

    // Current field full → jump to the next not-yet-filled field (by seq).
    const next = fields.find(f => !this._fieldFilled(doc, f));
    if (next) {
      this.active = { op: 'result', ...next, cursorCol: next.endCol };
      return true;
    }

    // Every field filled → validate the answer as a UNIT.
    const allOk = fields.every(f => this._fieldCorrect(doc, f));
    for (const f of fields) {
      this.applyResultClass(grid, f.row, f.startCol, f.endCol,
        allOk ? 'result-correct' : (this._fieldCorrect(doc, f) ? 'result-correct' : 'result-wrong'));
    }
    if (allOk) {
      for (const f of fields) this.markRangeLocked(grid, f.row, f.startCol, f.endCol);
      this.resultRanges = this.resultRanges.map(r =>
        (r.kind === 'fraction-part' && r.boxRange && this._sameBox(r.boxRange, box))
          ? { ...r, locked: true, lockedStartCol: r.startCol, lockedEndCol: r.endCol }
          : r
      );
      this.onVerdict?.('correct');
      this.active = null;
    } else {
      this.onVerdict?.('wrong');
      // Stay on the current field; ArrowUp/Down lets the student reach any
      // field to correct it (handled in ApplicationLogic).
    }
    return true;
  }

  // True when (row,col) sits inside a fraction block but NOT inside one of its
  // still-unlocked answer fields — i.e. an operand cell, the '=' cell, or an
  // already-locked answer. Such cells are read-only: to change the problem the
  // student deletes the whole block (Backspace).
  isFractionCellProtected(row, col) {
    for (const r of this.resultRanges) {
      const b = r.boxRange;
      if (!b || b.kind !== 'fraction') continue;
      const inBox = row >= b.topRow && row <= b.resRow && col >= b.startCol && col <= b.endCol;
      if (!inBox) continue;
      const inUnlockedField = this.resultRanges.some(rr =>
        !rr.locked && rr.boxRange && this._sameBox(rr.boxRange, b) &&
        rr.row === row && col >= rr.startCol && col <= rr.endCol
      );
      return !inUnlockedField;
    }
    return false;
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

  reset() {
    this.active = null;
    if (this.doc) this.doc.operationRanges = [];
    // reset division state in DivOperation (now keyed by ':')
    if (this.registry[':']) {
      this.registry[':'].resetState?.(this);
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

  
  // Returns { scratchRow, aRow } if (row, col) is on the A-row of a box that has a scratch range.
  getScratchForCell(row, col) {
    for (const r of this.resultRanges) {
      const b = r.boxRange;
      if (!b || b.scratchRow == null) continue;
      const ss = b.scratchStart ?? b.startCol;
      const se = b.scratchEnd   ?? b.endCol;
      if (row === b.topRow && col >= ss && col <= se) {
        return { scratchRow: b.scratchRow, aRow: b.topRow };
      }
    }
    return null;
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
