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
  }

  // Set starting position (top-left)
  init() {
    this.setCursor(0, 0);
  }

  // Keep cursor inside grid and update the highlight
  setCursor(r, c) {
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
  }

  // Handle a single key (called from main.js)
  handleKey(key) {
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

    // basic navigation + edit
    switch (key) {
      case 'Backspace':
        // If we are in result entry, handle locally (allow corrections)
        if (this.opManager && this.opManager.handleResultBackspace?.(this.doc, this.grid)) {
          const a = this.opManager.active;
          if (a && a.op === 'result') this.setCursor(a.row, a.cursorCol);
        } else {
          // If a locked box is selected, delete the whole box (all three rows in its span)
          const box = this.opManager?.getLockedRangeAt?.(this.cursor.row, this.cursor.col);
          if (box && box.boxRange) {
            const { topRow, bRow, resRow, startCol, endCol } = box.boxRange;
            for (let r = topRow; r <= resRow; r++) {
              for (let c = startCol; c <= endCol; c++) {
                this.doc.setCell(r, c, '');
                this.grid?.updateCell?.(r, c);
                // Also strip result/lock classes on DOM nodes
                const idx = r * this.doc.cols + c;
                const el = this.grid?.gridEl?.children?.[idx];
                if (el) {
                  el.classList.remove('result-correct', 'result-wrong', 'box-selected');
                  if (el.dataset) delete el.dataset.locked;
                }
              }
            }
            // Remove underline from Row2
            this.grid?.removeUnderline?.(bRow, startCol, endCol);
            // Remove from manager list using box identity
            if (this.opManager?.removeRangeByBox) {
              this.opManager.removeRangeByBox(box.boxRange);
            }
            // Reset selection back to cursor cell
            this.grid?.updateCursor?.(this.cursor.row, this.cursor.col);
          } else {
            this.erase();
          }
        }
        return true;
      case 'ArrowLeft': this.moveLeft(); return true;
      case 'ArrowRight': this.moveRight(); return true;
      case 'ArrowUp': this.moveUp(); return true;
      case 'ArrowDown': this.moveDown(); return true;
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
        // Start result entry phase: move cursor to the last (rightmost) result cell
        if (this.opManager.beginResultEntry) this.opManager.beginResultEntry(next.resultRange);
        // Track this result range for later corrections
        if (this.opManager.addResultRange) this.opManager.addResultRange({ ...next.resultRange, boxRange: next.boxRange });
        this.setCursor(next.resultRange.row, next.resultRange.endCol);
        return true;
      }
      if (next && Number.isInteger(next.cursorRow) && Number.isInteger(next.cursorCol)) {
        this.setCursor(next.cursorRow, next.cursorCol);
      }
      return true;
    }

    return false; // unhandled key
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
