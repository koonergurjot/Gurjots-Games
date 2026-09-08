// Daily Word Puzzle. A Wordle-style guessing game: everyone who opens this
// page on the same calendar day (UTC) gets the same five-letter answer, so
// the puzzle is inherently shared without needing a server -- the date
// itself is the seed. Six guesses, an on-screen keyboard that remembers what
// it has learned, and a streak that only survives consecutive days won.
import { play as playSfx } from '../../shared/juice/audio.js';
import { gameEvent } from '../../shared/telemetry.js';
import { send } from '../common/diag-adapter.js';
import { drawBootPlaceholder, showErrorOverlay } from '../common/boot-utils.js';
import { ANSWERS } from './words.js';

const SLUG = 'word-puzzle';
const WORD_LEN = 5;
const MAX_GUESSES = 6;
const STORAGE_DAY_KEY = 'gg:word-puzzle:day';
const STORAGE_STREAK_KEY = 'gg:word-puzzle:streak';

const BASE_W = 440;
const BASE_H = 700;
const TILE = 60;
const TILE_GAP = 8;
const GRID_TOP = 24;
const GRID_W = WORD_LEN * TILE + (WORD_LEN - 1) * TILE_GAP;
const GRID_X = (BASE_W - GRID_W) / 2;

const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back'],
];

const RANK = { absent: 0, present: 1, correct: 2 };
const TILE_COLOR = { correct: '#22c55e', present: '#eab308', absent: '#4b5563', empty: '#111826' };
const KEY_COLOR = { correct: '#22c55e', present: '#eab308', absent: '#374151', unknown: '#2a3346' };

// Days since the Unix epoch, in UTC. Date.now() is already a UTC timestamp,
// so this needs no timezone handling: every visitor on Earth divides the
// same millisecond count by the same day length and lands on the same index.
function dayIndex() {
  return Math.floor(Date.now() / 86400000);
}

function scoreGuess(guess, answer) {
  const result = new Array(WORD_LEN).fill('absent');
  const answerChars = answer.split('');
  const guessChars = guess.split('');
  const remaining = {};
  for (let i = 0; i < WORD_LEN; i++) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = 'correct';
    } else {
      remaining[answerChars[i]] = (remaining[answerChars[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] === 'correct') continue;
    const ch = guessChars[i];
    if (remaining[ch] > 0) {
      result[i] = 'present';
      remaining[ch] -= 1;
    }
  }
  return result;
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Progress is a nicety; never break play over storage limits.
  }
}

