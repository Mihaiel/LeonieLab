/*
  FractionOperation (Bruchrechnung)
  ---------------------------------
  Triggered by '/' (':' stays long division). The student types a fraction
  inline — e.g. "12/4" — and presses Enter. We reformat it into a stacked
  3-row block and set up result entry.

  Operand display: the given numerator/denominator are NOT written into single
  grid cells (that left a 1-digit denominator stranded under the first digit of
  a 2-digit numerator). Instead each is rendered as a CENTERED TEXT OVERLAY
  spanning the fraction's full column width (GridRenderer.addFractionText), so
  "4" sits centered under "12". The cells underneath stay empty and are
  protected from editing (OperationManager.isFractionCellProtected).

  The answer depends on the reduced value of n/d:
    • reduced denominator == 1        → whole number   (12/4 = 3)
    • reduced numerator  <  denom.    → proper fraction (6/8 = 3/4)
    • reduced numerator  >  denom.    → mixed number    (16/5 = 3 1/5)

  Whole-number answers use the standard single-field result entry. Proper and
  mixed answers use a GROUP of stacked fields (kind:'fraction-part', ordered by
  `seq`): the cursor auto-advances between them and the answer is only checked /
  locked / dinged once EVERY field is filled (so typing just the numerator can
  never mark the whole block correct). Arrow Up/Down moves between fields.
*/
export class FractionOperation {
  // Fractions keep no persistent jumping state; the result-entry machinery owns
  // the interaction. Present so begin()/reset() can call it uniformly.
  resetState() {}

