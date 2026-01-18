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

    // Calculate working area: dividend + ':' + divisor + '='
    const totalChars = aStr.length + 1 + bStr.length + 1;
    const workAreaSize = totalChars;

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
      );

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
