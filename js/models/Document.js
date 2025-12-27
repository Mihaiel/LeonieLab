export class Document {
  constructor(name = "Untitled") {
    this.name = name;
    this.cells = [];
    this.metadata = {};
  }
}