/*
  Application Logic
  ---------------------
  Very simple logic for typing into a grid
  Arrow keys move the cursor
  Backspace clears current (or previous) cell
*/

// Recognised measurement units. Pressing ArrowUp on the FINAL letter of one of
// these (typed inline into cells, e.g. "20km") opens a superscript exponent
// overlay so the student can write m², cm², mⁿ, etc. Gating to a known list
// keeps ArrowUp's normal "move up" behaviour on every other letter cell.
// Longest-first so a multi-letter unit matches before its single-letter suffix.
const ALLOWED_UNITS = ['mm', 'cm', 'dm', 'km', 'ml', 'cl', 'dl', 'mg', 'kg', 'min', 'm', 'l', 'g', 't', 's', 'h'];

// Maximum exponent length — up to two characters (e.g. "2", "10", "n").
const MAX_EXPONENT_LEN = 2;

// OPERATION STUB HOOK left below for later features
export class ApplicationLogic {
  constructor(doc, grid, opManager = null) {
    this.doc = doc;   // the data model (rows, cols, grid)
    this.grid = grid; // the renderer (updates UI)
    this.cursor = { row: 0, col: 0 };
    this.opManager = opManager; // optional; injected to keep concerns separated
    this.scratchMode = null;   // { scratchRow, aRow, col } when editing a scratch overlay
    this.textRowMode = null;   // { row, startCol, cursorPos } when editing a text strip
    this.unitExpMode = null;   // { row, col } when editing a unit exponent overlay (m², cm², mⁿ)
    // Optional callback fired whenever a keystroke is absorbed as "rejected"
    // (unhandled key, non-digit inside result-entry, ArrowUp with no scratch
    // row, ArrowDown in result-entry, etc.). main.js hooks this to
    // AudioFeedback.rejected() so students get an unmistakable "that did
    // nothing" click instead of silent failures.
    this.onRejected = null;
  }

  _reject() {
    try { this.onRejected?.(); } catch (_) {}
  }

  // Find the text strip on (row, col), or null. Strips are identified by their
  // stable startCol — once a strip is created it never changes startCol.
  _findStripAt(row, col) {
    const strips = this.doc.textRows?.[row];
    if (!Array.isArray(strips)) return null;
    return strips.find(s => col >= s.startCol && col <= (s.endCol ?? s.startCol)) || null;
  }

  // Set starting position (top-left)
  init() {
    this.setCursor(0, 0);
  }

  // Keep cursor inside grid and update the highlight
  setCursor(r, c) {
    // Exit scratch mode whenever the cursor moves
    if (this.scratchMode) {
      this.grid?.setScratchCursor?.(this.scratchMode.aRow, this.scratchMode.col, false);
      this.scratchMode = null;
    }
    // Exit text row mode whenever the cursor moves away
    if (this.textRowMode) {
      this.grid?.updateTextRowCursor?.(this.textRowMode.row, this.textRowMode.startCol, null);
      this.textRowMode = null;
    }
    // Exit unit exponent mode whenever the cursor moves away (e.g. via a click).
    // The internal _handleUnitExpKey exit path nulls unitExpMode before calling
    // a move helper, so this guard only fires for external cursor moves.
    if (this.unitExpMode) {
      const { row: er, col: ec } = this.unitExpMode;
      this.grid?.setUnitExpCursor?.(er, ec, false);
      if (!(this.doc.exponents?.[`${er}:${ec}`])) this.grid?.removeUnitExponent?.(er, ec);
      this.unitExpMode = null;
    }
    const row = Math.max(0, Math.min(this.doc.rows - 1, r));
    const col = Math.max(0, Math.min(this.doc.cols - 1, c));
    this.cursor = { row, col };
    if (this.grid && typeof this.grid.updateCursor === 'function') {
      // If a locked result box exists at the cursor, highlight the whole box (three rows)
      const box = this.opManager?.getLockedRangeAt?.(row, col);
      if (box && this.grid.highlightBox && box.boxRange) {
        this.grid.highlightBox(box.boxRange.topRow, box.boxRange.resRow, box.boxRange.startCol, box.boxRange.endCol);
      } else {
        this.grid.updateCursor(row, col);
      }
    }
    // Inform operation manager about cursor changes during result entry
    if (this.opManager && this.opManager.updateResultCursor) {
      this.opManager.updateResultCursor(row, col);
    }
    // Auto-enter text row editing ONLY when cursor lands inside a strip's columns
    const strip = this._findStripAt(row, col);
    if (strip) {
      const str = strip.text ?? '';
      this.textRowMode = { row, startCol: strip.startCol, cursorPos: str.length };
      this.grid?.updateTextRowCursor?.(row, strip.startCol, str.length);
    }
  }

