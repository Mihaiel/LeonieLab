# Changelog

All notable changes to LeonieLab are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **Audio feedback on rejected keys** — A new `AudioFeedback.rejected()` tone
  (320 Hz triangle, 50 ms, gain 0.05) fires whenever a keystroke is absorbed
  as invalid for the current mode: unrecognised keys at the bottom of
  `handleKey`, non-digit/non-Backspace/non-Enter/non-Escape keys swallowed by
  the result-entry lock, `ArrowUp` in result-entry when the operation has no
  carry row to bridge to, and `ArrowDown` in result-entry. The tone is
  deliberately much softer and shorter than `wrong()` (which signals a wrong
  answer) so a student fumbling the keyboard isn't bombarded with the
  answer-wrong sound. Wired via a new `ApplicationLogic.onRejected` callback
  that `main.js` hooks to `audio.rejected()`, mirroring the existing
  `OperationManager.onVerdict` pattern.

- **Locked result-entry mode** — Once an operation is formatted and the student
  enters the result row, the cursor is now locked inside `[startCol, endCol]` of
  that row. `ArrowLeft` / `ArrowRight` clamp within the range, `ArrowDown` is a
  no-op, and any key that isn't a digit / Backspace / Enter / Escape / arrow is
  swallowed — so a stray `+`, `-`, `*` or letter can no longer start a new
  operation on top of the one currently being solved. Tab is also disabled while
  a result entry is active, so the student stays on the current box until it's
  answered, cancelled, or deleted.

- **Escape cancels in-progress operation** — Pressing `Escape` during result
  entry deletes the entire formatted block (cells, underlines, scratch
  overlays, metadata, active state) via the new `_deleteOperationBox` helper
  and parks the cursor at the former top-left corner. Gives the student a
  one-keystroke exit from a wrongly-typed operation without having to manually
  backspace every cell.

- **Carry/borrow bridge from result-entry mode** — Since the cursor can no
  longer reach operand A directly, `ArrowUp` inside result-entry now jumps
  straight into the scratch row above A at `cursorCol + 1` (clamped into the
  scratch range). The `+ 1` matches school-style flow: after writing a digit
  the cursor sits one column to the left of where the carry belongs, so
  ArrowUp lands directly on the correct scratch cell with no follow-up
  ArrowRight. Typing one digit into the scratch overlay **auto-returns** to
  the exact result cell the student was on (`returnRow` / `returnCol` are
  stored at the moment of ArrowUp), so a two-carry addition like `187 + 29`
  costs `6 ↑1 1 ↑1 2` — seven keystrokes, no explicit ArrowDowns.

- **Free-text strips (text-row cells)** — Typing a letter into a cell whose
  left neighbour is empty automatically creates a text strip anchored at that
  column. The strip grows rightward as the student types, snapping to whole-cell
  boundaries, and sits over the grid cells as a floating overlay with a blinking
  caret. All printable characters are accepted (letters, digits, spaces, symbols).
  Backspace deletes the last character; pressing it on an empty strip removes it.
  Arrow keys and Enter exit the strip and move the grid cursor in the expected
  direction. **Multiple strips per row** are supported — a line like `20 km 30 kg`
  places two independent strips alongside the digits, each clamped so it cannot
  overflow into its right-hand neighbour. They survive save/open, undo and
  auto-save, and are excluded from arithmetic-detection so they never interfere
  with operation formatting.

- **Carry/borrow scratch overlays** — After an addition or subtraction block is
  formatted, each digit cell of the top operand (A) shows a small placeholder in
  its top-right corner for carry or borrow annotations. Press `ArrowUp` while the
  cursor is on any of those cells to enter scratch mode: type a single digit into
  the overlay, navigate between overlays with `ArrowLeft` / `ArrowRight` and
  return to the main row with `ArrowDown`, `Enter` or `Escape`. Backspace clears
  the overlay digit, or exits scratch mode if the overlay is already empty. Scratch
  data is stored in the document and survives save/open, undo, and auto-save.

- **Negative subtraction results** — Subtracting a larger number from a smaller
  one (e.g. `300−500`) is now fully supported. The formatter pre-fills a minus sign
  to the left of the result row so the student only needs to type the absolute
  value. The result is checked against the correct magnitude.

