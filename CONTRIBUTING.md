# Contributing to LeonieLab

Thank you for your interest in contributing. LeonieLab is an accessibility-focused
math worksheet app designed for students with motor impairments, built as part of a
research project at the University of Applied Sciences Campus Vienna.

Contributions of all kinds are welcome! From bug fixes, new features, accessibility
improvements, documentation, to design feedback.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Style](#code-style)
- [Project Structure](#project-structure)

---

## Getting Started

No build step or package manager is required. The project is pure HTML/CSS/JS using
ES modules.

1. **Fork** the repository and clone your fork:
   ```bash
   git clone https://github.com/your-username/LeonieLab.git
   cd LeonieLab
   ```

2. **Serve** the project with any static file server (required for ES modules to load):
   ```bash
   # Python
   python3 -m http.server 8000

   # Node
   npx serve . -l 8000
   ```

3. Open `http://localhost:8000/content/worksheet.html` in your browser.

4. Create a **new branch** for your work:
   ```bash
   git checkout -b your-feature-name
   ```

---

## Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) issue template.

Please include:
- What you did (steps to reproduce)
- What you expected to happen
- What actually happened
- Browser and OS version

---

## Requesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) issue template.

Keep the target user in mind: **students with motor impairments**. Features should
reduce required keystrokes, avoid reliance on precise pointer input, and support
slow or constrained interaction.

---

## Submitting a Pull Request

1. Make sure your branch is up to date with `main`:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. Test your changes manually in at least one modern browser (Chrome or Firefox).

3. Open a pull request against `main`. Fill out the PR template, it asks for a
   short description, what you tested, and any open questions.

4. Keep the pull requests focused. One feature or fix per PR is easier to review and safer to
   merge. If you are working on something large, open a draft PR early to discuss
   the approach.

---

## Code Style

- **No build tools** — keep it vanilla JS ES modules.
- **No external dependencies** — the project intentionally has zero npm packages.
- Follow the existing file and folder conventions:
  - `js/models/` — data structures
  - `js/ui/` — DOM rendering
  - `js/logic/` — application and operation logic
  - `js/operations/` — one file per arithmetic operation
  - `js/services/` — stateless utilities (serialisation, PDF, audio, undo)
- Prefer editing existing files over creating new ones unless the new concern is
  genuinely separate.
- Do not add comments that restate what the code already clearly says. Comments
  should explain *why*, not *what*.

---

## Project Structure

```
LeonieLab/
├── content/            # HTML entry points (index.html, worksheet.html)
├── js/
│   ├── logic/          # ApplicationLogic, OperationManager
│   ├── models/         # Document (single source of truth)
│   ├── operations/     # AddOperation, SubOperation, MulOperation, DivOperation
│   ├── services/       # DocumentService, PDFExporter, UndoManager, AudioFeedback
│   ├── ui/             # GridRenderer
│   └── main.js         # Bootstrap and event wiring
├── CHANGELOG.md
├── CONTRIBUTING.md     # This file
├── LICENSE
└── README.md
```