  // Handle a single key (called from main.js)
  handleKey(key) {
    // In scratch mode all keys are routed to the overlay handler
    if (this.scratchMode) return this._handleScratchKey(key);
    // In text row mode all keys are routed to the text row handler
    if (this.textRowMode) return this._handleTextRowKey(key);
    // In unit exponent mode all keys are routed to the exponent handler
    if (this.unitExpMode) return this._handleUnitExpKey(key);
    // 0-9 digits
    if (/^[0-9]$/.test(key)) {
      // If we are in a result-entry phase, let the operation manager handle leftward fill
      if (this.opManager) {
        // If not in result mode but cursor is inside a known result span, resume it to allow fixes
        if ((!this.opManager.active || this.opManager.active.op !== 'result') &&
            this.opManager.tryResumeResultAtCursor?.(this.cursor.row, this.cursor.col)) {
          // resumed; fall-through to handleResultDigit
        }
        const res = this.opManager.handleResultDigit?.(this.doc, this.grid, key);
        if (res) {
          // handleResultDigit manages active (incl. auto-advance between the
          // stacked fields of a fraction/mixed answer); just follow the cursor.
          const a = this.opManager.active; // may be null if finished
          if (a && a.op === 'result') {
            this.setCursor(a.row, a.cursorCol);
          }
          return true;
        }

        // Cells inside a locked fraction block (operands, '=', or an already
        // locked answer) are read-only — the student deletes the block to
        // change it. Reject stray digits so they can't overwrite a solved
        // problem (and still show blue).
        if (this.opManager.isFractionCellProtected?.(this.cursor.row, this.cursor.col)) {
          this._reject();
          return true;
        }
      }

      // Check for division jump BEFORE typing
      const currentRow = this.cursor.row;
      const currentCol = this.cursor.col;
      let jumpTarget = null;
      
      if (this.opManager && this.opManager.registry[':']?.handleCharacterTyped) {
        jumpTarget = this.opManager.registry[':'].handleCharacterTyped(
          this.doc,
          currentRow,
          currentCol,
          this.opManager
        );
      }
      
      // If we have a jump target, write digit WITHOUT moving cursor automatically
      if (jumpTarget) {
        // Write digit at current position
        this.doc.setCell(currentRow, currentCol, key);
        if (this.grid && this.grid.updateCell) {
          this.grid.updateCell(currentRow, currentCol);
        }
        // Jump to the target position
        this.setCursor(jumpTarget.cursorRow, jumpTarget.cursorCol);
      } else {
        // Normal behavior: write and move to next cell
        this.typeDigit(key);
      }
      return true;
    }

    // While a result entry is active the cursor is locked inside the result
    // row. ArrowLeft/Right clamp within [startCol, endCol]; ArrowUp bridges
    // into the carry/borrow scratch row above operand A (and ArrowDown /
    // Enter / Escape inside scratch returns here); ArrowDown is a no-op;
    // Escape cancels the in-progress block; any non-digit/non-Backspace/
    // non-Enter key is swallowed so operators can't start a new op mid-entry.
    const resultActive = this.opManager?.active?.op === 'result';
    if (resultActive) {
      // Fraction / mixed answers: ArrowUp/Down move between the stacked fields
      // (numerator / whole / denominator) so any field can be corrected.
      if (this.opManager.active.kind === 'fraction-part' && (key === 'ArrowUp' || key === 'ArrowDown')) {
        const a = this.opManager.active;
        const byRow = this.opManager._fractionGroup(a.boxRange).slice().sort((x, y) => x.row - y.row);
        const idx = byRow.findIndex(f => f.row === a.row && f.startCol === a.startCol);
        const nf = byRow[key === 'ArrowUp' ? idx - 1 : idx + 1];
        if (nf) {
          this.opManager.active = { op: 'result', ...nf, cursorCol: nf.endCol };
          this.setCursor(nf.row, nf.endCol);
        } else { this._reject(); }
        return true;
      }
      if (key === 'ArrowLeft') {
        const a = this.opManager.active;
        const cur = a.cursorCol ?? a.endCol;
        if (cur <= a.startCol) { this._reject(); return true; }
        a.cursorCol = cur - 1;
        this.setCursor(a.row, a.cursorCol);
        return true;
      }
      if (key === 'ArrowRight') {
        const a = this.opManager.active;
        const cur = a.cursorCol ?? a.endCol;
        if (cur >= a.endCol) { this._reject(); return true; }
        a.cursorCol = cur + 1;
        this.setCursor(a.row, a.cursorCol);
        return true;
      }
      if (key === 'ArrowUp') {
        // Bridge to the carry/borrow scratch row above operand A. Lands on
        // the SAME column the cursor is currently on — the carry/borrow
        // annotation belongs above the column the student is actively
        // working in, not one column over. After writing the scratch digit
        // the student is returned to exactly the same result cell.
        // The target col is clamped into the box's scratch range.
        const a = this.opManager.active;
        const box = a.boxRange;
        if (box && box.scratchRow != null) {
          const ss = box.scratchStart ?? box.startCol;
          const se = box.scratchEnd   ?? box.endCol;
          const cursorCol = a.cursorCol ?? a.endCol;
          const col = Math.min(se, Math.max(ss, cursorCol));
          this.scratchMode = {
            scratchRow: box.scratchRow,
            aRow: box.topRow,
            col,
            returnRow: a.row,
            returnCol: cursorCol,
          };
          this.grid?.setScratchCursor?.(box.topRow, col, true);
        } else {
          // Nothing to bridge to — no carry/borrow row for this box.
          this._reject();
        }
        return true;
      }
      if (key === 'ArrowDown') { this._reject(); return true; }
      if (key === 'Escape') {
        this._deleteOperationBox(this.opManager.active.boxRange);
        return true;
      }
      if (key !== 'Backspace' && key !== 'Enter') { this._reject(); return true; }
    }

    // basic navigation + edit
    switch (key) {
      case 'Backspace':
        // If we are in result entry, handle locally (allow corrections)
        if (this.opManager && this.opManager.handleResultBackspace?.(this.doc, this.grid)) {
          const a = this.opManager.active;
          if (a && a.op === 'result') this.setCursor(a.row, a.cursorCol);
        } else {
          // If a locked box is selected, delete the whole box
          const box = this.opManager?.getLockedRangeAt?.(this.cursor.row, this.cursor.col);
          if (box && box.boxRange) {
            this._deleteOperationBox(box.boxRange);
          } else {
            this.erase();
          }
        }
        return true;
      case 'ArrowLeft': this.moveLeft(); return true;
      case 'ArrowRight': this.moveRight(); return true;
      case 'ArrowUp': {
        const scratch = this.opManager?.getScratchForCell?.(this.cursor.row, this.cursor.col);
        if (scratch) {
          // Enter scratch mode for this cell's overlay
          this.scratchMode = { scratchRow: scratch.scratchRow, aRow: this.cursor.row, col: this.cursor.col };
          this.grid?.setScratchCursor?.(this.cursor.row, this.cursor.col, true);
        } else if (this._enterUnitExpMode(this.cursor.row, this.cursor.col)) {
          // Entered unit-exponent mode on a recognised unit. Digit cells take
          // the scratch path above; unit cells (letters) never overlap with it,
          // so the two ArrowUp behaviours can't collide.
        } else {
          this.moveUp();
        }
        return true;
      }
      case 'ArrowDown': this.moveDown(); return true;
    }

    // Operator '-' begins a subtraction operation at the current cursor  
    if (key === '-' && this.opManager) {
      const { row, col } = this.cursor;
      this.opManager.begin('-', row, col);
      this.doc.setCell(row, col, '-');
      this.grid?.updateCell?.(row, col);
      this.nextCell();
      return true;
    }

    // Operator '+' begins an addition operation at the current cursor
    if (key === '+' && this.opManager) {
      const { row, col } = this.cursor;
      this.opManager.begin('+', row, col);
      this.doc.setCell(row, col, '+');
      this.grid?.updateCell?.(row, col);
      this.nextCell();
      return true;
    }

    // Operator '*' begins a multiplication operation at the current cursor
    if ((key === '*' || key === 'x' || key === 'X') && this.opManager) {
      const { row, col } = this.cursor;
      this.opManager.begin(key, row, col);     // begin with the typed key
      this.doc.setCell(row, col, key);         // store it so parseAround() can find it
      this.grid?.updateCell?.(row, col);
      this.nextCell();
      return true;
    }

  // Enter in result mode: always move one row down under the LAST digit of B
  if (key === 'Enter' && this.opManager && this.opManager.active && this.opManager.active.op === 'result') {
    const cur = this.opManager.active;

    const sameBox = (a, b) =>
      a && b &&
      a.topRow === b.topRow &&
      a.bRow === b.bRow &&
      a.resRow === b.resRow &&
      a.startCol === b.startCol &&
      a.endCol === b.endCol;

    const targetRow = cur.row + 1;

    // Find range on the next row in the same multiplication task
    const nextRange = (this.opManager.resultRanges || []).find(r =>
      r.row === targetRow &&
      r.boxRange && cur.boxRange &&
      sameBox(r.boxRange, cur.boxRange)
    );

    if (nextRange) {
      this.opManager.beginResultEntry(nextRange);

      // CRITICAL PART:
      // Always jump to the column of the LAST digit of B (right edge)
      this.setCursor(nextRange.row, nextRange.endCol);
    }
    
    return true;
  }

    // Operator '/' or ':' begins a division operation at the current cursor
    if ((key === '/' || key === ':') && this.opManager) {
      const { row, col } = this.cursor;
      this.opManager.begin(key, row, col);
      this.doc.setCell(row, col, key);
      this.grid?.updateCell?.(row, col);
      this.nextCell();
      return true;
}

    // Enter formats the active operation (if any)
    if (key === 'Enter' && this.opManager) {
      const next = this.opManager.formatActive(this.doc, this.grid);
      if (next && next.resultRange) {
    // 1) store ALL ranges (partials + final)
      if (this.opManager.addResultRange) {
        this.opManager.addResultRange({ ...next.resultRange, boxRange: next.boxRange });

      if (Array.isArray(next.extraResultRanges)) {
        for (const r of next.extraResultRanges) {
          this.opManager.addResultRange({ ...r, boxRange: next.boxRange });
        }
      }
    }

    // 2) start result entry on first range
      if (this.opManager.beginResultEntry) {
        this.opManager.beginResultEntry({ ...next.resultRange, boxRange: next.boxRange });
      }
    // 3) cursor must start at entryCol (shifted), otherwise it looks wrong
        this.setCursor(next.resultRange.row, next.resultRange.endCol);

    return true;
  }

      if (next && Number.isInteger(next.cursorRow) && Number.isInteger(next.cursorCol)) {
        this.setCursor(next.cursorRow, next.cursorCol);
      }
      return true;
    }

    // Caret '^' is a convenience trigger for unit exponents (alongside ArrowUp):
    // on — or just past — a recognised unit it opens the superscript overlay
    // rather than typing a literal caret. With no unit nearby it falls through
    // to the rejection path below.
    if (key === '^' && this._enterUnitExpMode(this.cursor.row, this.cursor.col)) {
      return true;
    }

    // Equals sign and free-form punctuation — written as literal characters
    // at the cursor so the student can hand-author their own operations
    // (e.g. "5+3=8", "1,5", "0.25", "3+?=5", "(2+3)·4", "[1,5]"). Unlike
    // +, -, *, : these do NOT trigger the formatter and do NOT start a new
    // operation. Absorbed inside result-entry mode by the lock guard above,
    // so they only reach here when the student is typing freely.
    if (
      key === '=' || key === ',' || key === '.' || key === '?' ||
      key === '(' || key === ')' || key === '[' || key === ']'
    ) {
      this.typeDigit(key);
      return true;
    }

    // Letters — for units and annotations (kg, cm, km, ml, t, etc.)
    // x and X are already handled above as multiplication operators and won't reach here.
    // During result-entry mode only digits are valid, so letters are ignored there.
    if (/^[a-zA-Z]$/.test(key)) {
      if (this.opManager?.active?.op === 'result') return false;
      // Auto-detect text row: start a new text strip at the cursor
      if (this._shouldStartTextRow()) {
        const r   = this.cursor.row;
        const col = this.cursor.col;
        if (!this.doc.textRows) this.doc.textRows = {};
        if (!Array.isArray(this.doc.textRows[r])) this.doc.textRows[r] = [];
        this.doc.textRows[r].push({ text: key, startCol: col, endCol: col });
        this.doc.textRows[r].sort((a, b) => a.startCol - b.startCol);
        this.textRowMode = { row: r, startCol: col, cursorPos: 1 };
        this.grid?.setTextRow?.(r, key, 1, col);
        return true;
      }
      this.typeDigit(key);
      return true;
    }

    // Modifier-only presses (Shift, Alt, Control, Meta, CapsLock, etc.)
    // are not actionable — silently ignore them without rejection audio.
    const modifiers = ['Shift','Control','Alt','Meta','CapsLock','NumLock','ScrollLock'];
    if (modifiers.includes(key)) return false;

    // Nothing in handleKey wanted this key — give the student an audible
    // "that did nothing" and let main.js pop the unused undo snapshot.
    this._reject();
    return false; // unhandled key
  }

