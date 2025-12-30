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

  // Save a PDF immediately without print dialog by rendering the grid to an image
  async saveInstant(doc){
    // 1) Render document to a canvas (simple grid drawing)
    const cell = 48; // px per cell (matches UI)
    const width = doc.cols * cell;
    const height = doc.rows * cell;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // draw grid lines
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    for (let r = 0; r <= doc.rows; r++){
      const y = r * cell + 0.5; // crisp lines
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    for (let c = 0; c <= doc.cols; c++){
      const x = c * cell + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    // draw characters centered in cells
    ctx.fillStyle = '#464646';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '40px sans-serif';
    for (let r = 0; r < doc.rows; r++){
      for (let c = 0; c < doc.cols; c++){
        const ch = doc.getCell(r, c)?.char || '';
        if (!ch) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        ctx.fillText(ch, x, y);
      }
    }

    // 2) Get JPEG bytes
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const jpegBytes = this._base64ToUint8(dataUrl.split(',')[1]);

    // 3) Build a simple 1-page PDF embedding the JPEG (A4 portrait)
    const pdfBlob = this._jpegToPdf(jpegBytes, width, height, 595, 842, { rows: doc.rows, cols: doc.cols }); // page in points

    // 4) Download
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LeonieLab-${new Date().toISOString().replace(/[:.]/g,'-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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
