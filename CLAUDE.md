# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A classic Tetris implementation in vanilla JavaScript (ES6+), HTML5 Canvas, and CSS. No dependencies, no build step, no `package.json`.

## Running the game

There is no build/test/lint tooling. To run:

```bash
start index.html       # Windows: open directly
# or serve statically, e.g.
npx serve .
python3 -m http.server 8000
```

Then verify changes by opening the page in a browser and playing.

## Architecture

Three files, no modules/bundler — `index.html` loads `game.js` directly as a classic script, and everything is global state.

- **`index.html`** — DOM shell: main `<canvas id="board">` (300×600, i.e. `COLS×BLOCK` by `ROWS×BLOCK`), a `<canvas id="next-canvas">` for the next-piece preview, HUD elements (`#score`, `#lines`, `#level`), and the `#overlay` used for both PAUSE and GAME OVER states.
- **`style.css`** — dark/retro arcade visual theme only; no layout logic relevant to gameplay.
- **`game.js`** — all game logic, structured around:
  - **Board model**: `ROWS × COLS` matrix of `0` (empty) or a color index `1–7` identifying the locked piece type.
  - **Pieces**: the 7 tetrominoes as square matrices in `PIECES`. Rotation (`rotateCW`) is implemented as transpose + row reversal, not stored per-orientation.
  - **Collision** (`collide`): checks piece cells against board bounds and existing locked cells.
  - **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` columns until a non-colliding position is found.
  - **Game loop** (`loop`): driven by `requestAnimationFrame`; accumulates elapsed time (`dropAccum`) and advances the piece one row once `dropInterval` is exceeded.
  - **Line clearing** (`clearLines`): scans bottom-to-top, splices full rows out and unshifts empty rows at the top.
  - **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by current `level`; hard drop adds 2 pts/cell dropped, soft drop adds 1 pt/row.
  - **Leveling/speed**: level increases every 10 lines; `dropInterval = max(100, 1000 - (level-1)*90)` ms.
  - **Ghost piece** (`ghostY`): projects the current piece straight down to its landing row, drawn at `globalAlpha = 0.2`.
  - **Rendering**: `draw()` redraws the full board each frame (grid, locked cells, ghost, current piece); `drawNext()` renders the preview canvas separately.

Control flow: `init()` builds the board and starts the loop → `loop()` handles gravity/redraw each frame → `keydown` handler dispatches move/rotate/soft-drop/hard-drop/pause → `spawn()` promotes `next` to `current` and generates a new `next`, calling `endGame()` if the new piece immediately collides.

### Tunable constants (all in `game.js`)

`COLS`, `ROWS`, `BLOCK`, `COLORS`, `LINE_SCORES`, `dropInterval`. If `COLS`/`ROWS`/`BLOCK` change, update the `<canvas id="board">` `width`/`height` in `index.html` to match (`COLS×BLOCK` and `ROWS×BLOCK`).
