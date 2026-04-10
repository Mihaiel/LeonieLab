import { DocumentService } from './DocumentService.js';

/*
  UndoManager
  -----------
  Maintains a stack of doc snapshots so Ctrl/Cmd+Z can restore
  state one keypress at a time (max 50 steps).

  Usage:
    undoMgr.push(doc, cursor)   — call BEFORE any mutation
    undoMgr.pop()               — returns { docJson, cursor } or null
    undoMgr.clear()             — wipe stack (e.g. after Clear button)
*/

const _ds = new DocumentService();

export class UndoManager {
  constructor(maxSteps = 50) {
    this.stack    = [];
    this.maxSteps = maxSteps;
  }

  push(doc, cursor) {
    this.stack.push({
      docJson: _ds.exportToText(doc),
      cursor:  { row: cursor.row, col: cursor.col },
    });
    if (this.stack.length > this.maxSteps) this.stack.shift();
  }

  pop() {
    return this.stack.pop() ?? null;
  }

  clear() {
    this.stack = [];
  }
}
