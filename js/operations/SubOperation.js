// SubOperation
// ------------
// Formats a typed inline subtraction like:  123-45
// into a vertical "primary school" layout:
//
//   123
//  - 45
//  ----
//  [result typed by user]

export class SubOperation {
  format(doc, grid, { row, anchorCol }, opManager) {
    const typedRow = row;
    const parsed = this.parseAround(doc, typedRow, anchorCol);
    if (!parsed) return;
    const { aStart, aEnd, bStart, bEnd, bRow, aStr, bStr } = parsed;

    const aLen = aStr.length;
    const bLen = bStr.length;

    // Right-align both operands by A's ones column.
    const endColRaw      = aEnd;
    const bWriteEndRaw   = endColRaw;
    const bWriteStartRaw = bWriteEndRaw - (bLen - 1);
    const biggerStart    = (bLen > aLen ? bWriteStartRaw : aStart);

    // Bug 1 fix — col-0 entry:
    // When A starts at col 0 the natural operator column is -1 (no room).
    // Shift the entire formatted block right by the deficit so the operator
    // fits at col 0 and A/B are rewritten one column to the right.
    const naturalMinusCol = biggerStart - 1;
    const colShift = naturalMinusCol < 0 ? -naturalMinusCol : 0;

    const endCol    = endColRaw + colShift;
    const minusCol  = naturalMinusCol + colShift;   // guaranteed >= 0
    const bWriteEnd = endCol;
    const bWriteStart = bWriteEnd - (bLen - 1);

    const maxWidth       = Math.max(aLen, bLen);
    const underlineStart = endCol - (maxWidth - 1);
    const spanStart      = Math.min(underlineStart, minusCol);
    const spanEnd        = endCol;

    // --- CLEAR INPUT PHASE (do this before the conflict scan so a wrapped B
    //     does not create a false positive in rowHasContent) ---

    // Remove '-' from typedRow
    if (doc.inBounds(typedRow, anchorCol)) {
      doc.setCell(typedRow, anchorCol, '');
      grid?.updateCell?.(typedRow, anchorCol);
    }

    // Remove B from wherever it was typed.
    // bRow may differ from typedRow when B wrapped to the next row (right-edge fix).
    for (let c = bStart; c <= bEnd; c++) {
      if (doc.inBounds(bRow, c)) {
        doc.setCell(bRow, c, '');
        grid?.updateCell?.(bRow, c);
      }
    }

    // If the block was shifted right, erase A at its original position and
    // rewrite it one column further right on typedRow.
    if (colShift > 0) {
      for (let c = aStart; c <= aEnd; c++) {
        if (doc.inBounds(typedRow, c)) {
          doc.setCell(typedRow, c, '');
          grid?.updateCell?.(typedRow, c);
        }
      }
      for (let i = 0; i < aStr.length; i++) {
        const c = aStart + colShift + i;
        if (doc.inBounds(typedRow, c)) {
          doc.setCell(typedRow, c, aStr[i]);
          grid?.updateCell?.(typedRow, c);
        }
      }
    }

    // --- FIND OUTPUT ROWS (scan after clearing so wrapped B is gone) ---
    let rowShift = 0;
    const within = (r, c) => r >= 0 && r < doc.rows && c >= 0 && c < doc.cols;
    const rowHasContent = (r, s, e) => {
      if (r < 0 || r >= doc.rows) return false;
      for (let c = s; c <= e; c++) {
        if (!within(r, c)) continue;
        if (doc.getCell(r, c)?.char) return true;
      }
      return false;
    };
    const intersectsLocked = (r) =>
      !!opManager?.resultRanges?.some(b =>
        b.locked && b.boxRange &&
        r >= b.boxRange.topRow && r <= b.boxRange.resRow &&
        !(spanEnd < b.boxRange.startCol || spanStart > b.boxRange.endCol)
      );
    while (
      typedRow + 2 + rowShift < doc.rows &&
      (
        intersectsLocked(typedRow + 1 + rowShift) ||
        intersectsLocked(typedRow + 2 + rowShift) ||
        rowHasContent(typedRow + 1 + rowShift, spanStart, spanEnd) ||
        rowHasContent(typedRow + 2 + rowShift, spanStart, spanEnd)
      )
    ) {
      rowShift += 3;
    }
    const row1   = typedRow + 1 + rowShift;
    const rowRes = typedRow + 2 + rowShift;

    // --- WRITE OUTPUT ---
    const clearStart = Math.max(0, Math.min(minusCol, bWriteStart));
    for (let c = clearStart; c <= bWriteEnd; c++) {
      if (doc.inBounds(row1, c)) { doc.setCell(row1, c, ''); grid?.updateCell?.(row1, c); }
    }
    if (doc.inBounds(row1, minusCol)) { doc.setCell(row1, minusCol, '-'); grid?.updateCell?.(row1, minusCol); }
    for (let i = 0; i < bStr.length; i++) {
      const col = bWriteStart + i;
      if (doc.inBounds(row1, col)) { doc.setCell(row1, col, bStr[i]); grid?.updateCell?.(row1, col); }
    }

    grid?.removeUnderline?.(row1, underlineStart, endCol);
    grid?.addUnderline?.(row1, underlineStart, endCol);

    const diff           = (parseInt(aStr, 10) - parseInt(bStr, 10)).toString();
    const resEnd         = endCol;
    const resStart       = resEnd - (maxWidth - 1);
    const correctStartCol = resEnd - (diff.length - 1);

    return {
      resultRange: {
        row: rowRes,
        startCol: resStart,
        endCol: resEnd,
        correctDigits: diff,
        correctStartCol,
      },
      boxRange: {
        topRow:   typedRow,
        bRow:     row1,
        resRow:   rowRes,
        startCol: Math.min(underlineStart, minusCol),
        endCol:   endCol,
      },
    };
  }

  // Parse "A - B" on typedRow.
  // Right-edge fix: if B is not found to the right of the operator on the same
  // row (operator is at the last column), scan for B on the next row from col 0.
  parseAround(doc, row, minusCol) {
    if (row < 0 || row >= doc.rows || minusCol == null) return null;

    // Scan left for A
    let aEnd   = minusCol - 1;
    let aStart = aEnd;
    while (aStart >= 0) {
      const ch = doc.getCell(row, aStart)?.char || '';
      if (ch >= '0' && ch <= '9') aStart--; else break;
    }
    aStart++;
    if (aStart > aEnd) return null;

    // Scan right for B on the same row
    let bRow   = row;
    let bStart = minusCol + 1;
    let bEnd   = bStart;

    if (bStart < doc.cols) {
      while (bEnd < doc.cols) {
        const ch = doc.getCell(bRow, bEnd)?.char || '';
        if (ch >= '0' && ch <= '9') bEnd++; else break;
      }
      bEnd--;
    }

    // If B not found on same row, try the next row from col 0.
    if (bEnd < bStart && row + 1 < doc.rows) {
      bRow   = row + 1;
      bStart = 0;
      bEnd   = 0;
      while (bEnd < doc.cols) {
        const ch = doc.getCell(bRow, bEnd)?.char || '';
        if (ch >= '0' && ch <= '9') bEnd++; else break;
      }
      bEnd--;
    }

    if (bEnd < bStart) return null;

    const aStr = this.collectDigits(doc, row,  aStart, aEnd);
    const bStr = this.collectDigits(doc, bRow, bStart, bEnd);
    if (!aStr || !bStr) return null;

    return { aStart, aEnd, bStart, bEnd, bRow, aStr, bStr };
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
