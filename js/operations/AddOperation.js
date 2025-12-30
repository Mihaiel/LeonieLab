// Template/stub for addition operation strategy
// This file intentionally contains no formatting logic. It documents the
// intended interface for future operation-specific implementations.
export class AddOperation {
  // Optionally inspect the document around a '+' anchor and return
  // a structure describing where an operation might render.
  // Return value shape is up to the final formatter.
  analyze(doc, row, col) {
    // TODO: parse left/right digits as needed
    return null;
  }

  // Apply a formatting to the grid/document (future use)
  format(doc, grid, context) {
    // TODO: implement alignment/underline/result placement
    // For now, the app runs without any operation logic.
    return null;
  }
}
