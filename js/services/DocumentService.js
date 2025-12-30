// Exports/imports the grid as plain JSON text
export class DocumentService {
  exportToText(doc){
    // keep it simple: rows, cols, grid
    const payload = {
      rows: doc.rows,
      cols: doc.cols,
      grid: doc.grid,
      version: 1
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
      return true;
    }catch{ return false; }
  }
}
