// MultiOperandOperation
// ---------------------
// Formats inline chains of 3+ addends/subtrahends like:  3+7+4  or  300-150-27+40
// into an N+1-row vertical "primary school" layout:
//
//   3       300         <- first operand, right-aligned (no sign prefix)
// + 7     - 150         <- subsequent operands, sign in its own column
// + 4     -  27
// ----    + ----- 40
// [res]   [   res   ]   <- result row, student input
//
// Delegated to by AddOperation / SubOperation when parseChain finds >= 3 operands.
// Returns the same { resultRange, boxRange } shape so existing deletion, undo,
// save/open, and PDF rendering keep working unchanged.

export class MultiOperandOperation {
  // Scan the row left/right from anchorCol across the continuous [0-9 + -] run.
  // Returns { operands: [{ sign:'+'|'-', value:'NNN' }], chainStart, chainEnd }
  // or null if fewer than 2 operands are found.
  //
  // First operand defaults to sign '+', unless a leading operator appears
  // before any digit (then it takes that sign — e.g. "-3+7+4").
  static parseChain(doc, row, anchorCol) {
    if (row < 0 || row >= doc.rows || anchorCol == null) return null;
    const isChainChar = (c) => (c >= '0' && c <= '9') || c === '+' || c === '-';

    let chainStart = anchorCol;
    for (let c = anchorCol - 1; c >= 0; c--) {
      const ch = doc.getCell(row, c)?.char || '';
      if (!isChainChar(ch)) break;
      chainStart = c;
    }
    let chainEnd = anchorCol;
    for (let c = anchorCol + 1; c < doc.cols; c++) {
      const ch = doc.getCell(row, c)?.char || '';
      if (!isChainChar(ch)) break;
      chainEnd = c;
    }

    const operands = [];
    let currentSign = '+';
    let buffer = '';
    let signSeen = false;

    const flush = () => {
      if (buffer.length > 0) {
        operands.push({ sign: currentSign, value: buffer });
        buffer = '';
        currentSign = '+';
        signSeen = false;
      }
    };

    for (let i = chainStart; i <= chainEnd; i++) {
      const ch = doc.getCell(row, i)?.char || '';
      if (ch >= '0' && ch <= '9') {
        buffer += ch;
      } else if (ch === '+' || ch === '-') {
        if (buffer.length > 0) {
          flush();
          currentSign = ch;
          signSeen = true;
        } else if (!signSeen) {
          // Leading operator: belongs to the upcoming operand 0.
          currentSign = ch;
          signSeen = true;
        } else if (ch === '-') {
          // Consecutive operators (e.g. "5--3"): a second '-' flips the sign.
          currentSign = currentSign === '-' ? '+' : '-';
        }
      }
    }
    flush();

    if (operands.length < 2) return null;
    return { operands, chainStart, chainEnd };
  }

