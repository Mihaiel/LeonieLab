# LeonieLab Web Application

LeonieLab is a client-side, browser-based web application designed to support
accessible, structured math exercises (addition, subtraction, multiplication,
division) in a middle school oriented system for users with motor impairments.

## Project Context
- Research Project: NEST – Innovation Challenge at the University of Applied Sciences Campus Vienna
- Based on: Software Engineering

## Architecture Overview
- Pure client-side web application
- HTML5 / CSS3 / JavaScript
- Modular architecture:
  - User Interface
  - Application Logic
  - Document Service
  - Formatting Engine
  - PDF Exporter

## How to Install
- No build step required. This is a pure client‑side app (HTML/CSS/JS).
- Run with any static file server so absolute paths like `/js/...` resolve.

Quick options:
- Python 3: `python3 -m http.server 8000`
- Node (serve): `npx serve . -l 8000`

Then open `http://localhost:8000/content/` in your browser.

Requirements:
- Modern browser with ES modules (Chrome, Edge, Firefox, Safari current).

## How to Use
- Open `http://localhost:8000/content/` and click `Start Now`, or go directly to `http://localhost:8000/content/worksheet.html`.
- The worksheet page renders a grid. Type digits to fill boxes; Backspace deletes; arrow keys navigate. Enter confirms formatting in some operations.
- Use the top bar actions:
  - `Open`: Load a previously saved worksheet from a `.txt` file.
  - `Save`: Download the current worksheet as a timestamped `.txt` file.
  - `Save as PDF`: Export the grid as a PDF (portrait, with margins).
  - `Print`: Open the browser’s print dialog for the worksheet.
  - `Clear All`: Reset the grid and selections.
- Accessibility: Large grid cells and keyboard‑first interaction support motor‑impairment friendly workflows.

Notes:
- Files and routes assume the server root is the project folder. If you open `content/index.html` directly from the filesystem, absolute paths like `/js/main.js` may not load; prefer running a local server as shown above.
