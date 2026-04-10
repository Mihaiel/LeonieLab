/*
  Application Logic
  ---------------------
  Very simple logic for typing into a grid
  Arrow keys move the cursor
  Backspace clears current (or previous) cell
*/

// OPERATION STUB HOOK left below for later features
export class ApplicationLogic {
  constructor(doc, grid, opManager = null) {
    this.doc = doc;   // the data model (rows, cols, grid)
    this.grid = grid; // the renderer (updates UI)
    this.cursor = { row: 0, col: 0 };
    this.opManager = opManager; // optional; injected to keep concerns separated
    this.scratchMode = null;   // { scratchRow, aRow, col } when editing a scratch overlay
    this.textRowMode = null;   // { row, startCol, cursorPos } when editing a text strip
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
          const a = this.opManager.active; // may be null if finished
          if (a && a.op === 'result') {
            this.setCursor(a.row, a.cursorCol);
          }
          return true;
        }
      }

      // Check for division jump BEFORE typing
      const currentRow = this.cursor.row;
      const currentCol = this.cursor.col;
      let jumpTarget = null;
      
      if (this.opManager && this.opManager.registry['/']?.handleCharacterTyped) {
        jumpTarget = this.opManager.registry['/'].handleCharacterTyped(
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
      if (key === 'ArrowLeft') {
        const a = this.opManager.active;
        const nc = Math.max(a.startCol, (a.cursorCol ?? a.endCol) - 1);
        a.cursorCol = nc;
        this.setCursor(a.row, nc);
        return true;
      }
      if (key === 'ArrowRight') {
        const a = this.opManager.active;
        const nc = Math.min(a.endCol, (a.cursorCol ?? a.endCol) + 1);
        a.cursorCol = nc;
        this.setCursor(a.row, nc);
        return true;
      }
      if (key === 'ArrowUp') {
        // Bridge to the carry/borrow scratch row above operand A. Lands on
        // (cursorCol + 1) because school-style result entry moves the cursor
        // LEFT after each digit, so the carry belongs to the column that was
        // JUST written — one cell to the right of the current cursor. Example
        // "187+29": after typing '6' the cursor sits on the tens column; the
        // carry '1' belongs above the ones column, so ArrowUp should jump
        // straight there without a follow-up ArrowRight.
        // The target col is clamped into the box's scratch range, so pressing
        // ArrowUp from the rightmost position still lands on the rightmost
        // scratch cell.
        const a = this.opManager.active;
        const box = a.boxRange;
        if (box && box.scratchRow != null) {
          const ss = box.scratchStart ?? box.startCol;
          const se = box.scratchEnd   ?? box.endCol;
          const cursorCol = a.cursorCol ?? a.endCol;
          const col = Math.min(se, Math.max(ss, cursorCol + 1));
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

    // Equals sign — written as a literal character at the cursor so the
    // student can hand-author their own operations (e.g. "5+3=8"). Unlike
    // +, -, *, : it does NOT trigger the formatter and does NOT start a
    // new operation. Absorbed inside result-entry mode by the lock guard
    // above, so it only reaches here when the student is typing freely.
    if (key === '=') {
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
      }
      return true;
    }

    if (key === 'ArrowUp') {
      return true; // already in scratch mode, absorb
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
    if (this.grid && this.grid.updateCell) this.grid.updateCell(row, col);
    this.setCursor(row, col);
  }

  // Move helpers
  moveLeft()  { this.setCursor(this.cursor.row, this.cursor.col - 1); }
  moveRight() { this.setCursor(this.cursor.row, this.cursor.col + 1); }
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
