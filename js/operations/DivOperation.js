export class DivOperation {
  // Main formatting function called when Enter is pressed
  format(doc, grid, { row, anchorCol }, opManager) {
    const typedRow = row;
    const op = doc.getCell(row, anchorCol)?.char;
    if (op !== '/' && op !== ':') return;

    const parsed = this.parseAround(doc, typedRow, anchorCol);
    if (!parsed) return;

    const { bEnd, aStr, bStr, aStart } = parsed;

    const dividend = parseInt(aStr, 10);
    const divisor = parseInt(bStr, 10);
    if (!divisor) return;

    // Write "=" AFTER divisor
    const equalsCol = bEnd + 1;
    if (!doc.getCell(typedRow, equalsCol)?.char) {
      doc.setCell(typedRow, equalsCol, '=');
      grid?.updateCell?.(typedRow, equalsCol);
    }

    // Initialize division state for jumping
    if (!opManager.divisionState) {
      opManager.divisionState = {};
    }
    
    const stateKey = `${typedRow}_${anchorCol}`;
    opManager.divisionState[stateKey] = {
      dividendRow: typedRow,
      dividendStartCol: aStart,
      quotientStartCol: equalsCol + 1,
      currentStep: 0,
      isAtQuotient: true
    };

    // Cursor goes AFTER "="
    return { cursorRow: typedRow, cursorCol: equalsCol + 1 };
  }

  // Handle character typed - manages the jumping pattern
  handleCharacterTyped(doc, row, col, opManager) {
    const divState = this.findDivisionState(doc, row, col, opManager);
    if (!divState) return null;

    const { dividendRow, dividendStartCol, quotientStartCol, currentStep, isAtQuotient } = divState;

    if (isAtQuotient) {
      // Just typed a quotient digit → jump to remainder position
      divState.currentStep++;
      divState.isAtQuotient = false;
      
      const jumpRow = dividendRow + divState.currentStep;
      return {
        cursorRow: jumpRow,
        cursorCol: dividendStartCol
      };
    } else {
      // Just typed a remainder → jump back to quotient position
      divState.isAtQuotient = true;
      
      const quotientCol = quotientStartCol + divState.currentStep - 1;
      return {
        cursorRow: dividendRow,
        cursorCol: quotientCol + 1
      };
    }
  }

  // Find which division operation this cursor position belongs to
  findDivisionState(doc, row, col, opManager) {
    if (!opManager.divisionState) return null;

    for (const state of Object.values(opManager.divisionState)) {
      const { dividendRow, dividendStartCol, quotientStartCol } = state;
      
      const maxQuotientCol = quotientStartCol + 20;
      const maxRemainderRow = dividendRow + 20;
      
      // Check if we're typing in quotient area
      if (row === dividendRow && col >= quotientStartCol && col < maxQuotientCol) {
        return state;
      }
      
      // Check if we're typing in remainder area (under first digit of dividend)
      if (row > dividendRow && row <= maxRemainderRow && col === dividendStartCol) {
        return state;
      }
    }
    
    return null;
  }

  // Parse numbers around the operator
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

    return {
      aStart,
      bEnd,
      aStr: this.collectDigits(doc, row, aStart, aEnd),
      bStr: this.collectDigits(doc, row, bStart, bEnd)
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