  // Returns true when typing a letter should auto-create a text row.
  // Conditions: not on a locked block, cursor not already inside an existing
  // strip, and the cell immediately to the left is empty. The only operation
  // state that blocks text strips is active result-entry — and that's already
  // enforced upstream by the handleKey lock guard, which absorbs letters
  // before they ever reach here. A pending (typed-but-not-yet-formatted) op
  // like "530km+30km=" does NOT block strips: once the student moves to a
  // fresh empty area of the same (or another) row, they can still start
  // annotations. "20km" inline still types literals because col-1 holds "0".
  _shouldStartTextRow() {
    const { row, col } = this.cursor;
    if (this.opManager?.getLockedRangeAt?.(row, col)) return false;
    if (this._findStripAt(row, col)) return false;
    if (col > 0 && this.doc.getCell(row, col - 1)?.char) return false;
    return true;
  }

  // Handle key input while a scratch overlay is active
  _handleScratchKey(key) {
    const { scratchRow, aRow, col, returnRow, returnCol } = this.scratchMode;

    // Exit helper — when scratch was entered from a locked result row the
    // cursor returns to (returnRow, returnCol), i.e. the exact result cell
    // the student was on before pressing ArrowUp (NOT the scratch column,
    // which sits one cell to the right). Classic scratch entry (no return
    // fields) falls back to (aRow, col).
    const exitScratch = () => {
      this.grid?.setScratchCursor?.(aRow, col, false);
      const backRow = returnRow != null ? returnRow : aRow;
      const backCol = returnRow != null ? (returnCol ?? col) : col;
      this.scratchMode = null;
      this.setCursor(backRow, backCol);
    };

    if (/^[0-9]$/.test(key)) {
      this.doc.setCell(scratchRow, col, key);
      this.grid?.updateCell?.(scratchRow, col);
      // When entered from a result row, auto-return after writing one digit
      // so the student doesn't need a follow-up ArrowDown.
      if (returnRow != null) exitScratch();
      return true;
    }

    if (key === 'Backspace') {
      const current = this.doc.getCell(scratchRow, col)?.char || '';
      if (current) {
        this.doc.setCell(scratchRow, col, '');
        this.grid?.updateCell?.(scratchRow, col);
      } else {
        // Empty overlay — exit scratch mode without deleting anything
        exitScratch();
      }
      return true;
    }

    if (key === 'ArrowDown' || key === 'Enter' || key === 'Escape') {
      exitScratch();
      return true;
    }

    if (key === 'ArrowLeft') {
      const newCol = col - 1;
      const scratch = this.opManager?.getScratchForCell?.(aRow, newCol);
      if (scratch && scratch.scratchRow === scratchRow) {
        this.grid?.setScratchCursor?.(aRow, col, false);
        this.scratchMode = { scratchRow, aRow, col: newCol, returnRow, returnCol };
        this.grid?.setScratchCursor?.(aRow, newCol, true);
      } else {
        this._reject();
      }
      return true;
    }

    if (key === 'ArrowRight') {
      const newCol = col + 1;
      const scratch = this.opManager?.getScratchForCell?.(aRow, newCol);
      if (scratch && scratch.scratchRow === scratchRow) {
        this.grid?.setScratchCursor?.(aRow, col, false);
        this.scratchMode = { scratchRow, aRow, col: newCol, returnRow, returnCol };
        this.grid?.setScratchCursor?.(aRow, newCol, true);
      } else {
        this._reject();
      }
      return true;
    }

    if (key === 'ArrowUp') {
      this._reject();
      return true;
    }

    return false;
  }

