# Changelog

All notable changes to LeonieLab are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

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

- `OperationManager` now exposes an `onVerdict` callback property (default `null`)
  that fires with `'correct'` or `'wrong'` when a result row is fully evaluated.
  This keeps audio concerns out of the operation logic.

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