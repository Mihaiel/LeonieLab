// Very small print helper that sets CSS vars and calls window.print
export class PDFExporter {
  print({ orientation = 'portrait', marginMm = 10 } = {}){
    const root = document.documentElement;
    // set margin var used by print CSS
    root.style.setProperty('--print-margin-mm', `${marginMm}mm`);
    // set page width var via orientation class
    const PORTRAIT = 'print-portrait';
    const LANDSCAPE = 'print-landscape';
    root.classList.remove(PORTRAIT, LANDSCAPE);
    root.classList.add(orientation === 'landscape' ? LANDSCAPE : PORTRAIT);
    // print next frame
    requestAnimationFrame(() => {
      window.print();
      setTimeout(() => {
        root.classList.remove(PORTRAIT, LANDSCAPE);
        root.style.removeProperty('--print-margin-mm');
      }, 300);
    });
  }

  // Save a PDF immediately without a print dialog. The doc is rasterized to
  // a canvas that mirrors the live worksheet — grid lines, underlines, locked
  // result cells (blue), carry/borrow scratch overlays, and text strips —
  // then embedded as a JPEG inside a minimal A4 PDF.
  async saveInstant(doc){
    const CELL = 48; // px per cell, matches the on-screen grid
    const width  = doc.cols * CELL;
    const height = doc.rows * CELL;
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    this._renderWorksheet(ctx, doc, CELL);

    // Encode → PDF → download
    const dataUrl   = canvas.toDataURL('image/jpeg', 0.92);
    const jpegBytes = this._base64ToUint8(dataUrl.split(',')[1]);
    const pdfBlob   = this._jpegToPdf(jpegBytes, width, height, 595, 842, { rows: doc.rows, cols: doc.cols });
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LeonieLab-${new Date().toISOString().replace(/[:.]/g,'-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ===== Worksheet rendering =======================================

  // Draw the full worksheet to a canvas. Order matters: background tints
  // first, then grid lines and underlines, then text (so strokes never
  // paint over characters). Cells hidden by a text strip are skipped in
  // the character pass and replaced by the strip overlay at the end.
  _renderWorksheet(ctx, doc, cell) {
    const meta = this._collectRenderMeta(doc);
    const width  = doc.cols * cell;
    const height = doc.rows * cell;

    // 1. White page
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Grid lines
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    for (let r = 0; r <= doc.rows; r++) {
      const y = r * cell + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    for (let c = 0; c <= doc.cols; c++) {
      const x = c * cell + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }

    // 3. Underlines (operator row, plus optional multiplication underline 2)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    for (const ul of doc.underlineRanges || []) {
      const y  = (ul.row + 1) * cell - 1.5;
      const x1 = ul.startCol * cell;
      const x2 = (ul.endCol + 1) * cell;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    }

    // 4. Cell characters — skip hidden strip cells and skip scratch rows
    //    (scratch content is rendered as overlays on the A-row instead).
    //    Locked-result digits are drawn in the app's primary blue so they
    //    stand out from the rest of the worksheet without a background tint.
    ctx.font = '40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < doc.rows; r++) {
      if (meta.scratchRows.has(r)) continue;
      for (let c = 0; c < doc.cols; c++) {
        const ch = doc.getCell(r, c)?.char || '';
        if (!ch) continue;
        if (meta.hiddenCells.has(`${r}:${c}`)) continue;
        ctx.fillStyle = meta.lockedCells.has(`${r}:${c}`) ? '#51ABEC' : '#464646';
        ctx.fillText(ch, c * cell + cell / 2, r * cell + cell / 2);
      }
    }

    // 5. Carry/borrow scratch overlays — small muted text in the top-right
    //    corner of each covered A-row cell. Font is larger and the colour
    //    darker than the live on-screen overlay (#bbb) so it survives JPEG
    //    compression and printed output without disappearing.
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#6f6f6f';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    for (const { scratchRow, topRow, startCol, endCol } of meta.scratchOverlays) {
      for (let c = startCol; c <= endCol; c++) {
        const ch = doc.getCell(scratchRow, c)?.char || '';
        if (!ch) continue;
        ctx.fillText(ch, c * cell + cell - 4, topRow * cell + 3);
      }
    }

    // 6. Text strips — floating overlays with tinted fill + dashed border.
    //    Text is clipped to the strip's inner bounds so it can't overflow
    //    beyond the strip's last cell (matches the live overlay's
    //    `overflow: hidden` behaviour).
    for (const { row, startCol, endCol, text } of meta.textStrips) {
      const x = startCol * cell;
      const y = row * cell;
      const w = (endCol - startCol + 1) * cell;
      const h = cell;
      ctx.fillStyle = '#fffef5';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.save();
      ctx.strokeStyle = '#ccc';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, w - 4, h - 4);
      ctx.clip();
      ctx.fillStyle = '#464646';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 8, y + cell / 2);
      ctx.restore();
    }
  }

  // Walk doc once and collect everything the renderer needs. Returns:
  //   lockedCells:     Set<"r:c"> of cells inside a locked result range
  //   hiddenCells:     Set<"r:c"> of cells covered by a text strip
  //   scratchRows:     Set<row>   of rows whose content lives in overlays
  //   scratchOverlays: Array<{ scratchRow, topRow, startCol, endCol }>
  //   textStrips:      Array<{ row, startCol, endCol, text }>
  _collectRenderMeta(doc) {
    const lockedCells     = new Set();
    const hiddenCells     = new Set();
    const scratchRows     = new Set();
    const scratchOverlays = [];
    const textStrips      = [];

    for (const range of doc.operationRanges || []) {
      if (range.locked) {
        const s = range.lockedStartCol ?? range.startCol;
        const e = range.lockedEndCol   ?? range.endCol;
        for (let c = s; c <= e; c++) lockedCells.add(`${range.row}:${c}`);
      }
      const b = range.boxRange;
      if (b && b.scratchRow != null && !scratchRows.has(b.scratchRow)) {
        scratchRows.add(b.scratchRow);
        scratchOverlays.push({
          scratchRow: b.scratchRow,
          topRow:     b.topRow,
          startCol:   b.scratchStart ?? b.startCol,
          endCol:     b.scratchEnd   ?? b.endCol,
        });
      }
    }

    if (doc.textRows) {
      for (const [rStr, val] of Object.entries(doc.textRows)) {
        const r = parseInt(rStr);
        const strips = Array.isArray(val) ? val : (val ? [val] : []);
        for (const s of strips) {
          const startCol = s?.startCol ?? 0;
          const endCol   = s?.endCol   ?? startCol;
          const text     = s?.text ?? (typeof s === 'string' ? s : '');
          textStrips.push({ row: r, startCol, endCol, text });
          for (let c = startCol; c <= endCol; c++) hiddenCells.add(`${r}:${c}`);
        }
      }
    }

    return { lockedCells, hiddenCells, scratchRows, scratchOverlays, textStrips };
  }

  // ===== PDF / JPEG encoding helpers ================================

  _base64ToUint8(b64){
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  _encode(str){
    return new TextEncoder().encode(str);
  }

  _pad10(n){
    return String(n).padStart(10, '0');
  }

  // rough width estimate in points for Helvetica (good enough for right-align header)
  _estimateTextWidth(text, fontSizePt){
    // assume ~0.55em average width; tweak as needed
    const avg = 0.55; // fraction of font size per character
    return Math.ceil((text.length * fontSizePt * avg));
  }

  _jpegToPdf(jpegBytes, imgW, imgH, pageW = 595, pageH = 842, meta = {}){
    // scale image to fit page (keep aspect), draw at bottom-left
    const scale = Math.min(pageW / imgW, pageH / imgH);
    const drawW = Math.max(1, Math.floor(imgW * scale));
    const drawH = Math.max(1, Math.floor(imgH * scale));

    const parts = []; // Uint8Array segments
    const offsets = []; // byte offsets for objects (1-based indexing)
    let size = 0;
    const add = (u8) => { parts.push(u8); size += u8.length; };
    const addStr = (s) => add(this._encode(s));

    // header
    addStr('%PDF-1.4\n');
    add(new Uint8Array([0x25,0xE2,0xE3,0xCF,0xD3,0x0A])); // %âãÏÓ

    // 1: Catalog
    offsets[1] = size; addStr('1 0 obj\n');
    addStr('<< /Type /Catalog /Pages 2 0 R >>\n');
    addStr('endobj\n');

    // 2: Pages
    offsets[2] = size; addStr('2 0 obj\n');
    addStr('<< /Type /Pages /Count 1 /Kids [3 0 R] >>\n');
    addStr('endobj\n');

    // 3: Page
    offsets[3] = size; addStr('3 0 obj\n');
    addStr('<< /Type /Page /Parent 2 0 R ' +
           `/MediaBox [0 0 ${pageW} ${pageH}] ` +
           '/Resources << ' +
             '/ProcSet [/PDF /Text /ImageC] ' +
             '/Font <</F1 6 0 R /F2 7 0 R>> ' +
             '/XObject <</Im0 4 0 R>> ' +
           '>> ' +
           '/Contents 5 0 R >>\n');
    addStr('endobj\n');

    // 4: Image XObject (JPEG)
    offsets[4] = size; addStr('4 0 obj\n');
    addStr('<< /Type /XObject /Subtype /Image ' +
           `/Width ${imgW} /Height ${imgH} ` +
           '/ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
           `/Filter /DCTDecode /Length ${jpegBytes.length} >>\n`);
    addStr('stream\n');
    add(jpegBytes);
    addStr('\nendstream\nendobj\n');

    // 5: Contents stream: header text at top-left, then image at bottom-left
    const left = 24; // pts margin
    const line1Y = Math.max(pageH - 24, 24);
    const line2Y = line1Y - 16;
    const line3Y = line2Y - 16;
    const rows = meta?.rows|0; const cols = meta?.cols|0;
    const l1 = this._pdfEscape('LeonieLab');
    const l2 = this._pdfEscape(`Grid: ${rows}x${cols}`);
    const l3 = this._pdfEscape(`Date: ${new Date().toISOString().slice(0,16).replace('T',' ')}`);
    const content = [
      'q',
      'BT',
      '0.2745 0.2745 0.2745 rg',
      '/F1 16 Tf',
      `1 0 0 1 ${left} ${line1Y} Tm`,
      `(${l1}) Tj`,
      'ET',
      'BT',
      '0.2745 0.2745 0.2745 rg',
      '/F2 12 Tf',
      `1 0 0 1 ${left} ${line2Y} Tm`,
      `(${l2}) Tj`,
      'ET',
      'BT',
      '0.2745 0.2745 0.2745 rg',
      '/F2 12 Tf',
      `1 0 0 1 ${left} ${line3Y} Tm`,
      `(${l3}) Tj`,
      'ET',
      'Q',
      'q',
      `${drawW} 0 0 ${drawH} 0 0 cm`,
      '/Im0 Do',
      'Q',
      ''
    ].join('\n');
    const contentBytes = this._encode(content);
    offsets[5] = size; addStr('5 0 obj\n');
    addStr(`<< /Length ${contentBytes.length} >>\nstream\n`);
    add(contentBytes);
    addStr('endstream\nendobj\n');

    // 6: Font objects (Base14 fonts)
    offsets[6] = size; addStr('6 0 obj\n');
    addStr('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\n');
    addStr('endobj\n');
    offsets[7] = size; addStr('7 0 obj\n');
    addStr('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n');
    addStr('endobj\n');

    // xref
    const xrefStart = size;
    addStr('xref\n');
    addStr('0 8\n');
    addStr('0000000000 65535 f \n');
    for (let i = 1; i <= 7; i++) addStr(this._pad10(offsets[i]) + ' 00000 n \n');

    // trailer
    addStr('trailer\n');
    addStr('<< /Size 8 /Root 1 0 R >>\n');
    addStr('startxref\n');
    addStr(String(xrefStart) + '\n');
    addStr('%%EOF');

    // concat
    const out = new Uint8Array(size);
    let pos = 0;
    for (const seg of parts){ out.set(seg, pos); pos += seg.length; }
    return new Blob([out], { type: 'application/pdf' });
  }

  _pdfEscape(s){
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