  // Handle key input while a text row is active
  _handleTextRowKey(key) {
    const { row, startCol, cursorPos } = this.textRowMode;
    const strips = this.doc.textRows?.[row];
    const entry  = Array.isArray(strips) ? strips.find(s => s.startCol === startCol) : null;
    if (!entry) { this.textRowMode = null; return false; }
    const str    = entry.text ?? '';
    const endCol = entry.endCol ?? startCol;

    // Treat the text strip as a single cell — all arrow keys exit and move the grid cursor
    if (key === 'ArrowLeft') {
      this.textRowMode = null;
      this.grid?.updateTextRowCursor?.(row, startCol, null);
      this.setCursor(row, startCol - 1);
      return true;
    }
    if (key === 'ArrowRight') {
      this.textRowMode = null;
      this.grid?.updateTextRowCursor?.(row, startCol, null);
      this.setCursor(row, endCol + 1);
      return true;
    }
    if (key === 'ArrowUp') {
      this.textRowMode = null;
      this.grid?.updateTextRowCursor?.(row, startCol, null);
      this.setCursor(row - 1, startCol);
      return true;
    }
    if (key === 'ArrowDown' || key === 'Enter') {
      this.textRowMode = null;
      this.grid?.updateTextRowCursor?.(row, startCol, null);
      this.setCursor(row + 1, startCol);
      return true;
    }
    // Escape — exit without moving
    if (key === 'Escape') {
      this.textRowMode = null;
      this.grid?.updateTextRowCursor?.(row, startCol, null);
      return true;
    }

    // Backspace
    if (key === 'Backspace') {
      if (cursorPos > 0) {
        const newStr = str.slice(0, cursorPos - 1) + str.slice(cursorPos);
        entry.text = newStr;
        const newPos = cursorPos - 1;
        this.textRowMode.cursorPos = newPos;
        this.grid?.setTextRow?.(row, newStr, newPos, startCol);
      } else if (str.length === 0) {
        // Empty strip + Backspace at start → remove just this strip
        const idx = strips.indexOf(entry);
        if (idx >= 0) strips.splice(idx, 1);
        if (strips.length === 0) delete this.doc.textRows[row];
        this.textRowMode = null;
        this.grid?.removeTextRow?.(row, startCol);
      }
      return true;
    }

    // Any printable character
    if (key.length === 1) {
      const newStr = str.slice(0, cursorPos) + key + str.slice(cursorPos);
      entry.text = newStr;
      const newPos = cursorPos + 1;
      this.textRowMode.cursorPos = newPos;
      this.grid?.setTextRow?.(row, newStr, newPos, startCol);
      return true;
    }

    return false;
  }