  format(doc, grid, { row, chainStart, chainEnd, operands }, opManager) {
    const typedRow = row;
    const N = operands.length;

    const sumNum = operands.reduce((acc, op) => {
      const v = parseInt(op.value, 10);
      return op.sign === '-' ? acc - v : acc + v;
    }, 0);
    const isNegative = sumNum < 0;
    const correct = Math.abs(sumNum).toString();

    const maxOperandLen = operands.reduce((m, op) => Math.max(m, op.value.length), 0);
    // maxWidth must accommodate every operand AND the result, because a chain
    // like 50+50+50 produces 150 (one digit wider than any operand).
    const maxWidth = Math.max(maxOperandLen, correct.length);

    // Shift the whole layout right if the typed expression ends so close to
    // col 0 that the sign column would land off-grid.
    const endColRaw = chainEnd;
    const colShift = Math.max(0, maxWidth - endColRaw);
    const endCol = endColRaw + colShift;
    const signCol = endCol - maxWidth;            // always >= 0
    const underlineStart = endCol - (maxWidth - 1);
    const spanStart = signCol;
    const spanEnd = endCol;

    // --- CLEAR INLINE EXPRESSION ---
    for (let i = chainStart; i <= chainEnd; i++) {
      if (doc.inBounds(typedRow, i)) {
        doc.setCell(typedRow, i, '');
        grid?.updateCell?.(typedRow, i);
      }
    }

    // --- FIND OUTPUT ROWS (shift entire block down past any conflict) ---
    const blockHeight = N + 1;
    let rowShift = 0;
    const within = (r, cc) => r >= 0 && r < doc.rows && cc >= 0 && cc < doc.cols;
    const rowHasContent = (r, s, e) => {
      if (r < 0 || r >= doc.rows) return false;
      if (doc.textRows?.[r]?.length > 0) return true;
      for (let cc = s; cc <= e; cc++) {
        if (!within(r, cc)) continue;
        if (doc.getCell(r, cc)?.char) return true;
      }
      return false;
    };
    const intersectsLocked = (r) =>
      !!opManager?.resultRanges?.some(b =>
        b.locked && b.boxRange &&
        r >= b.boxRange.topRow && r <= b.boxRange.resRow &&
        !(spanEnd < b.boxRange.startCol || spanStart > b.boxRange.endCol)
      );
    const blockBlocked = () => {
      for (let k = 0; k < blockHeight; k++) {
        const r = typedRow + k + rowShift;
        if (intersectsLocked(r) || rowHasContent(r, spanStart, spanEnd)) return true;
      }
      return false;
    };
    while (typedRow + blockHeight - 1 + rowShift < doc.rows && blockBlocked()) {
      rowShift += blockHeight;
    }
    const topRow = typedRow + rowShift;
    const bRow   = topRow + N - 1;
    const resRow = topRow + N;

    // --- WRITE OPERAND ROWS ---
    for (let i = 0; i < N; i++) {
      const r = topRow + i;
      const op = operands[i];
      const len = op.value.length;
      const writeStart = endCol - (len - 1);
      const showSign = i > 0 || op.sign === '-';

      // Clear the row's slice before writing so a previous row-shift residue
      // can't leak through.
      const clearFrom = showSign ? Math.min(signCol, writeStart) : writeStart;
      for (let cc = clearFrom; cc <= endCol; cc++) {
        if (doc.inBounds(r, cc)) {
          doc.setCell(r, cc, '');
          grid?.updateCell?.(r, cc);
        }
      }
      if (showSign && doc.inBounds(r, signCol)) {
        doc.setCell(r, signCol, op.sign);
        grid?.updateCell?.(r, signCol);
      }
      for (let j = 0; j < len; j++) {
        const cc = writeStart + j;
        if (doc.inBounds(r, cc)) {
          doc.setCell(r, cc, op.value[j]);
          grid?.updateCell?.(r, cc);
        }
      }
    }

    grid?.removeUnderline?.(bRow, underlineStart, endCol);
    grid?.addUnderline?.(bRow, underlineStart, endCol);

    // --- RESULT ROW ---
    const resEnd = endCol;
    const resStart = underlineStart;
    let correctStartCol = resEnd - (correct.length - 1);
    let correctString = correct;

    // Negative sum: pre-fill '-' so the student only types the absolute value.
    // Same logic as SubOperation — if the minus lands inside the check range
    // (correct.length == maxWidth), include it in correctString.
    if (isNegative) {
      const minusPos = correctStartCol - 1;
      if (doc.inBounds(resRow, minusPos)) {
        doc.setCell(resRow, minusPos, '-');
        grid?.updateCell?.(resRow, minusPos);
      }
      if (minusPos >= resStart) {
        correctString = '-' + correct;
        correctStartCol = minusPos;
      }
    }

    // --- SCRATCH ROW (carry/borrow overlays above operand 0) ---
    const scratchCandidate = topRow - 1;
    const scratchUsable = topRow > 0
      && !(doc.textRows?.[scratchCandidate]?.length > 0)
      && !intersectsLocked(scratchCandidate)
      && !rowHasContent(scratchCandidate, spanStart, spanEnd);
    const scratchRow = scratchUsable ? scratchCandidate : null;
    const scratchStart = spanStart;
    const scratchEnd = endCol;

    if (scratchRow != null) grid?.markScratchRow?.(scratchRow, topRow, scratchStart, scratchEnd);

    return {
      resultRange: {
        row: resRow,
        startCol: resStart,
        endCol: resEnd,
        correctDigits: correctString,
        correctStartCol,
      },
      boxRange: {
        topRow,
        bRow,
        resRow,
        startCol: spanStart,
        endCol,
        underlineStart,
        scratchRow,
        scratchStart,
        scratchEnd,
      },
    };
  }
}
