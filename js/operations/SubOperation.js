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
    const {
      aStart, aEnd, aStr,
      aAboveStr, aAboveRow, aAboveStart, aAboveEnd,
      bStart, bEnd, bRow, bStr,
    } = parsed;

    // Full A may span two rows if the user's number wrapped at the right edge.
    const fullAStr  = aAboveStr + aStr;
    const fullALen  = fullAStr.length;
    const bLen      = bStr.length;
    const hasAboveA = aAboveStr.length > 0;

    // topRow: the row where A will be displayed in the formatted block.
    const topRow = hasAboveA ? aAboveRow : typedRow;

    // Unified column-shift formula (covers both col-0 bug and multi-row A):
    //   endCol ≥ max(fullALen, bLen)  ensures operator ≥ col 0 and A fits.
    const endColRaw  = aEnd;
    const colShift   = Math.max(0, Math.max(fullALen, bLen) - endColRaw);

    const endCol      = endColRaw + colShift;
    const bWriteEnd   = endCol;
    const bWriteStart = endCol - (bLen - 1);
    const aWriteStart = endCol - (fullALen - 1);
    const minusCol    = endCol - Math.max(fullALen, bLen);   // always ≥ 0

    const maxWidth       = Math.max(fullALen, bLen);
    const underlineStart = endCol - (maxWidth - 1);
    const spanStart      = Math.min(underlineStart, minusCol);
    const spanEnd        = endCol;

    // --- CLEAR INPUT ---

    // Remove operator
    if (doc.inBounds(typedRow, anchorCol)) {
      doc.setCell(typedRow, anchorCol, '');
      grid?.updateCell?.(typedRow, anchorCol);
    }
    // Remove B from wherever it was typed
    for (let c = bStart; c <= bEnd; c++) {
      if (doc.inBounds(bRow, c)) { doc.setCell(bRow, c, ''); grid?.updateCell?.(bRow, c); }
    }
    // Remove the typedRow portion of A
    for (let c = aStart; c <= aEnd; c++) {
      if (doc.inBounds(typedRow, c)) { doc.setCell(typedRow, c, ''); grid?.updateCell?.(typedRow, c); }
    }
    // Remove the above-row portion of A (multi-row A only)
    if (hasAboveA) {
      for (let c = aAboveStart; c <= aAboveEnd; c++) {
        if (doc.inBounds(aAboveRow, c)) { doc.setCell(aAboveRow, c, ''); grid?.updateCell?.(aAboveRow, c); }
      }
    }

    // --- FIND OUTPUT ROWS ---
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
      topRow + 2 + rowShift < doc.rows &&
      (
        intersectsLocked(topRow + 1 + rowShift) ||
        intersectsLocked(topRow + 2 + rowShift) ||
        rowHasContent(topRow + 1 + rowShift, spanStart, spanEnd) ||
        rowHasContent(topRow + 2 + rowShift, spanStart, spanEnd)
      )
    ) {
      rowShift += 3;
    }
    const row1   = topRow + 1 + rowShift;
    const rowRes = topRow + 2 + rowShift;

    // --- WRITE FULL A ON topRow ---
    for (let i = 0; i < fullAStr.length; i++) {
      const c = aWriteStart + i;
      if (doc.inBounds(topRow, c)) { doc.setCell(topRow, c, fullAStr[i]); grid?.updateCell?.(topRow, c); }
    }

    // --- WRITE OPERATOR + B ON row1 ---
    const clearStart = Math.max(0, Math.min(minusCol, bWriteStart));
    for (let c = clearStart; c <= bWriteEnd; c++) {
      if (doc.inBounds(row1, c)) { doc.setCell(row1, c, ''); grid?.updateCell?.(row1, c); }
    }
    if (doc.inBounds(row1, minusCol)) { doc.setCell(row1, minusCol, '-'); grid?.updateCell?.(row1, minusCol); }
    for (let i = 0; i < bStr.length; i++) {
      const c = bWriteStart + i;
      if (doc.inBounds(row1, c)) { doc.setCell(row1, c, bStr[i]); grid?.updateCell?.(row1, c); }
    }

    grid?.removeUnderline?.(row1, underlineStart, endCol);
    grid?.addUnderline?.(row1, underlineStart, endCol);

    const diff            = (parseInt(fullAStr, 10) - parseInt(bStr, 10)).toString();
    const resEnd          = endCol;
    const resStart        = underlineStart;
    const correctStartCol = resEnd - (diff.length - 1);

    return {
      resultRange: {
        row: rowRes,
        startCol: resStart,
        endCol:   resEnd,
        correctDigits: diff,
        correctStartCol,
      },
      boxRange: {
        topRow,
        bRow:   row1,
        resRow: rowRes,
        startCol: spanStart,
        endCol:   endCol,
        underlineStart,
      },
    };
  }

  // Parse "A - B" on typedRow.
  // Multi-row A and right-edge B use the same detection logic as AddOperation.
  parseAround(doc, row, minusCol) {
    if (row < 0 || row >= doc.rows || minusCol == null) return null;

    // Scan left for A on typedRow
    let aEnd   = minusCol - 1;
    let aStart = aEnd;
    while (aStart >= 0) {
      const ch = doc.getCell(row, aStart)?.char || '';
      if (ch >= '0' && ch <= '9') aStart--; else break;
    }
    aStart++;
    if (aStart > aEnd) return null;

    // Multi-row A detection
    let aAboveStr   = '';
    let aAboveRow   = -1;
    let aAboveStart = -1;
    let aAboveEnd   = -1;
    if (aStart === 0 && row > 0) {
      const lastCol = doc.cols - 1;
      const ch = doc.getCell(row - 1, lastCol)?.char || '';
      if (ch >= '0' && ch <= '9') {
        aAboveRow = row - 1;
        aAboveEnd = lastCol;
        aAboveStart = aAboveEnd;
        while (aAboveStart > 0) {
          const c = doc.getCell(aAboveRow, aAboveStart - 1)?.char || '';
          if (c >= '0' && c <= '9') aAboveStart--; else break;
        }
        aAboveStr = this.collectDigits(doc, aAboveRow, aAboveStart, aAboveEnd);
      }
    }

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
    // Right-edge B: try next row
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

    return {
      aStart, aEnd, aStr,
      aAboveStr, aAboveRow, aAboveStart, aAboveEnd,
      bStart, bEnd, bRow, bStr,
    };
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
