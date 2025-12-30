// Very simple document model for a fixed grid
// Student-like: keep it small and commented
export class Document {
  constructor(rows = 30, cols = 24) {
    this.rows = rows;
    this.cols = cols;
    // 2D array of cells, each cell = { char: string }
    this.grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ char: '' }))
    );
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  getCell(r, c) {
    if (!this.inBounds(r, c)) return null;
    return this.grid[r][c];
  }

  setCell(r, c, ch = '') {
    if (!this.inBounds(r, c)) return;
    this.grid[r][c] = { char: ch };
  }

  clearAll() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c].char = '';
      }
    }
  }
}
