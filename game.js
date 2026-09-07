'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#a5d8ff', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

// ---- Temas visuales / skins ----
// Cada skin define su paleta (índices 1-7, igual que COLORS), un color de
// fondo del tablero (null = usar el de CSS), un color de rejilla opcional y
// la función que dibuja un bloque. Se cambia sin recargar.
const SKINS = {
  retro: {
    label: 'Retro',
    colors: COLORS,
    board: null,
    grid: null,
    render: renderRetro,
  },
  neon: {
    label: 'Neon',
    colors: [null, '#00e5ff', '#ffe600', '#e040fb', '#00e676', '#ff1744', '#2979ff', '#ff9100'],
    board: '#000000',
    grid: 'rgba(255, 255, 255, 0.06)',
    render: renderNeon,
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#9be7e4', '#ffe9a8', '#d9b8e8', '#b8e0c2', '#f2b8b8', '#bcd3f2', '#f2d0a8'],
    board: null,
    grid: null,
    render: renderPastel,
  },
  pixel: {
    label: 'Pixel art',
    colors: COLORS,
    board: null,
    grid: null,
    render: renderPixel,
  },
};

const SKIN_KEY = 'tetris-skin';
let activeSkin = SKINS.retro;
let activeSkinName = 'retro';

const LINE_SCORES = [0, 100, 300, 500, 800];
const LIGHTNING_EVERY = 5;
const LIGHTNING_BONUS = 150;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const aimBanner = document.getElementById('aim-banner');
const themeToggleBtn = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

const THEME_KEY = 'tetris-theme';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingLightning, lightningMilestone, aiming, aimX, aimY;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function registerClearedLines(cleared) {
  if (!cleared) return;
  lines += cleared;
  score += (LINE_SCORES[cleared] || 0) * level;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  if (Math.floor(lines / LIGHTNING_EVERY) > lightningMilestone) {
    lightningMilestone = Math.floor(lines / LIGHTNING_EVERY);
    pendingLightning = true;
  }
  updateHUD();
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  registerClearedLines(cleared);
}

function applyLightning(x, y) {
  const rowWasFull = board[y].every(v => v !== 0);
  for (let r = 0; r < ROWS; r++) board[r][x] = 0;
  board.splice(y, 1);
  board.unshift(new Array(COLS).fill(0));
  score += LIGHTNING_BONUS * level;
  if (rowWasFull) registerClearedLines(1);
  else updateHUD();
  clearLines();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  if (pendingLightning) {
    pendingLightning = false;
    startAiming();
  } else {
    spawn();
  }
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function startAiming() {
  aiming = true;
  aimX = Math.floor(COLS / 2);
  aimY = ROWS - 1;
  dropAccum = 0;
  aimBanner.classList.remove('hidden');
}

function fireLightning() {
  aiming = false;
  aimBanner.classList.add('hidden');
  applyLightning(aimX, aimY);
  dropAccum = 0;
  if (pendingLightning) {
    pendingLightning = false;
    startAiming();
  } else {
    spawn();
  }
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = activeSkin.colors[colorIndex];
  context.save();
  context.globalAlpha = alpha ?? 1;
  activeSkin.render(context, x * size, y * size, size, color);
  context.restore();
}

// --- Renderizadores por skin: (ctx, px, py, s, color) ---
function renderRetro(context, px, py, s, color) {
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, s - 2, s - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(px + 1, py + 1, s - 2, 4);
}

function renderNeon(context, px, py, s, color) {
  context.shadowColor = color;
  context.shadowBlur = s * 0.55;
  context.fillStyle = color;
  context.fillRect(px + 3, py + 3, s - 6, s - 6);
  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(255,255,255,0.9)';
  context.lineWidth = 1;
  context.strokeRect(px + 3.5, py + 3.5, s - 7, s - 7);
}

function renderPastel(context, px, py, s, color) {
  const r = Math.max(4, s * 0.28);
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(px + 1.5, py + 1.5, s - 3, s - 3, r);
  context.fill();
  context.fillStyle = 'rgba(255,255,255,0.4)';
  context.beginPath();
  context.roundRect(px + 3, py + 3, s - 6, (s - 6) * 0.4, r * 0.7);
  context.fill();
}

function renderPixel(context, px, py, s, color) {
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, s - 2, s - 2);
  const u = (s - 2) / 4;
  const x0 = px + 1, y0 = py + 1;
  context.fillStyle = 'rgba(255,255,255,0.22)';
  context.fillRect(x0, y0, u, u);
  context.fillRect(x0 + u, y0, u, u);
  context.fillRect(x0, y0 + u, u, u);
  context.fillStyle = 'rgba(0,0,0,0.28)';
  context.fillRect(x0 + 3 * u, y0 + 3 * u, u, u);
  context.fillRect(x0 + 2 * u, y0 + 3 * u, u, u);
  context.fillRect(x0 + 3 * u, y0 + 2 * u, u, u);
  context.fillStyle = 'rgba(0,0,0,0.14)';
  context.fillRect(x0 + 2 * u, y0 + 2 * u, u, u);
}

function applySkin(name) {
  activeSkinName = SKINS[name] ? name : 'retro';
  activeSkin = SKINS[activeSkinName];
  canvas.style.background = activeSkin.board || '';
  nextCanvas.style.background = activeSkin.board || '';
  if (skinSelect) skinSelect.value = activeSkinName;
  if (board) { draw(); drawNext(); }
}

function drawGrid() {
  ctx.strokeStyle = activeSkin.grid
    || getComputedStyle(document.body).getPropertyValue('--grid-color').trim()
    || '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  if (gameOver) return;

  if (aiming) {
    drawAimCross();
    return;
  }

  // ghost
  const gy = ghostY();

  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawAimCross() {
  const markCell = (c, r, fill, width) => {
    ctx.fillStyle = fill;
    ctx.fillRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
    ctx.strokeStyle = 'rgba(22, 22, 32, 0.9)';
    ctx.lineWidth = width;
    ctx.strokeRect(c * BLOCK + width / 2, r * BLOCK + width / 2, BLOCK - width, BLOCK - width);
  };

  const CROSS = 'rgba(160, 164, 178, 0.5)';
  for (let c = 0; c < COLS; c++) if (c !== aimX) markCell(c, aimY, CROSS, 1);
  for (let r = 0; r < ROWS; r++) if (r !== aimY) markCell(aimX, r, CROSS, 1);

  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
  markCell(aimX, aimY, `rgba(245, 245, 66, ${pulse.toFixed(2)})`, 2);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  animId = null;
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver || aiming) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (aiming) { draw(); animId = requestAnimationFrame(loop); return; }
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) { draw(); return; }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  pendingLightning = false;
  lightningMilestone = 0;
  aiming = false;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  aimBanner.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;

  if (aiming) {
    switch (e.code) {
      case 'ArrowLeft':  aimX = Math.max(0, aimX - 1); break;
      case 'ArrowRight': aimX = Math.min(COLS - 1, aimX + 1); break;
      case 'ArrowUp':    aimY = Math.max(0, aimY - 1); break;
      case 'ArrowDown':  aimY = Math.min(ROWS - 1, aimY + 1); break;
      case 'Space':      e.preventDefault(); fireLightning(); break;
    }
    return;
  }

  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
}

function toggleTheme() {
  const theme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
}

themeToggleBtn.addEventListener('click', toggleTheme);
applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');

skinSelect.addEventListener('change', () => {
  localStorage.setItem(SKIN_KEY, skinSelect.value);
  applySkin(skinSelect.value);
});
applySkin(localStorage.getItem(SKIN_KEY));

init();