  // Returns the recognised unit string ending at (row, col) — i.e. (row, col)
  // is the LAST letter of an inline unit — or null. Requires the cell to hold a
  // letter, the cell to its right to NOT be a letter (so the superscript sits
  // at the unit's right edge, where m² belongs), and the maximal contiguous
  // letter-run ending here to exactly match an allowed unit (case-insensitive).
  _unitEndingAt(row, col) {
    const isLetter = (r, c) => /^[a-zA-Z]$/.test(this.doc.getCell(r, c)?.char || '');
    if (!isLetter(row, col)) return null;
    if (col + 1 < this.doc.cols && isLetter(row, col + 1)) return null;
    let start = col;
    while (start > 0 && isLetter(row, start - 1)) start--;
    let run = '';
    for (let c = start; c <= col; c++) run += this.doc.getCell(row, c).char;
    return ALLOWED_UNITS.includes(run.toLowerCase()) ? run : null;
  }

  // Try to enter unit-exponent mode for a unit at — or just left of — (row, col).
  // Returns true if entered. Right after typing a unit the cursor rests ONE
  // cell to its right (e.g. "20km" leaves the cursor on the empty cell past the
  // "m"), so when the cursor cell is empty we fall back to the unit ending at
  // col-1. This makes the natural "type the unit, press ↑" gesture work without
  // a manual ← first. The visible cursor is moved onto the unit's last letter so
  // the active superscript and the cursor stay together.
  _enterUnitExpMode(row, col) {
    let target = null;
    if (this._unitEndingAt(row, col)) {
      target = { row, col };
    } else if (!(this.doc.getCell(row, col)?.char) && col > 0 && this._unitEndingAt(row, col - 1)) {
      target = { row, col: col - 1 };
    }
    if (!target) return false;
    if (target.row !== this.cursor.row || target.col !== this.cursor.col) {
      this.setCursor(target.row, target.col); // safe: no mode active in this path
    }
    this.unitExpMode = { row: target.row, col: target.col };
    this.grid?.setUnitExpCursor?.(target.row, target.col, true);
    return true;
  }