function boot() {
  const canvas = document.getElementById('game');
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) {
    console.error('[word-puzzle] Missing canvas or 2D context');
    send('GAME_ERROR', { reason: 'no-canvas' });
    showErrorOverlay('Canvas rendering is not supported on this device.');
    return;
  }

  drawBootPlaceholder(canvas, ctx, "Loading today's word…");

  const statusEl = document.getElementById('status');
  const guessCountEl = document.getElementById('guessCount');
  const streakEl = document.getElementById('streak');
  const bestStreakEl = document.getElementById('bestStreak');

  const index = dayIndex();
  const answer = ANSWERS[index % ANSWERS.length];

  let guesses = [];
  let rowResults = [];
  let currentGuess = '';
  let gameOver = false;
  let won = false;
  let keyStates = {};
  let keyHitboxes = [];

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function updateStats() {
    if (guessCountEl) guessCountEl.textContent = `${guesses.length}/${MAX_GUESSES}`;
    const streak = readJSON(STORAGE_STREAK_KEY) || { current: 0, best: 0 };
    if (streakEl) streakEl.textContent = String(streak.current || 0);
    if (bestStreakEl) bestStreakEl.textContent = String(streak.best || 0);
  }

  function rebuildKeyStates() {
    keyStates = {};
    for (let r = 0; r < guesses.length; r++) {
      const guess = guesses[r];
      const result = rowResults[r];
      for (let i = 0; i < WORD_LEN; i++) {
        const letter = guess[i];
        const state = result[i];
        if (!keyStates[letter] || RANK[state] > RANK[keyStates[letter]]) {
          keyStates[letter] = state;
        }
      }
    }
  }

  function persistDay() {
    writeJSON(STORAGE_DAY_KEY, { index, guesses, gameOver, won });
  }

  function loadDay() {
    const saved = readJSON(STORAGE_DAY_KEY);
    if (saved && saved.index === index && Array.isArray(saved.guesses)) {
      guesses = saved.guesses.slice(0, MAX_GUESSES);
      rowResults = guesses.map((g) => scoreGuess(g, answer));
      gameOver = !!saved.gameOver;
      won = !!saved.won;
      rebuildKeyStates();
    }
  }

  function updateStreak(didWin) {
    const streak = readJSON(STORAGE_STREAK_KEY) || { current: 0, best: 0, lastIndex: -1 };
    if (didWin) {
      streak.current = streak.lastIndex === index - 1 ? (streak.current || 0) + 1 : 1;
      streak.best = Math.max(streak.best || 0, streak.current);
    } else {
      streak.current = 0;
    }
    streak.lastIndex = index;
    writeJSON(STORAGE_STREAK_KEY, streak);
  }

  function finishGame(didWin) {
    gameOver = true;
    won = didWin;
    updateStreak(didWin);
    const elapsedGuesses = guesses.length;
    if (didWin) {
      gameEvent('score_event', { slug: SLUG, name: 'guesses_used', value: MAX_GUESSES - elapsedGuesses + 1 });
      if (elapsedGuesses <= 3) gameEvent('fast_solve', { slug: SLUG });
      gameEvent('win', { slug: SLUG, value: elapsedGuesses });
      setStatus(`Solved in ${elapsedGuesses}/${MAX_GUESSES}!`);
      playSfx('power');
    } else {
      setStatus(`Out of guesses. The word was ${answer.toUpperCase()}.`);
      playSfx('powerdown');
    }
    gameEvent('game_over', { slug: SLUG, won: didWin, value: elapsedGuesses });
    persistDay();
  }

  function submitGuess() {
    if (gameOver) return;
    if (currentGuess.length < WORD_LEN) {
      setStatus('Not enough letters.');
      return;
    }
    const guess = currentGuess;
    const result = scoreGuess(guess, answer);
    guesses.push(guess);
    rowResults.push(result);
    rebuildKeyStates();
    currentGuess = '';
    playSfx('click');
    if (guess === answer) {
      finishGame(true);
    } else if (guesses.length >= MAX_GUESSES) {
      finishGame(false);
    } else {
      setStatus('');
      persistDay();
    }
    render();
  }

  function appendLetter(letter) {
    if (gameOver) return;
    if (currentGuess.length >= WORD_LEN) return;
    currentGuess += letter;
    render();
  }

  function backspace() {
    if (gameOver) return;
    currentGuess = currentGuess.slice(0, -1);
    render();
  }

  // --- Rendering -----------------------------------------------------------

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTile(x, y, letter, state) {
    ctx.fillStyle = TILE_COLOR[state] || TILE_COLOR.empty;
    ctx.strokeStyle = state === 'empty' ? '#3b4766' : 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    roundRect(x, y, TILE, TILE, 8);
    ctx.fill();
    ctx.stroke();
    if (letter) {
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter.toUpperCase(), x + TILE / 2, y + TILE / 2 + 2);
    }
  }

  function drawGrid() {
    for (let r = 0; r < MAX_GUESSES; r++) {
      const y = GRID_TOP + r * (TILE + TILE_GAP);
      for (let c = 0; c < WORD_LEN; c++) {
        const x = GRID_X + c * (TILE + TILE_GAP);
        if (r < guesses.length) {
          drawTile(x, y, guesses[r][c], rowResults[r][c]);
        } else if (r === guesses.length) {
          drawTile(x, y, currentGuess[c] || '', 'empty');
        } else {
          drawTile(x, y, '', 'empty');
        }
      }
    }
  }

  function drawKeyboard() {
    keyHitboxes = [];
    const keyboardTop = GRID_TOP + MAX_GUESSES * (TILE + TILE_GAP) + 20;
    const rowHeight = 54;
    const gap = 4;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    KEY_ROWS.forEach((row, rowIndex) => {
      const widths = row.map((key) => (key === 'enter' || key === 'back' ? 54 : 34));
      const totalWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (row.length - 1);
      let x = (BASE_W - totalWidth) / 2;
      const y = keyboardTop + rowIndex * (rowHeight + gap);
      row.forEach((key, i) => {
        const w = widths[i];
        const state = key === 'enter' || key === 'back' ? 'unknown' : (keyStates[key] || 'unknown');
        ctx.fillStyle = KEY_COLOR[state] || KEY_COLOR.unknown;
        roundRect(x, y, w, rowHeight, 6);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        const label = key === 'enter' ? 'ENTER' : key === 'back' ? '⌫' : key.toUpperCase();
        ctx.fillText(label, x + w / 2, y + rowHeight / 2 + 1);
        keyHitboxes.push({ x, y, w, h: rowHeight, key });
        x += w + gap;
      });
    });
  }

  function render() {
    ctx.clearRect(0, 0, BASE_W, BASE_H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    drawGrid();
    drawKeyboard();
    updateStats();
  }

  function pickKey(px, py) {
    for (const box of keyHitboxes) {
      if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) return box.key;
    }
    return null;
  }

  function toLogicalPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = BASE_W / rect.width;
    const scaleY = BASE_H / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function handleKey(key) {
    if (key === 'enter') submitGuess();
    else if (key === 'back') backspace();
    else appendLetter(key);
  }

  canvas.addEventListener('click', (event) => {
    const point = toLogicalPoint(event.clientX, event.clientY);
    const key = pickKey(point.x, point.y);
    if (key) handleKey(key);
  });

  window.addEventListener('keydown', (event) => {
    if (gameOver) return;
    const key = event.key;
    if (key === 'Enter') { handleKey('enter'); return; }
    if (key === 'Backspace') { handleKey('back'); return; }
    if (/^[a-zA-Z]$/.test(key)) handleKey(key.toLowerCase());
  });

  // The shell fits every canvas to its parent on load and again on every DOM
  // mutation (it injects its own back button, objectives chip, progression
  // badge and missions panel well after this script's first render), and
  // resizing a canvas element always clears its bitmap. Watch the attributes
  // that fit actually changes and redraw whenever it does, rather than only
  // drawing once and being wiped out by a later resize.
  new MutationObserver(() => render()).observe(canvas, {
    attributes: true,
    attributeFilter: ['width', 'height'],
  });

  loadDay();
  gameEvent('play', { slug: SLUG });
  if (!gameOver) setStatus('Guess the word. Enter submits, Backspace deletes.');
  render();
  send('GAME_READY');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