  format(doc, grid, { row, anchorCol }, opManager) {
    const typedRow = row;
    if (doc.getCell(row, anchorCol)?.char !== '/') return;

    const parsed = this.parseAround(doc, typedRow, anchorCol);
    if (!parsed) return;
    const { numStart, numStr, denEnd, denStr } = parsed;

    const numerator   = parseInt(numStr, 10);
    const denominator = parseInt(denStr, 10);
    if (!denominator) return; // division by zero / empty → leave inline untouched

    const reduced = this.reduce(numerator, denominator);
    const rn = reduced.num, rd = reduced.den;

    // --- operand layout sizing -----------------------------------------
    const W          = Math.max(numStr.length, denStr.length); // operand fraction width
    const blockStart = numStart;
    const opEndCol   = blockStart + W - 1;
    const eqCol      = opEndCol + 1;   // '=' directly after the fraction
    const resStart   = eqCol + 1;      // result directly after '='

    // --- clear the inline expression on typedRow (before the conflict scan
    //     so the typed cells can't count as occupied) ---------------------
    for (let c = numStart; c <= denEnd; c++) {
      if (doc.inBounds(typedRow, c)) { doc.setCell(typedRow, c, ''); grid?.updateCell?.(typedRow, c); }
    }

    // Work out the result's right-most column up-front so the conflict scan
    // reserves the full width.
    const isWhole = rd === 1;
    const isMixed = !isWhole && rn > rd;
    let endCol;
    if (isWhole) {
      endCol = resStart + String(rn).length - 1;
    } else if (isMixed) {
      const wholeStr = String(Math.floor(rn / rd));
      const remStr   = String(rn % rd);
      const Wr       = Math.max(remStr.length, String(rd).length);
      endCol = resStart + wholeStr.length + Wr - 1; // whole then fraction, no gap
    } else {
      const Wr = Math.max(String(rn).length, String(rd).length);
      endCol = resStart + Wr - 1;
    }

    // --- find 3 free rows: numerator / bar+'='+result / denominator ------
    const spanStart = blockStart, spanEnd = endCol;
    const within = (r, c) => r >= 0 && r < doc.rows && c >= 0 && c < doc.cols;
    const rowHasContent = (r, s, e) => {
      if (r < 0 || r >= doc.rows) return false;
      if (doc.textRows?.[r]?.length > 0) return true;
      for (let c = s; c <= e; c++) { if (within(r, c) && doc.getCell(r, c)?.char) return true; }
      return false;
    };
    const intersectsLocked = (r) =>
      !!opManager?.resultRanges?.some(b =>
        b.locked && b.boxRange &&
        r >= b.boxRange.topRow && r <= b.boxRange.resRow &&
        !(spanEnd < b.boxRange.startCol || spanStart > b.boxRange.endCol)
      );
    let rowShift = 0;
    while (
      typedRow + 2 + rowShift < doc.rows &&
      (
        intersectsLocked(typedRow + rowShift) ||
        intersectsLocked(typedRow + 1 + rowShift) ||
        intersectsLocked(typedRow + 2 + rowShift) ||
        rowHasContent(typedRow + rowShift,     spanStart, spanEnd) ||
        rowHasContent(typedRow + 1 + rowShift, spanStart, spanEnd) ||
        rowHasContent(typedRow + 2 + rowShift, spanStart, spanEnd)
      )
    ) {
      rowShift += 3;
    }
    const topRow = typedRow + rowShift;
    const midRow = topRow + 1;
    const denRow = topRow + 2;

    // --- operand fraction: centered text overlays + bar + '=' ------------
    grid?.addFractionText?.(topRow, blockStart, opEndCol, numStr);
    grid?.addFractionText?.(denRow, blockStart, opEndCol, denStr);
    grid?.addFractionBar?.(midRow, blockStart, opEndCol);
    if (doc.inBounds(midRow, eqCol)) { doc.setCell(midRow, eqCol, '='); grid?.updateCell?.(midRow, eqCol); }

    const boxRange = {
      topRow, bRow: midRow, resRow: denRow,
      startCol: blockStart, endCol,
      kind: 'fraction',
    };

    // Build a result field range right-aligned to `endCol` of [startCol,endCol].
    const field = (fieldRow, startCol, fieldEnd, digits, extra = {}) => ({
      row: fieldRow, startCol, endCol: fieldEnd,
      correctDigits: digits,
      correctStartCol: fieldEnd - (digits.length - 1),
      ...extra,
    });

    // --- whole number: single field on the middle row --------------------
    if (isWhole) {
      return { resultRange: field(midRow, resStart, endCol, String(rn)), boxRange };
    }

    // --- mixed number: whole part + stacked remainder fraction -----------
    if (isMixed) {
      const wholeStr = String(Math.floor(rn / rd));
      const remStr   = String(rn % rd);
      const rdStr    = String(rd);
      const wholeEnd = resStart + wholeStr.length - 1;
      const fracStart = wholeEnd + 1;   // fraction directly after the whole part
      const fracEnd   = endCol;
      grid?.addFractionBar?.(midRow, fracStart, fracEnd);
      const wholeField = field(midRow, resStart,  wholeEnd, wholeStr, { kind: 'fraction-part', seq: 0 });
      const numField   = field(topRow, fracStart, fracEnd,  remStr,  { kind: 'fraction-part', seq: 1 });
      const denField   = field(denRow, fracStart, fracEnd,  rdStr,   { kind: 'fraction-part', seq: 2 });
      return { resultRange: wholeField, extraResultRanges: [numField, denField], boxRange };
    }

    // --- proper fraction: stacked numerator / denominator ----------------
    grid?.addFractionBar?.(midRow, resStart, endCol);
    const numField = field(topRow, resStart, endCol, String(rn), { kind: 'fraction-part', seq: 0 });
    const denField = field(denRow, resStart, endCol, String(rd), { kind: 'fraction-part', seq: 1 });
    return { resultRange: numField, extraResultRanges: [denField], boxRange };
  }

  // Reduce n/d to lowest terms. Returns { num, den } with den >= 1.
  reduce(n, d) {
    const g = this._gcd(Math.abs(n), Math.abs(d)) || 1;
    return { num: n / g, den: d / g };
  }
  _gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }

  // Parse the numerator (digits left of '/') and denominator (digits right).
  parseAround(doc, row, opCol) {
    if (row < 0 || row >= doc.rows || opCol == null) return null;

    let numEnd = opCol - 1, numStart = numEnd;
    while (numStart >= 0 && /\d/.test(doc.getCell(row, numStart)?.char || '')) numStart--;
    numStart++;

    let denStart = opCol + 1, denEnd = denStart;
    while (denEnd < doc.cols && /\d/.test(doc.getCell(row, denEnd)?.char || '')) denEnd++;
    denEnd--;

    if (numStart > numEnd || denStart > denEnd) return null;

    const numStr = this._digits(doc, row, numStart, numEnd);
    const denStr = this._digits(doc, row, denStart, denEnd);
    if (!numStr || !denStr) return null;

    return { numStart, numEnd, numStr, denStart, denEnd, denStr };
  }

  _digits(doc, row, s, e) {
    let out = '';
    for (let c = s; c <= e; c++) {
      const ch = doc.getCell(row, c)?.char || '';
      if (ch >= '0' && ch <= '9') out += ch;
    }
    return out;
  }
}
