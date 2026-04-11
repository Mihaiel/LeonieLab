<p align="center">
  <img width="104" height="110" alt="icon" src="https://github.com/user-attachments/assets/1329565f-9f96-47c0-898e-ba93aab6bbc3" />
</p>

# LeonieLab Web Application

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

LeonieLab is a client-side, browser-based web application designed to support
accessible, structured math exercises (addition, subtraction, multiplication,
division) in a middle school oriented system for users with motor impairments.

## Preview


https://github.com/user-attachments/assets/182b1579-7d9f-418a-b77e-ddc8f89b1b80



## Project Context
- Research Project: NEST – Innovation Challenge at the University of Applied Sciences Campus Vienna
- Based on: Software Engineering

## Architecture Overview
- Pure client-side web application with no build step, no framework, no server runtime.
- HTML5 / CSS3 / vanilla JavaScript (ES modules).
- Served as static files by nginx inside Docker.
- Modular architecture inside `public/js/`:
  - `ui/` — grid renderer and DOM interface
  - `logic/` — application logic and operation manager
  - `models/` — document model (single source of truth)
  - `operations/` — addition, subtraction, multiplication, division formatters
  - `services/` — document I/O, PDF export, undo manager, audio feedback

## Project Structure

```
/
├── docker-compose.yml      # nginx service definition
├── nginx.conf              # pretty-URL routing, caching, security headers
├── deploy.sh               # one-shot: git pull -> build.json -> restart
└── public/                 # everything served by nginx
    ├── index.html          # /          (landing page)
    ├── about/index.html    # /about/
    ├── worksheet/index.html# /worksheet/
    ├── 404/index.html      # served via error_page
    ├── js/                 # ES modules for the worksheet app
    └── resources/
        ├── css/            # base, layout, components, pages
        ├── img/
        └── video/
```

## How to Run

### Option 1 — Docker (recommended)
Requires Docker + Docker Compose.

```bash
docker compose up -d
```

Then open `http://localhost:8082/` in your browser. The compose file mounts
`./public` as nginx's document root and uses `./nginx.conf` for routing.

### Option 2 — Any static file server
No build step is needed. Serve the `public/` directory directly:

```bash
cd public
python3 -m http.server 8000
# or
npx serve . -l 8000
```

Then open `http://localhost:8000/`. Pretty URLs (`/about/`, `/worksheet/`)
still work because each route has its own `index.html`.

Requirements:
- Modern browser with ES modules (Chrome, Edge, Firefox, Safari — all current).

## How to Use
- Open the landing page and click **Start Now**, or go directly to `/worksheet/`.
- The worksheet renders a 24×30 cell grid. Type a calculation inline
  (`123+45`), press **Enter** to format it vertically, then type the answer
  digit-by-digit right-to-left. Correct answers lock in blue, wrong ones
  flash red until fixed.
- Toolbar actions:
  - **Open** — Load a previously saved worksheet from a `.txt` file.
  - **Save** — Download the current worksheet as a timestamped `.txt` file.
  - **Save as PDF** — Export the grid as a single-page A4 PDF including
    underlines, locked result digits, scratch overlays, and text strips.
  - **Print** — Open the browser's print dialog.
  - **Clear All** — Reset the grid and all state.
- Keyboard shortcuts: see the landing page, or the `Keyboard showcase`
  section for the full list (arrow navigation, `Tab` to jump between
  results, `↑` for carry/borrow, `Ctrl+Z` for undo, `Esc` to cancel, …).
- Accessibility: keyboard-only input, hold-to-repeat keys, audio cues for
  correct, wrong, and rejected keystrokes.

## Deployment

The production server pulls and redeploys with a single command:

```bash
./deploy.sh
```

`deploy.sh` runs `git pull --ff-only`, writes the current commit hash and
timestamp into `public/resources/build.json` (which the footer fetches and
displays as a link to the commit on GitHub), and then runs
`docker compose up -d --remove-orphans` to restart nginx. Use
`./deploy.sh --no-pull` to regenerate only the build info without pulling.

---

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md) for instructions, code style guidelines, and the pull request process.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

[MIT](LICENSE) © 2026 Mihaiel Birta