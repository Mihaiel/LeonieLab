/* MulOperation
  ------------
  Keeps the expression "A·B" on ONE row. When the user presses Enter, it formats the worksheet like
  handwritten multiplication 
*/

export class MulOperation {
  format(doc, grid, { row, anchorCol }, opManager) {
    const typedRow = row;

    // 1) Parse A and B around the multiplication operator on the typed row
    const parsed = this.parseAround(doc, typedRow, anchorCol);
    if (!parsed) return null;

    const { aStart, aEnd, bStart, bEnd, aStr, bStr } = parsed;

    // Right edge alignment = last digit column of B
    const boxEnd = bEnd;

    // Left edge of the "yellow typing box" = one cell before A
    const boxStart = Math.max(0, aStart - 1);

    // Underline #1 should cover exactly from first digit of A to last digit of B
    const underline1Start = aStart;
    const underline1End = boxEnd;

    // 2) Compute correct partial products and final product (for checking only; not displayed)
    const aNum = parseInt(aStr, 10);
    const bNum = parseInt(bStr, 10);
    if (Number.isNaN(aNum) || Number.isNaN(bNum)) return null;

    // Partial products: multiply A by each digit of B from rightmost to leftmost and append zeros
    const bDigits = bStr.split('').map(d => parseInt(d, 10)); // left -> right
    const partials = [];
    for (let i = bDigits.length - 1, pos = 0; i >= 0; i--, pos++) {
      const digit = bDigits[i];
      const base = (aNum * digit).toString();
      partials.push(base + '0'.repeat(pos)); // shift for tens/hundreds...
    }
    const correctFinal = (aNum * bNum).toString();

    // We need below the typed row:
    // - partial rows (partials.length)
    // - underline #2 row
    // - final row
    const neededBelow = partials.length + 2;

    // 3) Avoid overlap with existing content / locked boxes (shift down in blocks of 3)
    let shift = 0;

    const within = (r, c) => r >= 0 && r < doc.rows && c >= 0 && c < doc.cols;
    const rowHasContent = (r, s, e) => {
      if (r < 0 || r >= doc.rows) return false;
      for (let c = s; c <= e; c++) {
        if (!within(r, c)) continue;
        const ch = doc.getCell(r, c)?.char || '';
        if (ch) return true;
      }
      return false;
    };

    const intersectsLocked = (r) =>
      !!opManager?.resultRanges?.some(rr =>
        rr.locked &&
        rr.boxRange &&
        r >= rr.boxRange.topRow &&
        r <= rr.boxRange.resRow &&
        !(boxEnd < rr.boxRange.startCol || boxStart > rr.boxRange.endCol)
      );

    while (typedRow + neededBelow + shift < doc.rows) {
      let blocked = false;
      for (let rr = typedRow + 1 + shift; rr <= typedRow + neededBelow + shift; rr++) {
        if (intersectsLocked(rr) || rowHasContent(rr, boxStart, boxEnd)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) break;
      shift += 3;
    }

    const firstPartialRow = typedRow + 1 + shift;
    const lastPartialRow = firstPartialRow + (partials.length - 1);
    const underline2Row = lastPartialRow;        // underline #2 sits on the last partial row line
    const finalRow = lastPartialRow + 1;

    // 4) Replace typed operator with a centered dot for display (keep digits in place)
    if (doc.inBounds(typedRow, anchorCol)) {
      doc.setCell(typedRow, anchorCol, '·');
      grid?.updateCell?.(typedRow, anchorCol);
    }

    // 5) Draw underline #1 under the expression span
    grid?.removeUnderline?.(typedRow, underline1Start, underline1End);
    grid?.addUnderline?.(typedRow, underline1Start, underline1End);

    const startCols = [aEnd, anchorCol];
    for (let c = bStart; c <= bEnd; c++) startCols.push(c);

    // 6) Create partial result ranges
    const ranges = [];
    for (let i = 0; i < partials.length; i++) {
      const r = firstPartialRow + i;
      const str = partials[i];

      // Full typing area
      const startCol = boxStart;
      const endCol = boxEnd;

      // Where the correct digits start if right-aligned to boxEnd
      const correctStartCol = boxEnd - (str.length - 1);

      // The cursor start position 
      const entryCol = startCols[Math.min(i, startCols.length - 1)];

      // Clear the typing area (do NOT auto-fill anything)
      for (let c = startCol; c <= endCol; c++) {
        if (doc.inBounds(r, c)) {
          doc.setCell(r, c, '');
          grid?.updateCell?.(r, c);
        }
      }

      ranges.push({
        row: r,
        startCol,
        endCol,

        // For checking
        correctDigits: str,
        correctStartCol,

        // Only check the "real digit zone" (right-aligned)
        checkStartCol: correctStartCol,
        checkEndCol: boxEnd,

        // For cursor placement on Enter
        entryCol,
        kind: 'partial',
      });
    }

    // 7) Underline #2: one cell longer to the left than the widest needed result
    // Compute the leftmost needed start among all partials and the final result
    const startsNeeded = [
      ...partials.map(p => boxEnd - (p.length - 1)),
      boxEnd - (correctFinal.length - 1),
    ];

    // One cell longer to the left
    const underline2Start = Math.max(boxStart, Math.min(...startsNeeded) - 1);

    grid?.removeUnderline?.(underline2Row, underline2Start, boxEnd);
    grid?.addUnderline?.(underline2Row, underline2Start, boxEnd);

    // 8) Final result range 
    const finalCorrectStart = boxEnd - (correctFinal.length - 1);

    for (let c = boxStart; c <= boxEnd; c++) {
      if (doc.inBounds(finalRow, c)) {
        doc.setCell(finalRow, c, '');
        grid?.updateCell?.(finalRow, c);
      }
    }

    const finalRange = {
      row: finalRow,
      startCol: boxStart,
      endCol: boxEnd,

      correctDigits: correctFinal,
      correctStartCol: finalCorrectStart,

      checkStartCol: finalCorrectStart,
      checkEndCol: boxEnd,

      entryCol: boxEnd,
      noWrongColor: true,
      kind: 'final'
    };

    // 9) Return ranges + box for OperationManager to handle result entry & overlap/delete
    return {
      // Start entry on the first partial row (if no partials, start on final)
      resultRange: ranges[0] || finalRange,

      // Register remaining rows (other partials + final)
      extraResultRanges: [...ranges.slice(1), finalRange],

      boxRange: {
        topRow: typedRow,
        bRow: typedRow,
        resRow: finalRow,
        startCol: boxStart,
        endCol: boxEnd,

        underline2Row: underline2Row,
        underline2Start: underline2Start,
        underline2End: boxEnd,
      },
    };
  }

  // Parse "A op B" on a single row where op is one of: *, x, X, ×, ·
  parseAround(doc, row, opCol) {
    if (row < 0 || row >= doc.rows || opCol == null) return null;

    const op = doc.getCell(row, opCol)?.char || '';
    const isMul = (ch) => ch === '*' || ch === 'x' || ch === 'X' || ch === '×' || ch === '·';
    if (!isMul(op)) return null;

    // Scan left for A digits
    let aEnd = opCol - 1;
    let aStart = aEnd;
    while (aStart >= 0) {
      const ch = doc.getCell(row, aStart)?.char || '';
      if (ch >= '0' && ch <= '9') aStart--;
      else break;
    }
    aStart++;
    if (aStart > aEnd) return null;

    // Scan right for B digits
    let bStart = opCol + 1;
    if (bStart >= doc.cols) return null;

    let bEnd = bStart;
    while (bEnd < doc.cols) {
      const ch = doc.getCell(row, bEnd)?.char || '';
      if (ch >= '0' && ch <= '9') bEnd++;
      else break;
    }
    bEnd--;
    if (bEnd < bStart) return null;

    const aStr = this.collectDigits(doc, row, aStart, aEnd);
    const bStr = this.collectDigits(doc, row, bStart, bEnd);
    if (!aStr || !bStr) return null;

    return { aStart, aEnd, bStart, bEnd, aStr, bStr };
  }

  collectDigits(doc, row, start, end) {
    let s = '';
    for (let c = start; c <= end; c++) {
      const ch = doc.getCell(row, c)?.char || '';
      if (ch >= '0' && ch <= '9') s += ch;
    }
    return s;
  }
}