- **Audio feedback** - Short tones play when a student enters a result digit.
  A bright sine tone (A5) confirms a correct answer; a low sawtooth tone (A2)
  signals a wrong one. Removes the need to look away from the keyboard to check
  results. Implemented via the Web Audio API in `js/services/AudioFeedback.js`;
  triggered through an `onVerdict` hook on `OperationManager`.

- **Tab navigation between result rows** - Pressing Tab jumps the cursor directly
  to the next unanswered result row on the worksheet, skipping already-completed
  and empty areas. Wraps back to the first unlocked result when the end is reached.
  Activates result-entry mode immediately so the student can start typing without
  further navigation.

- **Hold-to-repeat arrow keys** — Holding an arrow key now moves the cursor
  continuously, matching the same hold-to-erase behaviour of backspace.

- **Undo (Ctrl/Cmd+Z)** - Every keypress that mutates the worksheet (digit, operator,
  Backspace, Enter) pushes a snapshot onto a 50-step undo stack before executing.
  Ctrl+Z / Cmd+Z pops the last snapshot and fully restores the document, including
  formatted operation blocks, underlines, and locked result zones, then repositions
  the cursor. Snapshots reuse the existing `DocumentService` JSON serialiser so the
  format is identical to saved files. The stack is cleared on Clear All and on file
  open (no undo past a deliberate reset).

- **Auto-save to localStorage** - The worksheet is silently saved to
  `localStorage` two seconds after any keystroke. On the next page load the session
  is restored automatically and a brief "Session restored" banner confirms it.
  Clear All removes the saved entry. Opening a file immediately replaces it.
  All localStorage calls are wrapped in try/catch so private-mode browsers or full
  storage fail silently.

### Changed

- **PDF export renders all decorations** — `PDFExporter.saveInstant(doc)` was
  rewritten from a thin "characters-only" rasteriser into a full worksheet
  renderer. It now draws underlines (including multiplication's second
  underline), locked-result digits in the app's primary blue (`#51ABEC`),
  carry/borrow scratch overlays as bold muted text in the top-right corner of
  each A-row cell, and text strips with their tinted fill, dashed border, and
  clipped text (so long strips never overflow their last cell). Cells hidden
  by a text strip are skipped in the character pass; whole scratch rows are
  skipped because their content is rendered as overlays on the A-row. The
  exported JPEG is embedded in a minimal one-page A4 PDF whose content
  stream also adds a vector text header with `LeonieLab`, the grid size, and
  the export date — no external libraries or runtime dependencies. A
  matching `@media print` CSS block drops the locked-result background tint
  and makes scratch overlays bolder and darker so the browser Print path
  produces equivalent output.

- **`PDFExporter` split into render + encode helpers** — The previously
  60-line single-blob `saveInstant` method was split into
  `_renderWorksheet(ctx, doc, cell)` (orchestrates seven ordered draw
  passes: background, grid lines, underlines, cell chars with locked blue
  color, scratch overlays, text strips with clipping) and
  `_collectRenderMeta(doc)` which walks `doc.operationRanges` and
  `doc.textRows` once to build `lockedCells`, `hiddenCells`, `scratchRows`,
  `scratchOverlays`, and `textStrips` lookups. The existing `_jpegToPdf`,
  `_base64ToUint8`, `_encode`, `_pad10`, `_pdfEscape` binary helpers are
  untouched. Adding a new visual element now means adding one ordered pass
  in `_renderWorksheet` rather than editing a monolithic loop.

- `ApplicationLogic` now exposes an `onRejected` callback property (default
  `null`) that fires whenever a keystroke is absorbed as invalid.
  `main.js` hooks it to `AudioFeedback.rejected()`. Mirrors the existing
  `OperationManager.onVerdict` pattern so audio concerns stay out of the
  input state machine.

