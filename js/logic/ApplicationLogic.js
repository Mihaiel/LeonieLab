/*
  Application Logic
  ---------------------
  Very simple logic for typing into a grid
  Arrow keys move the cursor
  Backspace clears current (or previous) cell
*/

// OPERATION STUB HOOK left below for later features
export class ApplicationLogic {
  constructor(doc, grid) {
    this.doc = doc;   // the data model (rows, cols, grid)
    this.grid = grid; // the renderer (updates UI)
    this.row = 0;     // current row
    this.col = 0;     // current col
  }

  // Set starting position (top-left)
  init() {
    this.setCursor(0, 0);
  }

  // Keep cursor inside grid and update the highlight
  setCursor(r, c) {
    if (r < 0) r = 0;
    if (c < 0) c = 0;
    if (r >= this.doc.rows) r = this.doc.rows - 1;
    if (c >= this.doc.cols) c = this.doc.cols - 1;
    this.row = r;
    this.col = c;
    if (this.grid && this.grid.updateCursor) {
      this.grid.updateCursor(r, c);
    }
  }

  // Handle a single key (called from main.js)
  handleKey(key) {
    // 0-9 digits
    if (key >= '0' && key <= '9') {
      this.writeDigit(key);
      return true;
    }

    // basic navigation + edit
    switch (key) {
      case 'Backspace': this.erase(); return true;
      case 'ArrowLeft': this.moveLeft(); return true;
      case 'ArrowRight': this.moveRight(); return true;
      case 'ArrowUp': this.moveUp(); return true;
      case 'ArrowDown': this.moveDown(); return true;
    }

    // OPERATION STUB HOOK:
    // if (key === '+' || key === '-' || key === 'x' || key === '/' || key === 'Enter') {
    //   // later: detect and format operations here
    //   return true;
    // }

    return false; // unhandled key
  }

  // Put a digit into current cell and go to next cell
  writeDigit(ch) {
    this.doc.setCell(this.row, this.col, ch);
    if (this.grid && this.grid.updateCell) {
      this.grid.updateCell(this.row, this.col);
    }
    this.nextCell();
  }

  // Clear current (if non-empty) or previous cell and move cursor accordingly
  erase() {
    const cell = this.doc.getCell(this.row, this.col);
    if (cell && cell.char) {
      this.doc.setCell(this.row, this.col, '');
      if (this.grid && this.grid.updateCell) this.grid.updateCell(this.row, this.col);
      return;
    }
    // move back one cell and clear there
    if (this.col > 0) {
      this.col -= 1;
    } else if (this.row > 0) {
      this.row -= 1;
      this.col = this.doc.cols - 1;
    } else {
      // already at top-left
      return;
    }
    this.doc.setCell(this.row, this.col, '');
    if (this.grid && this.grid.updateCell) this.grid.updateCell(this.row, this.col);
    this.setCursor(this.row, this.col);
  }

  // Move helpers
  moveLeft()  { this.setCursor(this.row, this.col - 1); }
  moveRight() { this.setCursor(this.row, this.col + 1); }
  moveUp()    { this.setCursor(this.row - 1, this.col); }
  moveDown()  { this.setCursor(this.row + 1, this.col); }

  // After typing, advance right, wrapping to next row at the end
  nextCell() {
    let r = this.row;
    let c = this.col + 1;
    if (c >= this.doc.cols) {
      c = 0;
      if (r < this.doc.rows - 1) r += 1; // stay on last row if no more rows
    }
    this.setCursor(r, c);
  }
}
