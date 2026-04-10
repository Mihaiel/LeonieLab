/*
  DocumentService
  ----------------
  Super small helper that serializes the Document to text and
  restores it back. We use JSON for simplicity and portability.

  The output is a plain .txt file so it’s easy to share via email
  or store on disk without special tooling.
*/

// Exports/imports the grid as plain JSON text
export class DocumentService {
  exportToText(doc){
    // version 2 adds underlineRanges + operationRanges so decorations survive
    // save/load cycles (version 1 files remain readable — they just won't restore decorations)
    const payload = {
      rows: doc.rows,
      cols: doc.cols,
      grid: doc.grid,
      underlineRanges:  doc.underlineRanges  || [],
      operationRanges:  doc.operationRanges  || [],
      textRows:         doc.textRows         || {},
      version: 4,
    };
    return JSON.stringify(payload);
  }

  importFromText(text, doc){
    try{
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.grid)) return false;
      // resize doc and copy grid
      doc.rows = data.rows|0; doc.cols = data.cols|0;
      doc.grid = Array.from({ length: doc.rows }, (_, r) =>
        Array.from({ length: doc.cols }, (_, c) => ({ char: data.grid?.[r]?.[c]?.char || '' }))
      );
      // Restore structural ranges (version 2+); version 1 files default to empty arrays
      doc.underlineRanges = Array.isArray(data.underlineRanges) ? data.underlineRanges : [];
      doc.operationRanges = Array.isArray(data.operationRanges) ? data.operationRanges : [];
      // v3 stored plain strings; v4 stores { text, startCol } objects — normalise on load
      doc.textRows = {};
      if (data.textRows && typeof data.textRows === 'object') {
        for (const [key, val] of Object.entries(data.textRows)) {
          doc.textRows[key] = (typeof val === 'string')
            ? { text: val, startCol: 0 }
            : val;
        }
      }
      return true;
    }catch{ return false; }
  }
}
