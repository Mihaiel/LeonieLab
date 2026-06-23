/*
  SettingsService
  ---------------
  Central, persistent user preferences for the worksheet. The single source of
  truth for tunable display options. Persisted to its OWN localStorage key
  (`leonielab_settings`), separate from the document autosave, so preferences
  outlive any individual worksheet.

  Two kinds of settings:
    - Visual (fonts, colors, motion)  → applied as CSS custom properties on
      :root, restyling everything instantly with no DOM rebuild.
    - Structural (cell size, rows, cols) → applied via GridRenderer.cellSize and
      a Document resize, which require a mount() + renderAll() rebuild.

  Rows/cols may only change while the worksheet is empty (see isWorksheetEmpty),
  so a resize can never discard a student's work.
*/

const STORAGE_KEY = 'leonielab_settings';

export const DEFAULTS = {
  rows: 30,
  cols: 24,
  cellSize: 48,        // px
  fsCell: 2.7,         // rem  → --fs-worksheet-cell
  fsScratch: 1.2,      // rem  → --fs-scratch
  fsUnitExp: 1.15,     // rem  → --fs-unit-exp
  fsTextStrip: 1.8,    // rem  → --fs-text-strip
  colorScratch: '#bbbbbb',   // → --color-scratch  (carry/borrow resting text)
  colorUnitExp: '#464646',   // → --color-unit-exp (matches --color-text)
  audioEnabled: true,
  reduceMotion: false,
};

// Numeric clamp ranges + slider step. Drives both load-time clamping and the
// min/max/step attributes of the dialog inputs (read by main.js).
export const LIMITS = {
  rows:        { min: 5,    max: 60,  step: 1 },
  cols:        { min: 5,    max: 40,  step: 1 },
  cellSize:    { min: 28,   max: 80,  step: 1 },
  fsCell:      { min: 1.2,  max: 4.0, step: 0.05 },
  fsScratch:   { min: 0.6,  max: 2.0, step: 0.05 },
  fsUnitExp:   { min: 0.6,  max: 2.0, step: 0.05 },
  fsTextStrip: { min: 0.8,  max: 3.0, step: 0.05 },
};

export class SettingsService {
  constructor() {
    this.settings = this.load();
  }

  // Clamp a single numeric setting to its LIMITS range (no-op for non-numeric keys).
  _clamp(key, value) {
    const lim = LIMITS[key];
    if (!lim || typeof value !== 'number' || Number.isNaN(value)) return value;
    return Math.min(lim.max, Math.max(lim.min, value));
  }

  // Read + parse localStorage, merge over DEFAULTS (so newly-added keys get a
  // default), clamp every numeric. Never throws — falls back to defaults.
  load() {
    const merged = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          for (const key of Object.keys(DEFAULTS)) {
            if (key in data) merged[key] = data[key];
          }
        }
      }
    } catch (_) { /* corrupt / unavailable → defaults */ }
    for (const key of Object.keys(LIMITS)) merged[key] = this._clamp(key, merged[key]);
    return merged;
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch (_) {}
  }

  get() { return this.settings; }

  // Merge a patch (clamping numerics) and persist.
  set(patch) {
    for (const [key, value] of Object.entries(patch)) {
      this.settings[key] = (key in LIMITS) ? this._clamp(key, value) : value;
    }
    this.save();
    return this.settings;
  }

  reset() {
    this.settings = { ...DEFAULTS };
    this.save();
    return this.settings;
  }

  // --- Apply helpers ---

  // Fonts, colors, and reduce-motion → CSS custom properties / root class.
  // Cheap (no rebuild); safe to call before the grid is mounted.
  applyVisual() {
    const s = this.settings;
    const root = document.documentElement;
    root.style.setProperty('--fs-worksheet-cell', `${s.fsCell}rem`);
    root.style.setProperty('--fs-scratch',        `${s.fsScratch}rem`);
    root.style.setProperty('--fs-unit-exp',        `${s.fsUnitExp}rem`);
    root.style.setProperty('--fs-text-strip',      `${s.fsTextStrip}rem`);
    root.style.setProperty('--color-scratch',      s.colorScratch);
    root.style.setProperty('--color-unit-exp',     s.colorUnitExp);
    root.classList.toggle('reduce-motion', !!s.reduceMotion);
  }

  applyAudio(audio) {
    if (audio) audio.enabled = !!this.settings.audioEnabled;
  }

  // Set the renderer's cell size. Caller decides when to mount (the change only
  // takes visual effect on the next mount()).
  applyCellSize(grid) {
    if (grid) grid.cellSize = this.settings.cellSize;
  }

  // Resize the document grid to the configured rows/cols and rebuild. ONLY safe
  // to call when the worksheet is empty (guarded by callers via isWorksheetEmpty),
  // so there is no in-bounds content to preserve and no dangling decorations to
  // prune. Returns true if a resize actually happened.
  applyGridSize(doc, grid, logic) {
    const s = this.settings;
    if (!doc || (doc.rows === s.rows && doc.cols === s.cols)) return false;
    doc.rows = s.rows;
    doc.cols = s.cols;
    doc.grid = Array.from({ length: doc.rows }, () =>
      Array.from({ length: doc.cols }, () => ({ char: '' }))
    );
    // Empty sheet → these are already empty, but reset for safety.
    doc.underlineRanges = [];
    doc.operationRanges = [];
    doc.textRows = {};
    doc.exponents = {};
    if (grid) { grid.cellSize = s.cellSize; grid.mount(); grid.renderAll(); }
    logic?.init?.();
    return true;
  }

  // True when the worksheet has no content at all — every cell blank and no
  // decorations/annotations. Used to gate rows/cols changes.
  static isWorksheetEmpty(doc) {
    if (!doc) return true;
    if ((doc.operationRanges?.length ?? 0) > 0) return false;
    if ((doc.underlineRanges?.length ?? 0) > 0) return false;
    if (Object.keys(doc.textRows || {}).length > 0) return false;
    if (Object.keys(doc.exponents || {}).length > 0) return false;
    for (let r = 0; r < doc.rows; r++) {
      for (let c = 0; c < doc.cols; c++) {
        if (doc.grid?.[r]?.[c]?.char) return false;
      }
    }
    return true;
  }
}