  // Handle key input while a unit exponent overlay is active (m², cm², mⁿ).
  // Behaves like a tiny one-cell editor: alphanumeric chars append (capped at
  // MAX_EXPONENT_LEN), Backspace deletes / exits when already empty, Enter and
  // Escape exit in place, and any arrow exits then performs the normal cursor
  // move so the student "navigates out like usual". Everything else is rejected.
  _handleUnitExpKey(key) {
    const { row, col } = this.unitExpMode;
    const k = `${row}:${col}`;
    if (!this.doc.exponents) this.doc.exponents = {};
    const current = this.doc.exponents[k] || '';

    const exit = () => {
      this.grid?.setUnitExpCursor?.(row, col, false);
      if (!this.doc.exponents[k]) this.grid?.removeUnitExponent?.(row, col);
      this.unitExpMode = null;
    };

    // Up to two characters, digits or letters (e.g. 2, 10, n).
    if (/^[a-zA-Z0-9]$/.test(key)) {
      if (current.length >= MAX_EXPONENT_LEN) { this._reject(); return true; }
      this.doc.exponents[k] = current + key;
      this.grid?.updateUnitExponent?.(row, col);
      return true;
    }

    if (key === 'Backspace') {
      if (current.length > 0) {
        const next = current.slice(0, -1);
        if (next) this.doc.exponents[k] = next; else delete this.doc.exponents[k];
        this.grid?.updateUnitExponent?.(row, col);
      } else {
        delete this.doc.exponents[k];
        exit();
      }
      return true;
    }

    if (key === 'Enter' || key === 'Escape') { exit(); return true; }
    if (key === 'ArrowDown')  { exit(); this.moveDown();  return true; }
    if (key === 'ArrowLeft')  { exit(); this.moveLeft();  return true; }
    if (key === 'ArrowRight') { exit(); this.moveRight(); return true; }
    if (key === 'ArrowUp')    { exit(); this.moveUp();    return true; }

    this._reject();
    return true;
  }