- **`_deleteOperationBox` extracted** — The ~60-line inline locked-box teardown
  branch in `ApplicationLogic.handleKey` moved into a private
  `_deleteOperationBox(boxRange)` helper. It clears cells, strips
  `result-correct` / `result-wrong` / `box-selected` / `dataset.locked`, wipes
  the scratch row (respecting other boxes that may share the same
  `scratchRow`), removes both underlines, calls
  `opManager.removeRangeByBox`, nulls `opManager.active` when it pointed at
  the deleted box, and parks the cursor at `(topRow, startCol)`. The locked-box
  Backspace path and the new Escape-in-result-entry path both call it.

- `OperationManager` now exposes an `onVerdict` callback property (default `null`)
  that fires with `'correct'` or `'wrong'` when a result row is fully evaluated.
  This keeps audio concerns out of the operation logic.

### Fixed

- **Scratch row no longer annexes a text strip above the operation** — Addition
  and subtraction used to set `scratchRow = topRow - 1` unconditionally. If the
  row above held a text strip, `GridRenderer.scratchRows` then claimed that row
  and every `updateCell` on it got redirected into a non-existent carry
  overlay — typing was stored in the doc but rendered blank, with the cursor
  still advancing (the "cell-jumping" symptom). `AddOperation` and
  `SubOperation` now set `scratchRow = null` when
  `doc.textRows?.[topRow - 1]?.length > 0`, so operations placed directly
  below a text strip forego carry annotations for that one box rather than
  corrupt the strip.

- **`tryResumeResultAtCursor` ignores locked ranges** — Navigating back to a
  correctly-answered (locked) result and typing a digit used to re-enter edit
  mode on top of the `result-correct` cells. The predicate now filters out any
  range with `locked: true`, so locked answers stay immutable until the whole
  box is explicitly deleted.

---

## [0.1.0]

### Core grid and input
- 24-column × 30-row cell grid rendered as a CSS Grid.
- Digit and letter input (0–9, a–z for unit annotations such as kg, cm, km).
- Cursor movement via arrow keys; Backspace erases current or previous cell.
- Cursor wraps to the next row at the right edge.

### Arithmetic formatting engine
Each operation is typed inline (e.g. `123+45`) and formatted into a vertical
primary-school layout when Enter is pressed.

- **Addition (`+`)** — A on top, `+ B` below with underline, result row beneath.
- **Subtraction (`−`)** — Same vertical layout with minus sign.
- **Multiplication (`×` / `*` / `x`)** — Expression stays inline with underline;
  partial products and a final result row are generated below.
- **Division (`:` / `/`)** — Inline `A : B =` with cursor-jump scaffolding for
  quotient → remainder → brought-down digit cycling.

All four operations support **multi-row A**: if the first operand wraps from one
row to the next (user types a long number that reaches the right edge), the
formatter detects this and treats both rows as one number.

### Result entry and checking
- After formatting, the student types the answer digit-by-digit from right to left
  (school convention).
- Correct answers turn the result cells blue and lock them.
  Wrong answers turn them red until corrected.
- Locked operation blocks can be selected as a unit (highlighted together) and
  deleted with Backspace, removing the entire three-row block cleanly.

### Conflict avoidance
When a new operation would overlap an existing locked block, the formatter shifts
the output block downward in increments of three rows until a free area is found.

### Document persistence
- **Save** — Exports the worksheet as a plain `.txt` file (JSON, version 2 format)
  including cell contents, underline ranges, and operation metadata.
- **Open** — Imports a saved file and fully restores the worksheet including
  decorations and locked zones. Version 1 files (cell content only) are also
  accepted.
- **Save as PDF** — Exports the grid as a portrait PDF with configurable margins.
- **Print** — Opens the browser print dialog.
- **Clear All** — Resets the grid, all operation state, and the cursor.

### Architecture
- Pure client-side ES modules — no build step, no framework.
- `Document` is the single source of truth: `doc.grid`, `doc.underlineRanges`,
  and `doc.operationRanges` hold all persistent state.
- `GridRenderer.applyAllDecorations()` re-derives all CSS classes from doc state,
  making full re-renders (file open, undo) safe and lossless.
- `OperationManager.resultRanges` is a proxy backed by `doc.operationRanges`,
  so operation metadata survives any re-render.

[0.1.0]: https://github.com/Mihaiel/LeonieLab/releases/tag/v0.1.0