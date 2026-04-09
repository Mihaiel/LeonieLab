export class DivOperation {
  //reset division jumping state in OperationManager
  resetState(opManager) {
    if (opManager.divisionState) {
      opManager.divisionState = {};
    }
  }

  // Main formatting function called when Enter is pressed
  format(doc, grid, { row, anchorCol }, opManager) {
    const typedRow = row;
    const op = doc.getCell(row, anchorCol)?.char;
    if (op !== '/' && op !== ':') return;

    const parsed = this.parseAround(doc, typedRow, anchorCol);
    if (!parsed) return;

    let { aStart, aEnd, bStart, bEnd, aStr, bStr } = parsed;
    const { aAboveStr, aAboveRow, aAboveStart, aAboveEnd } = parsed;

    const fullAStr  = aAboveStr + aStr;
    const hasAboveA = aAboveStr.length > 0;

    // opCol: column of the division operator (may shift right after consolidation)
    let opCol = anchorCol;

    // --- MULTI-ROW A CONSOLIDATION ---
    // If A wrapped from the previous row, rewrite the whole expression on typedRow.
    if (hasAboveA) {
      const fullALen = fullAStr.length;

      // Clear above-row A
      for (let c = aAboveStart; c <= aAboveEnd; c++) {
        if (doc.inBounds(aAboveRow, c)) { doc.setCell(aAboveRow, c, ''); grid?.updateCell?.(aAboveRow, c); }
      }
      // Clear typedRow: A digits + operator + B digits
      for (let c = aStart; c <= aEnd; c++) {
        if (doc.inBounds(typedRow, c)) { doc.setCell(typedRow, c, ''); grid?.updateCell?.(typedRow, c); }
      }
      if (doc.inBounds(typedRow, anchorCol)) { doc.setCell(typedRow, anchorCol, ''); grid?.updateCell?.(typedRow, anchorCol); }
      for (let c = bStart; c <= bEnd; c++) {
        if (doc.inBounds(typedRow, c)) { doc.setCell(typedRow, c, ''); grid?.updateCell?.(typedRow, c); }
      }

      // Write fullA starting at col 0
      for (let i = 0; i < fullALen; i++) {
        if (doc.inBounds(typedRow, i)) { doc.setCell(typedRow, i, fullAStr[i]); grid?.updateCell?.(typedRow, i); }
      }
      // Write operator at col fullALen
      opCol = fullALen;
      if (doc.inBounds(typedRow, opCol)) { doc.setCell(typedRow, opCol, op); grid?.updateCell?.(typedRow, opCol); }
      // Write B starting at col fullALen+1
      for (let i = 0; i < bStr.length; i++) {
        const c = opCol + 1 + i;
        if (doc.inBounds(typedRow, c)) { doc.setCell(typedRow, c, bStr[i]); grid?.updateCell?.(typedRow, c); }
      }

      // Update local variables to reflect the new inline positions
      aStart = 0;
      aEnd   = fullALen - 1;
      aStr   = fullAStr;
      bStart = opCol + 1;
      bEnd   = opCol + bStr.length;
    }

    const dividend = parseInt(aStr, 10);
    const divisor  = parseInt(bStr, 10);
    if (!divisor) return;

    // Write "=" AFTER divisor
    const equalsCol = bEnd + 1;
    if (!doc.getCell(typedRow, equalsCol)?.char) {
      doc.setCell(typedRow, equalsCol, '=');
      grid?.updateCell?.(typedRow, equalsCol);
    }

    // Calculate working area: dividend + ':' + divisor + '='
    const totalChars = aStr.length + 1 + bStr.length + 1;
    const workAreaSize = totalChars;

    // Initialize division state for jumping
    if (!opManager.divisionState) {
      opManager.divisionState = {};
    }

    const stateKey = `${typedRow}_${opCol}`;
    opManager.divisionState[stateKey] = {
      dividendRow: typedRow,
      dividendStartCol: aStart,
      quotientStartCol: equalsCol + 1,
      currentStep: 0,
      phase: 'quotient', // quotient -> remainder -> brought-down -> quotient
      // work-area boundaries (NxN)
      workAreaStartCol: aStart,
      workAreaEndCol: equalsCol + workAreaSize, // include quotient column(s)
      workAreaStartRow: typedRow,
      workAreaEndRow: typedRow + workAreaSize,
     };

    // Cursor goes AFTER "="
    return { cursorRow: typedRow, cursorCol: equalsCol + 1 };
  }

  // Handle character typed - manages the jumping pattern
  handleCharacterTyped(doc, row, col, opManager) {
    const divState = this.findDivisionState(doc, row, col, opManager);
    if (!divState) return null;

    const { dividendRow, dividendStartCol, quotientStartCol, currentStep, phase } = divState;

    // resync after delete / correction
    if (row === divState.dividendRow) {
      divState.phase = 'quotient';

      // count already typed quotient digits
      let typedQuotientLength = 0;
      for (let c = quotientStartCol; c < col; c++) {
        if (doc.getCell(dividendRow, c)?.char) typedQuotientLength++;
      }
      divState.currentStep = typedQuotientLength;
    }

    if (phase === 'quotient') {
      // Just typed a quotient digit now jump to remainder position
      divState.currentStep++;
      divState.phase = 'remainder';

      const jumpRow = dividendRow + divState.currentStep;
      return {
        cursorRow: jumpRow,
        cursorCol: dividendStartCol
      };
    } else if (phase === 'remainder') {
      // just typed the remainder now jump to the right
      divState.phase = 'brought-down';
      return {
        cursorRow: row,
        cursorCol: col + 1
      };
    } else if (phase === 'brought-down') {
      // Just typed a brought-down digit now jump to next quotient position
      divState.phase = 'quotient';

      const quotientCol = quotientStartCol + divState.currentStep - 1;
      return {
        cursorRow: dividendRow,
        cursorCol: quotientCol + 1
      };
    }
    return null;
  }

  // Find which division operation this cursor position belongs to
  findDivisionState(doc, row, col, opManager) {
    if (!opManager.divisionState) return null;

    for (const state of Object.values(opManager.divisionState)) {
      const { dividendRow,
              quotientStartCol,
              phase,
              workAreaStartCol,
              workAreaEndCol,
              workAreaStartRow,
              workAreaEndRow
            } = state;

      // Check if we're in the working area
      const inWorkingArea = (
        row >= workAreaStartRow &&
        row <= workAreaEndRow &&
        col >= workAreaStartCol &&
        col <= workAreaEndCol
      ) || (row === dividendRow && col >= quotientStartCol);

      // Outside working area
      if (!inWorkingArea) {
        continue;
      }

      // We are IN the working area now apply phase logic

      // Check if we're typing in quotient area
      if (phase === 'quotient' && row === dividendRow && col >= quotientStartCol) {
        return state;
      }

      // Check if we're typing in remainder or brought-down area (anywhere below dividend in working area)
      if ((phase === 'remainder' || phase === 'brought-down') &&
          row > dividendRow) {
        return state;
      }
    }

    return null;
  }

  // Parse numbers around the operator
  // Returns aStart, aEnd, bStart, bEnd, aStr, bStr, and multi-row A fields.
  parseAround(doc, row, anchorCol) {
    const op = doc.getCell(row, anchorCol)?.char;
    if (op !== '/' && op !== ':') return null;

    // find the left number (dividend)
    let aEnd = anchorCol - 1;
    let aStart = aEnd;
    while (aStart >= 0 && /\d/.test(doc.getCell(row, aStart)?.char)) {
      aStart--;
    }
    aStart++;

    // find right number (divisor)
    let bStart = anchorCol + 1;
    let bEnd = bStart;
    while (bEnd < doc.cols && /\d/.test(doc.getCell(row, bEnd)?.char)) {
      bEnd++;
    }
    bEnd--;

    if (aStart > aEnd || bStart > bEnd) return null;

    // Multi-row A detection: if A reaches col 0 and previous row ends with a digit
    let aAboveStr = '', aAboveRow = -1, aAboveStart = -1, aAboveEnd = -1;
    if (aStart === 0 && row > 0) {
      const lastCol = doc.cols - 1;
      const ch = doc.getCell(row - 1, lastCol)?.char || '';
      if (ch >= '0' && ch <= '9') {
        aAboveRow   = row - 1;
        aAboveEnd   = lastCol;
        aAboveStart = aAboveEnd;
        while (aAboveStart > 0) {
          const c = doc.getCell(aAboveRow, aAboveStart - 1)?.char || '';
          if (c >= '0' && c <= '9') aAboveStart--; else break;
        }
        aAboveStr = this.collectDigits(doc, aAboveRow, aAboveStart, aAboveEnd);
      }
    }

    return {
      aStart,
      aEnd,
      bStart,
      bEnd,
      aStr: this.collectDigits(doc, row, aStart, aEnd),
      bStr: this.collectDigits(doc, row, bStart, bEnd),
      aAboveStr,
      aAboveRow,
      aAboveStart,
      aAboveEnd,
    };
  }

  // Helper: collect digits from a row between start and end columns
  collectDigits(doc, row, start, end) {
    let s = '';
    for (let c = start; c <= end; c++) {
      s += doc.getCell(row, c)?.char || '';
    }
    return s;
  }
}