  // Drop any unit exponent attached to (row, col) — called when the cell's
  // character is cleared or overwritten so a superscript never outlives its unit.
  _dropExponentAt(row, col) {
    const k = `${row}:${col}`;
    if (this.doc.exponents && this.doc.exponents[k]) {
      delete this.doc.exponents[k];
      this.grid?.removeUnitExponent?.(row, col);
    }
  }

  // Delete an entire operation block (locked OR in-progress). Clears every
  // cell inside the box, strips result/lock classes, wipes the carry/borrow
  // scratch row, removes underlines, drops the range(s) from OperationManager,
  // and nulls active if it pointed at this box. The cursor lands at the
  // box's top-left corner so the student has a sensible starting point.
  _deleteOperationBox(boxRange) {
    if (!boxRange) return;
    const { topRow, bRow, resRow, startCol, endCol } = boxRange;

    for (let r = topRow; r <= resRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        this.doc.setCell(r, c, '');
        this.grid?.updateCell?.(r, c);
        const idx = r * this.doc.cols + c;
        const el = this.grid?.gridEl?.children?.[idx];
        if (el) {
          el.classList.remove('result-correct', 'result-wrong', 'box-selected');
          if (el.dataset) delete el.dataset.locked;
        }
      }
    }

    // Carry/borrow scratch row cleanup
    if (boxRange.scratchRow != null) {
      const sr = boxRange.scratchRow;
      const ss = boxRange.scratchStart ?? startCol;
      const se = boxRange.scratchEnd ?? endCol;
      for (let c = ss; c <= se; c++) this.doc.setCell(sr, c, '');
      for (let c = ss; c <= se; c++) {
        const aIdx = topRow * this.doc.cols + c;
        const aEl = this.grid?.gridEl?.children?.[aIdx];
        if (aEl) aEl.querySelectorAll(`.scratch-overlay[data-scratch-row="${sr}"]`).forEach(ov => ov.remove());
      }
      const otherUses = (this.opManager?.resultRanges || []).filter(r =>
        r.boxRange?.scratchRow === sr && r.boxRange !== boxRange
      );
      if (otherUses.length === 0) this.grid?.scratchRows?.delete(sr);
    }

