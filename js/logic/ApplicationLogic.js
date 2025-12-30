// Minimal logic: type digits, move cursor; Backspace and arrows
export class ApplicationLogic {
  constructor(doc, grid){
    this.doc = doc;
    this.grid = grid;
    this.cursor = { row: 0, col: 0 };
  }

  init(){
    this.setCursor(0,0);
  }

  setCursor(r,c){
    const row = Math.max(0, Math.min(this.doc.rows - 1, r));
    const col = Math.max(0, Math.min(this.doc.cols - 1, c));
    this.cursor = { row, col };
    this.grid?.updateCursor?.(row, col);
  }

  handleKey(key){
    // numbers 0-9
    if (/^[0-9]$/.test(key)) { this.typeDigit(key); return true; }
    // backspace
    if (key === 'Backspace') { this.backspace(); return true; }
    // arrows
    if (key === 'ArrowLeft') { this.move(0,-1); return true; }
    if (key === 'ArrowRight') { this.move(0,1); return true; }
    if (key === 'ArrowUp') { this.move(-1,0); return true; }
    if (key === 'ArrowDown') { this.move(1,0); return true; }

    // OPERATION STUB HOOK: '+', '-', 'x', '/', 'Enter' can be handled later
    return false;
  }

  typeDigit(ch){
    const { row, col } = this.cursor;
    this.doc.setCell(row, col, ch);
    this.grid?.updateCell?.(row, col);
    this.advance();
  }

  backspace(){
    let { row, col } = this.cursor;
    const cell = this.doc.getCell(row, col);
    if (cell && cell.char) {
      this.doc.setCell(row, col, '');
      this.grid?.updateCell?.(row, col);
      return;
    }
    if (col > 0) col -= 1; else if (row > 0) { row -= 1; col = this.doc.cols - 1; } else return;
    this.doc.setCell(row, col, '');
    this.grid?.updateCell?.(row, col);
    this.setCursor(row, col);
  }

  move(dr, dc){
    this.setCursor(this.cursor.row + dr, this.cursor.col + dc);
  }

  advance(){
    let { row, col } = this.cursor;
    col += 1;
    if (col >= this.doc.cols){ col = 0; row = Math.min(this.doc.rows - 1, row + 1); }
    this.setCursor(row, col);
  }
}
