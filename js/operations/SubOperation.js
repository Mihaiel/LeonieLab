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
    // 1) Parse contiguous digits around the '-' anchor on the typed row
    const typedRow = row;
    const parsed = this.parseAround(doc, typedRow, anchorCol);
    if (!parsed) return;
    const { aStart, aEnd, bStart, bEnd, aStr, bStr } = parsed;

    // Compute difference (for checking only) and align everything by the ones column of A (aEnd)
    const diff = (parseInt(aStr, 10) - parseInt(bStr, 10)).toString();
    const endCol = aEnd; // ones column alignment

    // 2) Decide B positioning and '-' column based on operand widths
    const bWriteEnd = endCol;
    const bWriteStart = bWriteEnd - (bStr.length - 1);

    const aLen = aStr.length;
    const bLen = bStr.length;

    // Put the '-' one cell before the larger operand start
    const biggerStart = (bLen > aLen ? bWriteStart : aStart);
    const minusCol = Math.max(0, biggerStart - 1);

    // Underline width based on max operand width
    const maxWidth = Math.max(aLen, bLen);
    const underlineStart = endCol - (maxWidth - 1);
    const spanStart = Math.min(underlineStart, minusCol);
    const spanEnd = endCol;

    // 3) Prevent overlap with locked boxes or filled cells; shift in blocks of 3
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
      !!opManager?.resultRanges?.some(b =>
        b.locked &&
        b.boxRange &&
        r >= b.boxRange.topRow &&
        r <= b.boxRange.resRow &&
        !(spanEnd < b.boxRange.startCol || spanStart > b.boxRange.endCol)
      );

    while (
      typedRow + 2 + shift < doc.rows &&
      (
        intersectsLocked(typedRow + 1 + shift) ||
        intersectsLocked(typedRow + 2 + shift) ||
        rowHasContent(typedRow + 1 + shift, spanStart, spanEnd) ||
        rowHasContent(typedRow + 2 + shift, spanStart, spanEnd)
      )
    ) {
      shift += 3;
    }

    const row1 = typedRow + 1 + shift;  // operator row
    const rowRes = typedRow + 2 + shift; // result entry row

    // 4) Keep A where it was typed on typedRow; remove the '-' and the typed B from that typedRow
    if (doc.inBounds(typedRow, anchorCol)) {
      doc.setCell(typedRow, anchorCol, '');
      grid?.updateCell?.(typedRow, anchorCol);
    }
    for (let c = bStart; c <= bEnd; c++) {
      if (doc.inBounds(typedRow, c)) {
        doc.setCell(typedRow, c, '');
        grid?.updateCell?.(typedRow, c);
      }
    }

    // 5) Clear target span on row1, place '-' then write B right-aligned to endCol
    const clearStart = Math.max(0, Math.min(minusCol, bWriteStart));
    for (let c = clearStart; c <= bWriteEnd; c++) {
      if (doc.inBounds(row1, c)) {
        doc.setCell(row1, c, '');
        grid?.updateCell?.(row1, c);
      }
    }

    if (minusCol >= 0 && doc.inBounds(row1, minusCol)) {
      doc.setCell(row1, minusCol, '-');
      grid?.updateCell?.(row1, minusCol);
    }

    for (let i = 0; i < bStr.length; i++) {
      const col = bWriteStart + i;
      if (doc.inBounds(row1, col)) {
        doc.setCell(row1, col, bStr[i]);
        grid?.updateCell?.(row1, col);
      }
    }

    // 6) Underline must match the widest operand (A or B)
    grid?.removeUnderline?.(row1, underlineStart, endCol);
    grid?.addUnderline?.(row1, underlineStart, endCol);

    // 7) Do not auto-calculate: start a result-entry phase with alignment and correctness info
    const resEnd = endCol;
    const width = Math.max(aStr.length, bStr.length);
    const resStart = resEnd - (width - 1);

    const correctDigits = diff;
    const correctStartCol = resEnd - (correctDigits.length - 1);

    return {
      resultRange: {
        row: rowRes,
        startCol: resStart,
        endCol: resEnd,
        correctDigits,
        correctStartCol,
      },
      boxRange: {
        topRow: typedRow,
        bRow: row1,
        resRow: rowRes,
        startCol: Math.min(underlineStart, minusCol),
        endCol: endCol,
      },
    };
  }

  // Parse "A-B" on a single row where '-' is at anchorCol
  parseAround(doc, row, minusCol) {
    if (row < 0 || row >= doc.rows || minusCol == null) return null;

    // Scan left for A
    let aEnd = minusCol - 1;
    let aStart = aEnd;
    while (aStart >= 0) {
      const ch = doc.getCell(row, aStart)?.char || '';
      if (ch >= '0' && ch <= '9') aStart--;
      else break;
    }
    aStart++;
    if (aStart > aEnd) return null;

    // Scan right for B
    let bStart = minusCol + 1;
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