    // Underlines (Add/Sub store underlineStart because plusCol/minusCol can
    // sit left of the underline start, making startCol-based removal wrong).
    const ulStart = boxRange.underlineStart ?? startCol;
    this.grid?.removeUnderline?.(bRow, ulStart, endCol);
    if (boxRange.underline2Row != null) {
      const u2r = boxRange.underline2Row;
      const u2s = boxRange.underline2Start ?? startCol;
      const u2e = boxRange.underline2End ?? endCol;
      this.grid?.removeUnderline?.(u2r, u2s, u2e);
    }

    // Fraction bars + operand text overlays belonging to this box (Bruchrechnung)
    const inBox = (o) => o.row >= topRow && o.row <= resRow && !(o.endCol < startCol || o.startCol > endCol);
    if (this.doc.fractionBars?.length) {
      for (const b of this.doc.fractionBars.filter(inBox)) this.grid?.removeFractionBar?.(b.row, b.startCol, b.endCol);
    }
    if (this.doc.fractionTexts?.length) {
      for (const t of this.doc.fractionTexts.filter(inBox)) this.grid?.removeFractionText?.(t.row, t.startCol, t.endCol);
    }

    // Manager cleanup + exit any in-progress result entry pointing at this box
    if (this.opManager?.removeRangeByBox) this.opManager.removeRangeByBox(boxRange);
    if (this.opManager?.active?.op === 'result' && this.opManager.active.boxRange === boxRange) {
      this.opManager.active = null;
    }

    this.setCursor(topRow, startCol);
  }

  // Put a digit into current cell and go to next cell
  writeDigit(ch) {
    const { row, col } = this.cursor;
    this._dropExponentAt(row, col); // overwriting a unit drops its exponent
    this.doc.setCell(row, col, ch);
    if (this.grid && this.grid.updateCell) {
      this.grid.updateCell(row, col);
    }
    this.nextCell();
  }

  // compatibility alias for older code paths
  typeDigit(ch) { this.writeDigit(ch); }

  // Clear current (if non-empty) or previous cell and move cursor accordingly
  erase() {
    let { row, col } = this.cursor;
    const cell = this.doc.getCell(row, col);
    if (cell && cell.char) {
      this.doc.setCell(row, col, '');
      this._dropExponentAt(row, col);
      if (this.grid && this.grid.updateCell) this.grid.updateCell(row, col);
      this.setCursor(row, col);
      return;
    }
    // move back one cell and clear there
    if (col > 0) {
      col -= 1;
    } else if (row > 0) {
      row -= 1;
      col = this.doc.cols - 1;
    } else {
      // already at top-left
      return;
    }
    this.doc.setCell(row, col, '');
    this._dropExponentAt(row, col);
    if (this.grid && this.grid.updateCell) this.grid.updateCell(row, col);
    this.setCursor(row, col);
  }

  // Move helpers. Left/right wrap across row boundaries — moving right past the
  // last column lands on column 0 of the next row, and moving left from column 0
  // lands on the last column of the previous row — mirroring how typing advances
  // via nextCell(). At the very first (0,0) / last cell the cursor stays put
  // (setCursor clamps), so there's no wrap off the top or bottom of the grid.
  moveLeft() {
    const { row, col } = this.cursor;
    if (col <= 0 && row > 0) { this.setCursor(row - 1, this.doc.cols - 1); return; }
    this.setCursor(row, col - 1);
  }
  moveRight() {
    const { row, col } = this.cursor;
    if (col >= this.doc.cols - 1 && row < this.doc.rows - 1) { this.setCursor(row + 1, 0); return; }
    this.setCursor(row, col + 1);
  }
  moveUp()    { this.setCursor(this.cursor.row - 1, this.cursor.col); }
  moveDown()  { this.setCursor(this.cursor.row + 1, this.cursor.col); }

  // After typing, advance right, wrapping to next row at the end
  nextCell() {
    let r = this.cursor.row;
    let c = this.cursor.col + 1;
    if (c >= this.doc.cols) {
      c = 0;
      if (r < this.doc.rows - 1) r += 1; // stay on last row if no more rows
    }
    this.setCursor(r, c);
  }
}
