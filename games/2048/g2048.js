
import { GameEngine } from '../../shared/gameEngine.js';
import { copyGrid, computeMove, getHint as engineHint, canMove, createHistoryManager, confirmNoMoves } from './engine.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { gameEvent } from '../../shared/telemetry.js';

const GAME_SLUG = '2048';
const markFirstFrame = (() => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      window.ggFirstFrame?.();
    } catch (_) {
      /* noop */
    }
  };
})();

// Feature Configuration (all feature-flagged)
const FEATURES = {
  oneStepUndo: true,      // Enable 1-step undo (default ON)
  mergeStreaks: true,     // Enable merge-streak multiplier (default ON)  
  boardSizeToggle: true   // Enable 4x4/5x5 board size toggle (default ON)
};

const c=document.getElementById('board'), ctx=c.getContext('2d');
const oppC=document.getElementById('oppBoard'), oppCtx=oppC?.getContext('2d');
const net=window.Net;
let oppGrid=null, oppScore=0;
let PAD=12, S=80, GAP=10;
const TILE_RADIUS = 9;
let canvasCssWidth=0, canvasCssHeight=0;
const LS_SIZE='g2048.size';
const LS_MODE='g2048.mode';
const GAME_MODES={
  classic:{
    key:'classic',
    label:'Classic',
    allowUndo:true,
    timeLimitMs:null,
    spawnWeights:{2:0.9,4:0.1}
  },
  noUndo:{
    key:'noUndo',
    label:'No-Undo',
    allowUndo:false,
    timeLimitMs:null,
    spawnWeights:{2:0.9,4:0.1}
  },
  timeAttack:{
    key:'timeAttack',
    label:'Time Attack',
    allowUndo:true,
    timeLimitMs:180000,
    spawnWeights:{2:0.9,4:0.1},
    badge:'TA'
  },
  hardRandom:{
    key:'hardRandom',
    label:'Hard Randomizer',
    allowUndo:true,
    timeLimitMs:null,
    spawnWeights:{2:0.7,4:0.3}
  }
};

const storedMode=localStorage.getItem(LS_MODE);
let currentModeKey = storedMode && GAME_MODES[storedMode] ? storedMode : 'classic';
let currentMode = GAME_MODES[currentModeKey];

const sizeSel=document.getElementById('sizeSel');
const diffSel=document.getElementById('diffSel');
let N=parseInt(localStorage.getItem(LS_SIZE) || '4');

// Apply board size restrictions if feature enabled
if(FEATURES.boardSizeToggle && sizeSel) {
  // Remove all options and add only 4x4 and 5x5
  sizeSel.innerHTML = '<option value="4">4×4</option><option value="5">5×5</option>';
  // Validate and set current size
  N = (N === 5) ? 5 : 4;  // Default to 4x4 if not 5x5
}

if(sizeSel){
  sizeSel.value=String(N);
  sizeSel.addEventListener('change',()=>{
    const newN = parseInt(sizeSel.value)||4;
    // Additional validation for restricted feature
    if(FEATURES.boardSizeToggle && newN !== 4 && newN !== 5) return;
    N = newN;
    localStorage.setItem(LS_SIZE,N);
    reset(false,'size-change');
  });
}
let hintDepth=parseInt(diffSel?.value||'1');
diffSel?.addEventListener('change',()=>{
  hintDepth=parseInt(diffSel.value)||1;
});
HUD.create({title:'2048', onPauseToggle:()=>{}, onRestart:()=>reset(false,'hud-restart')});
let postedReady=false;
let initializationFailed=false;

function announceGameReady(){
  if(postedReady) return;
  postedReady=true;
  try {
    window.parent?.postMessage({ type:'GAME_READY', slug:'g2048' }, '*');
  } catch {}
}

// UI update functions
function updateUI() {
  updateScoreDisplay();
  updateUndoDisplay();
  updateStreakDisplay();
  updateModeHelpText();
}

function pulseScoreElement(element) {
  if (!element || reduceMotion) {
    return;
  }

  element.classList.remove('is-animating');
  if (element.__pulseTimeout) {
    clearTimeout(element.__pulseTimeout);
    element.__pulseTimeout = null;
  }

  const schedule = () => {
    element.classList.add('is-animating');
    element.__pulseTimeout = setTimeout(() => {
      element.classList.remove('is-animating');
      element.__pulseTimeout = null;
    }, SCORE_PULSE_DURATION_MS);
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(schedule);
  } else {
    schedule();
  }
}

function updateScoreDisplay() {
  const currentScoreEl = document.getElementById('currentScore');
  const bestScoreEl = document.getElementById('bestScore');
  if(scoreValueText && currentScoreEl){
    scoreValueText.textContent = score.toLocaleString();
    currentScoreEl.setAttribute('aria-label', `Current score: ${score.toLocaleString()}`);
    if(lastDisplayedScore !== score){
      pulseScoreElement(scoreValueText);
      lastDisplayedScore = score;
    }
  } else if(currentScoreEl) {
    currentScoreEl.textContent = score.toLocaleString();
    currentScoreEl.setAttribute('aria-label', `Current score: ${score.toLocaleString()}`);
    if(lastDisplayedScore !== score){
      pulseScoreElement(currentScoreEl);
      lastDisplayedScore = score;
    }
  }
  if(bestScoreEl) {
    bestScoreEl.textContent = best.toLocaleString();
    bestScoreEl.setAttribute('aria-label', `Best score: ${best.toLocaleString()}`);
    if(lastDisplayedBest !== best){
      pulseScoreElement(bestScoreEl);
      lastDisplayedBest = best;
    }
  }
  if(scoreBadge){
    const showBadge = !!currentMode.timeLimitMs;
    scoreBadge.style.display = showBadge ? 'inline-flex' : 'none';
    if(showBadge){
      const badgeText = currentMode.badge || 'TA';
      scoreBadge.textContent = badgeText;
      scoreBadge.setAttribute('title', `${currentMode.label}`);
      scoreBadge.setAttribute('aria-label', `${currentMode.label} mode active`);
    } else {
      scoreBadge.removeAttribute('title');
      scoreBadge.removeAttribute('aria-label');
    }
  }
}

function updateUndoDisplay() {
  const undoCountEl = document.getElementById('undoCount');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const allowUndo = !!currentMode.allowUndo;
  if(undoLabelEl){
    undoLabelEl.textContent = allowUndo ? 'Undo' : 'Undo';
  }
  if(actionsGroup){
    actionsGroup.style.display = allowUndo ? '' : 'none';
  }
  if(!allowUndo){
    if(undoCountEl){
      undoCountEl.textContent = '—';
      undoCountEl.setAttribute('aria-label', 'Undo not available in this mode');
    }
    if(undoBtn){
      undoBtn.disabled = true;
      undoBtn.style.display = 'none';
      undoBtn.setAttribute('aria-hidden','true');
    }
    if(redoBtn){
      redoBtn.disabled = true;
      redoBtn.style.display = 'none';
      redoBtn.setAttribute('aria-hidden','true');
    }
    return;
  }

  if(undoCountEl) {
    undoCountEl.textContent = undoLeft;
    undoCountEl.setAttribute('aria-label', `Undo moves remaining: ${undoLeft}`);
  }
  if(undoBtn) {
    undoBtn.style.display = '';
    undoBtn.removeAttribute('aria-hidden');
    const canUndoMove = undoLeft > 0 && historyManager.canUndo() && !anim;
    undoBtn.disabled = !canUndoMove;
    undoBtn.textContent = canUndoMove ? `Undo (${undoLeft})` : 'No Undo';
    undoBtn.setAttribute('aria-label', canUndoMove ? `Undo last move, ${undoLeft} remaining` : 'No undo moves available');
  }
  if(redoBtn){
    redoBtn.style.display = '';
    redoBtn.removeAttribute('aria-hidden');
    const canRedoMove = historyManager.canRedo() && !anim;
    redoBtn.disabled = !canRedoMove;
    redoBtn.textContent = canRedoMove ? 'Redo Move' : 'No Redo';
    redoBtn.setAttribute('aria-label', canRedoMove ? 'Redo last undone move' : 'No redo moves available');
  }
}

function updateStreakDisplay() {
  const streakEl = document.getElementById('streakDisplay');
  if(streakEl) {
    const span = streakEl.querySelector('span');
    if(span) span.textContent = `×${mergeStreak}`;
    const timerSpeech = currentMode.timeLimitMs ? ` Time remaining ${formatTimeForSpeech(timeRemainingMs ?? currentMode.timeLimitMs)}.` : '';
    streakEl.setAttribute('aria-label', `Streak multiplier: ${mergeStreak}x.${timerSpeech}`.trim());
  }
  updateTimerDisplay();
}

function formatTime(ms){
  const safeMs = Math.max(0, typeof ms === 'number' ? ms : 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}

function formatTimeForSpeech(ms){
  const safeMs = Math.max(0, typeof ms === 'number' ? ms : 0);
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if(minutes > 0){
    if(seconds === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function updateTimerDisplay(){
  if(!timerDisplay){
    return;
  }
  if(currentMode.timeLimitMs){
    timerDisplay.style.display = 'inline-flex';
    const remaining = typeof timeRemainingMs === 'number' ? Math.max(0, Math.round(timeRemainingMs)) : currentMode.timeLimitMs;
    timerDisplay.textContent = formatTime(remaining);
    timerDisplay.setAttribute('aria-label', `Time remaining: ${formatTimeForSpeech(remaining)}`);
  } else {
    timerDisplay.style.display = 'none';
    timerDisplay.removeAttribute('aria-label');
  }
}

function updateModeHelpText(){
  if(!modeNoteEl){
    return;
  }
  const notes=[];
  if(!currentMode.allowUndo){
    notes.push('Undo is disabled in this mode.');
  }
  if(currentMode.timeLimitMs){
    notes.push('Time Attack ends automatically after three minutes.');
  }
  if(currentModeKey==='hardRandom'){
    notes.push('Hard Randomizer increases the odds of spawning 4 tiles.');
  }
  if(!notes.length){
    modeNoteEl.style.display='none';
    modeNoteEl.textContent='';
    return;
  }
  modeNoteEl.style.display='block';
  modeNoteEl.textContent=notes.join(' ');
}

function setupModeUI(){
  const controlsGrid = document.querySelector('.controls-grid');
  if(controlsGrid && !modeSelect){
    const existing = controlsGrid.querySelector('#modeSel');
    if(existing){
      modeSelect = existing;
    } else {
      const group = document.createElement('div');
      group.className = 'control-group';
      const label = document.createElement('div');
      label.className = 'control-label';
      label.textContent = 'Mode';
      const select = document.createElement('select');
      select.id = 'modeSel';
      select.className = 'control-select';
      select.setAttribute('aria-label','Select gameplay mode');
      Object.values(GAME_MODES).forEach(mode => {
        const option = document.createElement('option');
        option.value = mode.key;
        option.textContent = mode.label;
        select.appendChild(option);
      });
      group.append(label, select);
      controlsGrid.insertBefore(group, controlsGrid.firstChild);
      modeSelect = select;
    }
  }

  if(modeSelect && !modeSelect.dataset.modeInitialized){
    modeSelect.dataset.modeInitialized = 'true';
    modeSelect.addEventListener('change', () => {
      setMode(modeSelect.value, 'mode-change');
    });
  }

  const currentScoreEl = document.getElementById('currentScore');
  if(currentScoreEl && !scoreValueText){
    const scoreTextSpan = document.createElement('span');
    scoreTextSpan.className = 'score-value-text';
    scoreTextSpan.textContent = currentScoreEl.textContent || '0';
    Object.assign(scoreTextSpan.style, {
      display:'inline-block',
      minWidth:'0'
    });
    currentScoreEl.textContent = '';
    currentScoreEl.appendChild(scoreTextSpan);
    scoreValueText = scoreTextSpan;
  }
  if(currentScoreEl && !scoreBadge){
    scoreBadge = document.createElement('span');
    scoreBadge.className = 'mode-badge';
    Object.assign(scoreBadge.style, {
      marginLeft:'0.5rem',
      padding:'0.125rem 0.5rem',
      borderRadius:'999px',
      background:'var(--accent-color, #3b82f6)',
      color:'#ffffff',
      fontSize:'0.65rem',
      fontWeight:'700',
      letterSpacing:'0.08em',
      textTransform:'uppercase',
      display:'none',
      alignItems:'center',
      verticalAlign:'middle'
    });
    currentScoreEl.appendChild(scoreBadge);
  }

  const scoreBar = document.querySelector('.score-bar');
  if(scoreBar && !undoLabelEl){
    const items = scoreBar.querySelectorAll('.score-item');
    undoLabelEl = items?.[2]?.querySelector('.score-label') || undoLabelEl;
  }

  if(!timerDisplay){
    const streakEl = document.getElementById('streakDisplay');
    if(streakEl){
      timerDisplay = document.createElement('span');
      timerDisplay.className = 'timer-display';
      Object.assign(timerDisplay.style, {
        marginLeft:'0.75rem',
        fontSize:'0.875rem',
        fontWeight:'600',
        color:'var(--accent-color, #3b82f6)',
        display:'none'
      });
      streakEl.appendChild(timerDisplay);
    }
  }

  if(!modeNoteEl){
    const helpTextEl = document.querySelector('.help-text');
    if(helpTextEl){
      modeNoteEl = document.createElement('p');
      modeNoteEl.className = 'help-text mode-note';
      Object.assign(modeNoteEl.style, {
        marginTop:'0.35rem',
        fontSize:'0.75rem',
        opacity:'0.85',
        display:'none'
      });
      helpTextEl.insertAdjacentElement('afterend', modeNoteEl);
    }
  }

  if(!actionsGroup){
    const undoBtn = document.getElementById('undoBtn');
    if(undoBtn){
      actionsGroup = undoBtn.closest('.control-group');
    }
  }

  if(modeSelect){
    modeSelect.value = currentModeKey;
  }
}

function refreshUndoCapacity(){
  maxUndo = currentMode.allowUndo ? BASE_MAX_UNDO : 0;
  if(undoLeft > maxUndo){
    undoLeft = maxUndo;
  }
}

function updateModeDiagnostics(){
  if(!diagHandleRef){
    return;
  }
  diagHandleRef.flags = {
    mode: currentModeKey,
    noUndo: !currentMode.allowUndo,
    timeAttack: !!currentMode.timeLimitMs
  };
}

function applyModeSettings(){
  refreshUndoCapacity();
  if(modeSelect && modeSelect.value !== currentModeKey){
    modeSelect.value = currentModeKey;
  }
  updateModeDiagnostics();
  updateUI();
  if(currentMode.timeLimitMs){
    if(reduceMotion && !gameLoop.running){
      gameLoop.start();
    }
  }else if(reduceMotion && gameLoop.running){
    gameLoop.stop();
  }
}

function setMode(newModeKey, reason='mode-change'){
  const normalized = GAME_MODES[newModeKey] ? newModeKey : 'classic';
  const changed = normalized !== currentModeKey;
  if(!changed && reason !== 'mode-change-refresh'){
    updateUI();
    return;
  }
  currentModeKey = normalized;
  currentMode = GAME_MODES[currentModeKey];
  localStorage.setItem(LS_MODE, currentModeKey);
  timeRemainingMs = currentMode.timeLimitMs ?? null;
  timeAttackExpired = false;
  hasEmitted4096 = false;
  applyModeSettings();
  if(changed){
    reset(false, reason);
  }
}

const gameOverOverlay=document.getElementById('gameOverOverlay');
const gameOverTitle=document.getElementById('gameOverTitle');
const gameOverMessage=document.getElementById('gameOverMessage');
const overlayRestartBtn=document.getElementById('overlayRestart');
const overlayBackBtn=document.getElementById('overlayBack');
let gameOverShown=false;

const BASE_MAX_UNDO = FEATURES.oneStepUndo ? 1 : 3;
let maxUndo = currentMode.allowUndo ? BASE_MAX_UNDO : 0;
const LS_UNDO='g2048.undo', LS_BEST='g2048.best', LS_THEME='g2048.theme';
const ANIM_TIME=120;

class DeterministicRng {
  constructor(seed, state){
    const fallback = DeterministicRng.randomSeed();
    this.seed = (typeof seed === 'number' ? seed : fallback) >>> 0;
    this.state = (typeof state === 'number' ? state : this.seed) >>> 0;
  }

  next(){
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    t ^= t >>> 14;
    return (t >>> 0) / 4294967296;
  }

  clone(){
    return new DeterministicRng(this.seed, this.state);
  }

  serialize(){
    return { seed: this.seed, state: this.state };
  }

  static from(serialized){
    if(!serialized || typeof serialized.seed !== 'number' || typeof serialized.state !== 'number'){
      return new DeterministicRng(DeterministicRng.randomSeed());
    }
    return new DeterministicRng(serialized.seed, serialized.state);
  }

  static randomSeed(){
    try {
      if(typeof window !== 'undefined' && window.crypto?.getRandomValues){
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        return (arr[0] || Date.now()) >>> 0;
      }
    } catch {}
    return ((Math.random()*0xffffffff)>>>0) || (Date.now()>>>0);
  }
}

class AnimationClock {
  constructor(baseDuration){
    this.baseDuration = baseDuration;
    this.elapsed = 0;
    this.root = (typeof document !== 'undefined') ? document.documentElement : null;
    this.applyBaseDuration();
  }

  applyBaseDuration(){
    if(this.root){
      this.root.style.setProperty('--g2048-transition', `${this.baseDuration}ms`);
    }
  }

  reset(){
    this.elapsed = 0;
    if(this.root){
      this.root.style.setProperty('--g2048-clock', '0ms');
      this.root.style.setProperty('--g2048-frame', '0ms');
    }
  }

  tick(dt){
    this.elapsed += dt*1000;
    if(this.root){
      this.root.style.setProperty('--g2048-clock', `${this.elapsed.toFixed(2)}ms`);
      this.root.style.setProperty('--g2048-frame', `${(dt*1000).toFixed(2)}ms`);
    }
  }
}

const animationClock = new AnimationClock(ANIM_TIME);
let rng = new DeterministicRng(DeterministicRng.randomSeed());
let pendingHistoryCommit = false;
let undoSpendStack = [];

const TILE_VALUE_KEYS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];

const FALLBACK_THEMES = {
  light: {
    boardBg: '#ffffff',
    empty: '#e5e7eb',
    text: '#111827',
    tileTextDark: '#111827', // 16.7:1 contrast on white backgrounds
    tileTextLight: '#ffffff', // 21:1 contrast on dark backgrounds
    tileColors: {
      2: '#fef3c7',      // Light amber - 4.6:1 with dark text
      4: '#fbbf24',      // Amber - 4.8:1 with dark text
      8: '#f59e0b',      // Orange - 4.9:1 with dark text
      16: '#ea580c',     // Orange-600 - 5.2:1 with white text
      32: '#dc2626',     // Red-600 - 5.3:1 with white text
      64: '#b91c1c',     // Red-700 - 6.8:1 with white text
      128: '#7c3aed',    // Purple-600 - 4.8:1 with white text
      256: '#5b21b6',    // Purple-800 - 7.1:1 with white text
      512: '#1e40af',    // Blue-800 - 8.6:1 with white text
      1024: '#166534',   // Green-800 - 9.2:1 with white text
      2048: '#0f172a',   // Slate-900 - 16.7:1 with white text
      default: '#111827' // Gray-900 - 16.7:1 with white text
    }
  },
  dark: {
    boardBg: '#111827',
    empty: '#1f2937',
    text: '#f9fafb',
    tileTextDark: '#111827', // 16.7:1 contrast on light backgrounds
    tileTextLight: '#f9fafb', // 15.3:1 contrast on dark backgrounds
    tileColors: {
      2: '#fef3c7',      // Light amber - 13.2:1 with dark text
      4: '#fde68a',      // Amber-200 - 11.8:1 with dark text
      8: '#fbbf24',      // Amber-400 - 8.1:1 with dark text
      16: '#60a5fa',     // Blue-400 - 4.6:1 with dark text
      32: '#34d399',     // Green-400 - 4.7:1 with dark text
      64: '#fbbf24',     // Amber-400 - 8.1:1 with dark text
      128: '#a78bfa',    // Purple-400 - 4.5:1 with dark text
      256: '#f472b6',    // Pink-400 - 4.9:1 with dark text
      512: '#fb7185',    // Rose-400 - 5.1:1 with dark text
      1024: '#fbbf24',   // Amber-400 - 8.1:1 with dark text
      2048: '#fde047',   // Yellow-400 - 12.6:1 with dark text
      default: '#e5e7eb' // Gray-200 - 15.3:1 with dark text
    }
  }
};

function cloneThemeConfig(config) {
  return {
    boardBg: config.boardBg,
    empty: config.empty,
    text: config.text,
    tileTextDark: config.tileTextDark,
    tileTextLight: config.tileTextLight,
    tileColors: { ...config.tileColors }
  };
}

const themes = {
  light: cloneThemeConfig(FALLBACK_THEMES.light),
  dark: cloneThemeConfig(FALLBACK_THEMES.dark)
};

const SCORE_PULSE_DURATION_MS = 220;

function readCssColor(style, variableName, fallback) {
  if (!style || typeof style.getPropertyValue !== 'function') {
    return fallback;
  }
  const value = style.getPropertyValue(variableName);
  return value ? value.trim() || fallback : fallback;
}

function syncThemeFromCSS(themeName, computedStyle) {
  const fallback = FALLBACK_THEMES[themeName];
  if (!fallback) {
    return themes[themeName];
  }

  const style = computedStyle || (typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null);
  if (!style) {
    themes[themeName] = cloneThemeConfig(fallback);
    return themes[themeName];
  }

  const next = cloneThemeConfig(fallback);
  next.boardBg = readCssColor(style, '--board-bg', fallback.boardBg);
  next.empty = readCssColor(style, '--tile-empty', fallback.empty);
  next.text = readCssColor(style, '--text-primary', fallback.text);
  next.tileTextDark = readCssColor(style, '--tile-text-dark', fallback.tileTextDark);
  next.tileTextLight = readCssColor(style, '--tile-text-light', fallback.tileTextLight);

  const defaultColor = readCssColor(style, '--tile-color-default', fallback.tileColors.default);
  next.tileColors.default = defaultColor;

  TILE_VALUE_KEYS.forEach(value => {
    const fallbackColor = fallback.tileColors[value] || defaultColor;
    next.tileColors[value] = readCssColor(style, `--tile-color-${value}`, fallbackColor);
  });

  themes[themeName] = next;
  return next;
}

let currentTheme=localStorage.getItem(LS_THEME) || 'dark';

let grid, score=0, over=false, won=false, hintDir=null;
let runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let undoLeft = currentMode.allowUndo ? parseInt(localStorage.getItem(LS_UNDO) ?? BASE_MAX_UNDO) : 0;
let best=parseInt(localStorage.getItem(LS_BEST) ?? 0);
if(isNaN(undoLeft)) undoLeft=currentMode.allowUndo ? BASE_MAX_UNDO : 0;
if(isNaN(best)) best=0;

let lastDisplayedScore = 0;
let lastDisplayedBest = 0;

let timeRemainingMs = currentMode.timeLimitMs ?? null;
let timeAttackExpired = false;
let highestTile = 0;
let hasEmitted4096 = false;
let undosUsed = 0;
let scoreBadge = null;
let timerDisplay = null;
let undoLabelEl = null;
let modeSelect = null;
let diagHandleRef = null;
let modeNoteEl = null;
let actionsGroup = null;
let scoreValueText = null;

// Merge-streak multiplier system
let mergeStreak = 1;      // Current streak multiplier (x1, x2, x3...)
let lastMoveHadMerge = false;

let reduceMotion = false;
let reduceMotionQuery = null;
try {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = !!reduceMotionQuery.matches;
  }
} catch (_) {
  reduceMotionQuery = null;
  reduceMotion = false;
}

const DIAG_MAX_READY_EVENTS = 4;
const DIAG_MAX_SCORE_EVENTS = 12;
const diagReadyEvents = [];
const diagScoreEvents = [];
const diagReadyListeners = new Set();
const diagScoreListeners = new Set();

function notifyDiagListeners(listeners, event) {
  if (!listeners || typeof listeners.forEach !== 'function') return;
  listeners.forEach((listener) => {
    if (typeof listener !== 'function') return;
    try {
      listener(event);
    } catch (_) {
      /* ignore listener failures */
    }
  });
}

function snapshotForDiagnostics(reason, extra = {}) {
  const board = Array.isArray(grid) ? copyGrid(grid) : null;
  return {
    type: extra?.type || null,
    reason: reason || null,
    timestamp: Date.now(),
    score,
    best,
    undoLeft,
    size: typeof N === 'number' ? N : null,
    over,
    won,
    grid: board,
    mode: currentModeKey,
    highestTile,
    undosUsed,
    timeRemainingMs,
    ...extra,
  };
}

function recordReadyEvent(reason, extra = {}) {
  const event = snapshotForDiagnostics(reason, { ...extra, type: 'ready' });
  diagReadyEvents.push(event);
  if (diagReadyEvents.length > DIAG_MAX_READY_EVENTS) {
    diagReadyEvents.splice(0, diagReadyEvents.length - DIAG_MAX_READY_EVENTS);
  }
  notifyDiagListeners(diagReadyListeners, event);
  return event;
}

function recordScoreEvent(reason, extra = {}) {
  const event = snapshotForDiagnostics(reason, { ...extra, type: 'score' });
  diagScoreEvents.push(event);
  if (diagScoreEvents.length > DIAG_MAX_SCORE_EVENTS) {
    diagScoreEvents.splice(0, diagScoreEvents.length - DIAG_MAX_SCORE_EVENTS);
  }
  notifyDiagListeners(diagScoreListeners, event);
  if (Number(extra.delta || extra.gained || 0) > 0) {
    gameEvent('score', {
      slug: GAME_SLUG,
      value: score,
      meta: {
        reason,
        delta: typeof extra.delta === 'number' ? extra.delta : Number(extra.delta || 0),
        streak: extra.streak,
        mode: currentModeKey,
        maxTile: highestTile,
        timeRemainingMs,
      },
    });
  }
  return event;
}

// Animation state
let anim=null;
let newTileAnim = null;   // Animation for new tiles scaling in
let mergedAnim = new Map(); // Track merged tiles animation with decay timing

// Performance optimization caches
let renderCache = {
  theme: null,
  tileColors: new Map(),
  formattedStrings: new Map(),
  roundRectPaths: new Map(),
  lastFrameTime: 0,
  skipFrames: 0
};

// History size limit for memory management
const MAX_HISTORY_SIZE = 50;
const historyManager = createHistoryManager({ maxSize: MAX_HISTORY_SIZE });

function updateStatus(){
  const el=document.getElementById('status');
  if(el) el.textContent=`You: ${score} Opponent: ${oppScore||0}`;
}

function drawOpponent(){
  if(!oppCtx||!oppGrid) return;
  const theme=themes[currentTheme];
  oppCtx.fillStyle=theme.boardBg;
  oppCtx.fillRect(0,0,oppC.width,oppC.height);
  oppCtx.fillStyle=theme.text;
  oppCtx.font='16px Inter,system-ui';
  oppCtx.fillText(`Opponent: ${oppScore}`,12,20);
  const strokeColor = oppC?.style?.borderColor || '#00000022';
  const emptyCells=[];
  const tiles=[];
  let order=0;
  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      const px=PAD + x*(S+GAP);
      const py=40 + y*(S+GAP);
      emptyCells.push({x:px,y:py});
      const v=oppGrid[y]?.[x]||0;
      if(!v) continue;
      tiles.push({
        x:px,
        y:py,
        value:v,
        fill:tileColor(v),
        textColor:(v<=4)?theme.tileTextDark:theme.tileTextLight,
        font:(v<100)?'28px Inter':'24px Inter',
        order:order++,
        layer:Math.log2(v)
      });
    }
  }

  for(const cell of emptyCells){
    drawTileBackground(oppCtx,cell.x,cell.y,S,TILE_RADIUS,theme.empty,strokeColor,0);
  }

  tiles.sort((a,b)=>a.layer===b.layer?a.order-b.order:a.layer-b.layer);
  oppCtx.textAlign='center';
  oppCtx.textBaseline='middle';
  for(const tile of tiles){
    drawTileBackground(oppCtx,tile.x,tile.y,S,TILE_RADIUS,tile.fill,strokeColor,tile.value);
    oppCtx.fillStyle=tile.textColor;
    oppCtx.font=tile.font;
    oppCtx.fillText(tile.value,tile.x+S/2,tile.y+S/2+2);
  }
}

function injectGarbage(count){
  for(let i=0;i<count;i++) addTile();
  check();
  draw();
  net?.send('move',{grid,score});
}

function updateCanvas(){
  // Responsive canvas sizing
  const container = document.querySelector('.game-main');
  const maxWidth = Math.min(480, container ? container.clientWidth - 32 : 360);
  const baseSize = Math.min(80, Math.floor((maxWidth - 20) / (N + (N-1)*0.125 + 0.25)));
  S = Math.max(50, baseSize);
  PAD = Math.max(10, S/8);
  GAP = Math.max(5, S/16);
  canvasCssWidth = 2*PAD + N*S + (N-1)*GAP;
  canvasCssHeight = 40 + N*S + (N-1)*GAP + 30;
  c.style.width = `${canvasCssWidth}px`;
  c.style.height = `${canvasCssHeight}px`;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(canvasCssWidth * dpr);
  c.height = Math.round(canvasCssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Scale drawing to match CSS pixels after DPR adjustments
}

function applyTheme(){
  const root = document.documentElement;
  if(root?.dataset){
    root.dataset.theme = currentTheme;
  }

  const computed = (typeof window !== 'undefined' && typeof getComputedStyle === 'function')
    ? getComputedStyle(root)
    : null;
  const t = syncThemeFromCSS(currentTheme, computed);

  const backgroundColor = readCssColor(computed, '--bg-primary', t.boardBg);
  const textColor = readCssColor(computed, '--text-primary', t.text);
  const borderColor = readCssColor(
    computed,
    '--border-color',
    currentTheme === 'dark' ? '#374151' : '#d1d5db'
  );

  document.body.style.background = backgroundColor;
  document.body.style.color = textColor;

  c.style.borderColor = borderColor;
  if(oppC) oppC.style.borderColor = borderColor;

  // Update theme toggle aria-label dynamically
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
  }

  // Update theme toggle button text
  const themeBtn=document.getElementById('themeToggle');
  if(themeBtn) themeBtn.textContent = currentTheme==='dark'?'Light':'Dark';

  // Update game over overlay ARIA attributes
  if(gameOverOverlay){
    gameOverOverlay.setAttribute('aria-hidden', gameOverOverlay.classList.contains('hidden')?'true':'false');
  }

  renderCache.tileColors.clear();

  // Update all UI elements with current values
  updateUI();

  if(reduceMotion){
    draw();
  }
}

function reset(keepUndo=false, reasonOverride){
  const previousScore = score || 0;
  updateCanvas();
  animationClock.reset();
  grid=Array.from({length:N},()=>Array(N).fill(0));
  score=0; over=false; won=false; hintDir=null; anim=null;
  lastAnnouncedScore = 0;
  highestTile = 0;
  hasEmitted4096 = false;
  undosUsed = 0;
  timeAttackExpired = false;
  timeRemainingMs = currentMode.timeLimitMs ?? null;

  refreshUndoCapacity();
  rng = new DeterministicRng(DeterministicRng.randomSeed());
  pendingHistoryCommit = false;
  undoSpendStack = [];

  // Clean up animation state
  newTileAnim = null;
  mergedAnim.clear();

  // Reset merge-streak system
  mergeStreak = 1;
  lastMoveHadMerge = false;

  addTile();
  addTile();
  historyManager.init({
    grid,
    score,
    rngState: rng.serialize(),
    meta: { mergeStreak, lastMoveHadMerge }
  });
  if(!keepUndo || !currentMode.allowUndo){
    undoLeft = maxUndo;
    if(currentMode.allowUndo){
      localStorage.setItem(LS_UNDO,undoLeft);
    } else {
      localStorage.removeItem(LS_UNDO);
    }
  } else {
    undoLeft = Math.min(undoLeft, maxUndo);
  }
  applyTheme();
  updateUI();
  net?.send('move',{grid,score});
  hideGameOverModal();

  const reason = (typeof reasonOverride === 'string' && reasonOverride)
    ? reasonOverride
    : (keepUndo ? 'init' : 'reset');
  if (!keepUndo) {
    runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    gameEvent('play', {
      slug: GAME_SLUG,
      meta: {
        reason,
        size: N,
        mode: currentModeKey,
        timeLimitMs: currentMode.timeLimitMs || null,
      },
    });
  }
  recordScoreEvent(reason, { delta: score - previousScore });
  recordReadyEvent(reason);

  updateTimerDisplay();
  updateModeDiagnostics();

  if(reduceMotion){
    draw();
  }
}

function selectSpawnValue(randomSource){
  const weights = currentMode?.spawnWeights || GAME_MODES.classic.spawnWeights;
  const entries = Object.entries(weights || {}).map(([value, weight]) => [Number(value), Number(weight)]).filter(([, weight]) => Number.isFinite(weight) && weight > 0);
  if(!entries.length){
    return 2;
  }
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  let r = randomSource();
  let cumulative = 0;
  for(let i=0;i<entries.length;i++){
    const [value, weight] = entries[i];
    cumulative += weight / totalWeight;
    if(r <= cumulative || i === entries.length - 1){
      return value;
    }
  }
  return entries[entries.length - 1][0];
}

function updateHighestTile(sourceGrid = grid){
  if(!Array.isArray(sourceGrid)){
    return;
  }
  const flattened = sourceGrid.flat();
  if(!flattened.length){
    return;
  }
  const newMax = Math.max(highestTile, ...flattened);
  if(newMax !== highestTile){
    highestTile = newMax;
    if(highestTile >= 4096 && !hasEmitted4096){
      hasEmitted4096 = true;
      gameEvent('score_event', {
        slug: GAME_SLUG,
        value: highestTile,
        meta: {
          name: 'tile_4096',
          tileValue: highestTile,
          score,
          mode: currentModeKey,
        },
      });
    }
  }
}

function handleTimeAttackTimeout(){
  if(timeAttackExpired || !currentMode.timeLimitMs){
    return;
  }
  timeAttackExpired = true;
  timeRemainingMs = 0;
  updateTimerDisplay();
  over = true;
  won = false;
  if(!gameOverShown){
    showGameOverModal('Time up!', 'Time Attack run ended. Try again?');
  }
  const durationMs = currentMode.timeLimitMs;
  const payload = {
    slug: GAME_SLUG,
    value: score,
    durationMs,
    meta: {
      won: false,
      boardSize: N,
      mode: currentModeKey,
      reason: 'time_attack_timeout',
      undosUsed,
      maxTile: highestTile,
      timeLimitMs: currentMode.timeLimitMs,
      timeRemainingMs: 0,
    },
  };
  gameEvent('game_over', payload);
  gameEvent('lose', {
    slug: GAME_SLUG,
    meta: {
      score,
      boardSize: N,
      mode: currentModeKey,
      reason: 'time_attack_timeout',
      undosUsed,
      maxTile: highestTile,
      timeLimitMs: currentMode.timeLimitMs,
      timeRemainingMs: 0,
    },
  });
}

function addTile(options = {}){
  const { skipAnimation = false } = options || {};
  if(!rng){
    rng = new DeterministicRng(DeterministicRng.randomSeed());
  }
  const empty=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(!grid[y][x]) empty.push([x,y]);
  if(!empty.length) return;

  const randomSource = rng ? () => rng.next() : () => Math.random();
  const index = Math.floor(randomSource()*empty.length);
  const [x,y]=empty[index];
  updateHighestTile(grid);
  const value = selectSpawnValue(randomSource);
  grid[y][x] = value;
  updateHighestTile(grid);

  if(skipAnimation || reduceMotion){
    newTileAnim = null;
    return;
  }

  // Create scale-in animation for new tile
  newTileAnim = {
    x, y, value,
    scale: 0,
    p: 0
  };
}

function undoMove(){
  if(!currentMode.allowUndo) return false;
  if(anim) return false;
  if(undoLeft<=0) return false;
  if(!historyManager.canUndo()) return false;

  const previousScore = score;
  const state=historyManager.undo();
  if(!state) return false;

  undoLeft--; localStorage.setItem(LS_UNDO,undoLeft);
  undoSpendStack.push(1);
  undosUsed++;

  grid=copyGrid(state.grid);
  score=state.score;
  rng=DeterministicRng.from(state.rngState);
  mergeStreak = state.meta?.mergeStreak ?? 1;
  lastMoveHadMerge = state.meta?.lastMoveHadMerge ?? false;
  over=false; won=false; hintDir=null;
  pendingHistoryCommit=false;
  updateHighestTile(grid);

  newTileAnim = null;
  mergedAnim.clear();
  anim=null;

  hideGameOverModal();
  check();
  updateUI();
  net?.send('move',{grid,score});
  recordScoreEvent('undo', { delta: score - previousScore });

  draw();
  return true;
}

function redoMove(){
  if(!currentMode.allowUndo) return false;
  if(anim) return false;
  if(!historyManager.canRedo()) return false;

  const previousScore = score;
  const state=historyManager.redo();
  if(!state) return false;

  const restored = undoSpendStack.length ? undoSpendStack.pop() : 0;
  if(restored>0){
    undoLeft = Math.min(maxUndo, undoLeft + restored);
    localStorage.setItem(LS_UNDO,undoLeft);
  }

  grid=copyGrid(state.grid);
  score=state.score;
  rng=DeterministicRng.from(state.rngState);
  mergeStreak = state.meta?.mergeStreak ?? 1;
  lastMoveHadMerge = state.meta?.lastMoveHadMerge ?? false;
  over=false; won=false; hintDir=null;
  pendingHistoryCommit=false;
  updateHighestTile(grid);

  newTileAnim = null;
  mergedAnim.clear();
  anim=null;

  hideGameOverModal();
  check();
  updateUI();
  net?.send('move',{grid,score});
  recordScoreEvent('redo', { delta: score - previousScore });

  draw();
  return true;
}

function move(dir){
  if(over||won||anim) return;
  const previousScore = score;
  const {after, animations, moved, gained}=computeMove(grid,dir);
  if(!moved){ return; }

  historyManager.pushCurrent();
  historyManager.clearFuture();
  undoSpendStack = [];
  pendingHistoryCommit = true;

  // Track merged tiles for animation
  mergedAnim.clear();
  if(!reduceMotion){
    animations.forEach(a => {
      if(after[a.toY][a.toX] !== a.value) { // This is a merge
        mergedAnim.set(`${a.toX},${a.toY}`, { p: 0, scale: 1.1 });
      }
    });
  }

  // Merge-streak multiplier system
  if(FEATURES.mergeStreaks) {
    const hadMerge = gained > 0;
    if(hadMerge && lastMoveHadMerge) {
      mergeStreak = Math.min(mergeStreak + 1, 10); // Cap at x10
    } else if(hadMerge) {
      mergeStreak = 2; // Start streak at x2
    } else {
      mergeStreak = 1; // Reset streak
    }
    lastMoveHadMerge = hadMerge;

    if (hadMerge && mergeStreak > 1) {
      gameEvent('combo', {
        slug: GAME_SLUG,
        count: mergeStreak,
        meta: {
          gained,
          mode: currentModeKey,
          maxTile: highestTile,
        },
      });
    }

    // Apply multiplier to gained score
    const multipliedGain = Math.floor(gained * mergeStreak);
    score += multipliedGain;
  } else {
    score += gained;
  }

  if(score>best){ best=score; localStorage.setItem(LS_BEST,best); }
  recordScoreEvent('move', { delta: score - previousScore, gained, streak: mergeStreak });
  updateUI();
  if(gained>=128) net?.send('garbage',{count:1});
  const base=copyGrid(grid);
  animations.forEach(a=>{ base[a.fromY][a.fromX]=0; });

  if(reduceMotion){
    grid = after;
    anim = null;
    addTile({ skipAnimation: true });
    historyManager.commit({
      grid,
      score,
      rngState: rng.serialize(),
      meta: { mergeStreak, lastMoveHadMerge }
    });
    pendingHistoryCommit = false;
    check();
    net?.send('move',{grid,score});
    updateUndoDisplay();
    draw();
    return;
  }

  anim={base, tiles:animations, after, p:0};
  updateUndoDisplay();
}

function hideGameOverModal(){
  if(gameOverOverlay){
    gameOverOverlay.classList.add('hidden');
    gameOverOverlay.setAttribute('aria-hidden','true');

    // Remove focus trap
    removeModalFocusTrap();
  }
  gameOverShown=false;

  if(initializationFailed){
    initializationFailed=false;
    if(overlayRestartBtn){
      overlayRestartBtn.textContent='Restart';
      overlayRestartBtn.setAttribute('aria-label','Start a new game');
      overlayRestartBtn.removeAttribute('data-init-error-action');
    }
    if(overlayBackBtn){
      overlayBackBtn.classList.remove('hidden');
      overlayBackBtn.removeAttribute('aria-hidden');
      overlayBackBtn.removeAttribute('tabindex');
    }
    gameOverMessage?.removeAttribute('tabindex');
  }

  // Return focus to the game canvas
  const gameCanvas = document.getElementById('board');
  gameCanvas?.focus();
}

function showGameOverModal(title,message){
  if(!gameOverOverlay) return;
  if(gameOverTitle) gameOverTitle.textContent=title;
  if(gameOverMessage) gameOverMessage.textContent=message;
  gameOverOverlay.classList.remove('hidden');
  gameOverOverlay.setAttribute('aria-hidden','false');
  
  // Setup focus trap for modal
  setupModalFocusTrap();
  
  overlayRestartBtn?.focus();
  gameOverShown=true;
  
  // Announce game over to screen readers
  announceToScreenReader(`${title} ${message} Focus is on the Restart button.`);
}

function check(){
  won = won || grid.flat().some(v=>v>=2048);
  if(won){
    over = false;
  }else{
    const quickNoMoves = !canMove(grid);
    over = quickNoMoves ? confirmNoMoves(grid) : false;
  }
  if((won||over) && !gameOverShown){
    showGameOverModal(won?'2048!':'Game over', won?'You made 2048! Want to go again?':'No moves left. Try again?');
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.max(0, Math.round(now - (runStartTime || now)));
    const reason = won ? 'win' : 'no_moves';
    gameEvent('game_over', {
      slug: GAME_SLUG,
      value: score,
      durationMs,
      meta: {
        won,
        boardSize: N,
        mode: currentModeKey,
        reason,
        undosUsed,
        maxTile: highestTile,
        timeRemainingMs,
        timeLimitMs: currentMode.timeLimitMs,
      },
    });
    if (won) {
      gameEvent('win', {
        slug: GAME_SLUG,
        meta: {
          score,
          boardSize: N,
          mode: currentModeKey,
          undosUsed,
          maxTile: highestTile,
          timeRemainingMs,
          timeLimitMs: currentMode.timeLimitMs,
        },
      });
    } else {
      gameEvent('lose', {
        slug: GAME_SLUG,
        meta: {
          score,
          boardSize: N,
          mode: currentModeKey,
          reason,
          undosUsed,
          maxTile: highestTile,
          timeRemainingMs,
          timeLimitMs: currentMode.timeLimitMs,
        },
      });
    }
  }
}

addEventListener('keydown', e=>{
  // Handle escape key to close modal
  if(e.key === 'Escape' && gameOverShown) {
    e.preventDefault();
    hideGameOverModal();
    return;
  }

  // Only handle game keys when game canvas is focused or no form elements are focused
  const activeEl = document.activeElement;
  const isFormElement = activeEl && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(activeEl.tagName);
  const gameCanvas = document.getElementById('board');
  const isGameFocused = activeEl === gameCanvas || activeEl === document.body;

  // Don't steal arrow keys from form controls
  if(isFormElement && !isGameFocused) {
    return;
  }

  const keyLower = e.key.toLowerCase();
  const ctrlLike = e.ctrlKey || e.metaKey;

  if(ctrlLike && !e.shiftKey && keyLower === 'z'){
    e.preventDefault();
    if(!currentMode.allowUndo){
      announceToScreenReader('Undo is disabled in this mode.');
      return;
    }
    const undone = undoMove();
    announceToScreenReader(undone ? 'Move undone.' : 'No moves to undo.');
    return;
  }

  if(ctrlLike && (keyLower === 'y' || (keyLower === 'z' && e.shiftKey))){
    e.preventDefault();
    if(!currentMode.allowUndo){
      announceToScreenReader('Redo is disabled in this mode.');
      return;
    }
    const redone = redoMove();
    announceToScreenReader(redone ? 'Move redone.' : 'No moves to redo.');
    return;
  }

  if(e.key==='ArrowLeft') {
    e.preventDefault();
    move(0);
    announceGameMove();
  }
  if(e.key==='ArrowUp') {
    e.preventDefault();
    move(1);
    announceGameMove();
  }
  if(e.key==='ArrowRight') {
    e.preventDefault();
    move(2);
    announceGameMove();
  }
  if(e.key==='ArrowDown') {
    e.preventDefault();
    move(3);
    announceGameMove();
  }
  if(e.key==='r'||e.key==='R') {
    reset();
    announceToScreenReader('Game restarted. New game board ready.');
  }
  if(keyLower==='u') {
    if(!currentMode.allowUndo){
      announceToScreenReader('Undo is disabled in this mode.');
    } else {
      const undone = undoMove();
      announceToScreenReader(undone ? 'Move undone.' : 'No moves to undo.');
    }
  }
  if(keyLower==='y') {
    if(!currentMode.allowUndo){
      announceToScreenReader('Redo is disabled in this mode.');
    } else {
      const redone = redoMove();
      if(redone){
        announceToScreenReader('Move redone.');
      }
    }
  }
  if(e.key==='h'||e.key==='H') {
    e.preventDefault();
    getHint();
    announceToScreenReader('Hint shown on board.');
  }
});

let touchStart=null;
c.addEventListener('touchstart',e=>{touchStart=e.touches[0]});
c.addEventListener('touchend',e=>{
  if(!touchStart) return; const t=e.changedTouches[0];
  const dx=t.clientX-touchStart.clientX, dy=t.clientY-touchStart.clientY;
  if(Math.abs(dx)+Math.abs(dy)>24){ if(Math.abs(dx)>Math.abs(dy)) move(dx>0?2:0); else move(dy>0?3:1); }
  touchStart=null;
});

function draw(anim){
  if(!Array.isArray(grid)) return;
  announceGameReady();
  // Frame rate optimization - skip frames when performance is poor
  const now = performance.now();
  if(!reduceMotion){
    if (renderCache.skipFrames > 0) {
      renderCache.skipFrames--;
      return;
    }

    // Adaptive frame rate based on performance
    const deltaTime = now - renderCache.lastFrameTime;
    if (deltaTime < 16) { // Running above 60 FPS
      renderCache.skipFrames = 0;
    } else if (deltaTime > 33) { // Running below 30 FPS
      renderCache.skipFrames = 1; // Skip every other frame
    }
    renderCache.lastFrameTime = now;
  } else {
    renderCache.skipFrames = 0;
    renderCache.lastFrameTime = now;
  }
  
  // Cache theme and computed values
  const theme = themes[currentTheme];
  if (renderCache.theme !== currentTheme) {
    renderCache.theme = currentTheme;
    renderCache.formattedStrings.clear(); // Clear string cache on theme change
    renderCache.tileColors.clear();
  }
  
  // Clear canvas efficiently
  ctx.fillStyle = theme.boardBg;
  ctx.fillRect(0, 0, canvasCssWidth, canvasCssHeight);
  
  // Cache formatted strings for UI text
  const streakText = FEATURES.mergeStreaks && mergeStreak > 1 ? ` Streak:x${mergeStreak}` : '';
  const scoreKey = `${score}_${best}_${undoLeft}_${streakText}`;
  let scoreText = renderCache.formattedStrings.get(scoreKey);
  if (!scoreText) {
    scoreText = `Score: ${score.toLocaleString()} Best: ${best.toLocaleString()} Undo:${undoLeft}${streakText}`;
    renderCache.formattedStrings.set(scoreKey, scoreText);
    // Limit cache size
    if (renderCache.formattedStrings.size > 20) {
      renderCache.formattedStrings.clear();
    }
  }
  
  // Draw UI text with cached string
  ctx.fillStyle = theme.text;
  ctx.font = '16px Inter,system-ui';
  ctx.fillText(scoreText, 12, 20);
  const strokeColor = c?.style?.borderColor || '#00000022';
  const base=(!reduceMotion && anim)?anim.base:grid;
  const emptyCells=[];
  const tileDrawList=[];
  let tileOrder=0;
  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      const px=PAD + x*(S+GAP);
      const py=40 + y*(S+GAP);
      emptyCells.push({x:px,y:py});

      if(!reduceMotion && newTileAnim && newTileAnim.x === x && newTileAnim.y === y) {
        continue;
      }

      const v=base[y][x];
      if(!v) continue;

      let scale = 1;
      const mergedKey = `${x},${y}`;
      if(!reduceMotion && mergedAnim.has(mergedKey) && !anim) {
        scale = mergedAnim.get(mergedKey).scale;
      }

      tileDrawList.push({
        x:px,
        y:py,
        value:v,
        scale,
        fill:tileColor(v),
        textColor:(v<=4)?theme.tileTextDark:theme.tileTextLight,
        font:(v<100)?'28px Inter':'24px Inter',
        order:tileOrder++,
        layer:Math.log2(v)
      });
    }
  }

  for(const cell of emptyCells){
    drawTileBackground(ctx,cell.x,cell.y,S,TILE_RADIUS,theme.empty,strokeColor,0);
  }

  tileDrawList.sort((a,b)=>a.layer===b.layer?a.order-b.order:a.layer-b.layer);
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  for(const tile of tileDrawList){
    const needsScale=!reduceMotion && tile.scale!==1;
    if(needsScale){
      ctx.save();
      const cx=tile.x+S/2, cy=tile.y+S/2;
      ctx.translate(cx,cy);
      ctx.scale(tile.scale,tile.scale);
      ctx.translate(-cx,-cy);
    }
    drawTileBackground(ctx,tile.x,tile.y,S,TILE_RADIUS,tile.fill,strokeColor,tile.value);
    ctx.fillStyle=tile.textColor;
    ctx.font=tile.font;
    ctx.fillText(tile.value,tile.x+S/2,tile.y+S/2+2);
    if(needsScale){
      ctx.restore();
    }
  }
  if(!reduceMotion && anim){
    const movingTiles=anim.tiles.map((t,index)=>{
      const px=PAD + (t.fromX + (t.toX - t.fromX)*anim.p)*(S+GAP);
      const py=40 + (t.fromY + (t.toY - t.fromY)*anim.p)*(S+GAP);
      return {
        x:px,
        y:py,
        value:t.value,
        fill:tileColor(t.value),
        order:index,
        layer:Math.log2(t.value)
      };
    });

    movingTiles.sort((a,b)=>a.layer===b.layer?a.order-b.order:a.layer-b.layer);
    for(const tile of movingTiles){
      drawTileBackground(ctx,tile.x,tile.y,S,TILE_RADIUS,tile.fill,strokeColor,tile.value);
      ctx.fillStyle=(tile.value<=4)?theme.tileTextDark:theme.tileTextLight;
      ctx.font=(tile.value<100)?'28px Inter':'24px Inter';
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillText(tile.value,tile.x+S/2,tile.y+S/2+2);
    }
  }

  // Render new tile scale-in animation
  if(!reduceMotion && newTileAnim && newTileAnim.scale > 0) {
    const px = PAD + newTileAnim.x * (S + GAP);
    const py = 40 + newTileAnim.y * (S + GAP);
    const v = newTileAnim.value;
    const scale = newTileAnim.scale;

    ctx.save();
    const cx = px + S/2, cy = py + S/2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    drawTileBackground(ctx, px, py, S, TILE_RADIUS, tileColor(v), strokeColor, v);

    if(scale > 0.3) { // Only show text when tile is big enough
      ctx.fillStyle = (v <= 4) ? theme.tileTextDark : theme.tileTextLight;
      ctx.font = (v < 100) ? '28px Inter' : '24px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(v, px + S/2, py + S/2 + 2);
    }

    ctx.restore();
  }

  ctx.textAlign='left';
  ctx.textBaseline='alphabetic';
  if(hintDir!=null){ ctx.fillText('Hint: '+['Left','Up','Right','Down'][hintDir],12,canvasCssHeight-12); }
  updateStatus();
  drawOpponent();
  markFirstFrame();
}

function tileColor(v){
  // Cache tile colors for performance
  const cacheKey = `${currentTheme}_${v}`;
  if (renderCache.tileColors.has(cacheKey)) {
    return renderCache.tileColors.get(cacheKey);
  }
  
  const m = themes[currentTheme].tileColors;
  const color = m[v] || m.default;
  renderCache.tileColors.set(cacheKey, color);
  return color;
}

function getRoundedRectPath(w,h,r){
  let radii;
  if(typeof r==='number'){
    radii={tl:r,tr:r,br:r,bl:r};
  } else {
    radii=r;
  }
  const key=`${w}_${h}_${radii.tl}_${radii.tr}_${radii.br}_${radii.bl}`;
  if(!renderCache.roundRectPaths.has(key)){
    const path=new Path2D();
    path.moveTo(radii.tl,0);
    path.lineTo(w-radii.tr,0);
    path.quadraticCurveTo(w,0,w,radii.tr);
    path.lineTo(w,h-radii.br);
    path.quadraticCurveTo(w,h,w-radii.br,h);
    path.lineTo(radii.bl,h);
    path.quadraticCurveTo(0,h,0,h-radii.bl);
    path.lineTo(0,radii.tl);
    path.quadraticCurveTo(0,0,radii.tl,0);
    path.closePath();
    renderCache.roundRectPaths.set(key,path);
  }
  return renderCache.roundRectPaths.get(key);
}

function computeShadowAlpha(value){
  if(!value) return 0;
  const depth=Math.max(0,Math.log2(value)-1);
  const intensity=1+depth*0.08;
  return Math.min(0.22*intensity,0.45);
}

function drawTileBackground(ctx,x,y,size,radius,fillColor,strokeColor,value){
  const path=getRoundedRectPath(size,size,radius);
  ctx.save();
  ctx.translate(x,y);

  if(value){
    const shadowAlpha=computeShadowAlpha(value);
    if(shadowAlpha>0){
      ctx.save();
      ctx.shadowColor=`rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
      ctx.shadowBlur=6;
      ctx.shadowOffsetX=0;
      ctx.shadowOffsetY=2;
      ctx.fillStyle=fillColor;
      ctx.fill(path);
      ctx.restore();
    }
  }

  ctx.fillStyle=fillColor;
  ctx.fill(path);

  if(strokeColor){
    ctx.strokeStyle=strokeColor;
    ctx.lineWidth=1;
    ctx.stroke(path);
  }

  if(value){
    ctx.save();
    ctx.clip(path);
    const highlight=ctx.createLinearGradient(0,0,0,size);
    highlight.addColorStop(0,'rgba(255,255,255,0.10)');
    highlight.addColorStop(0.45,'rgba(255,255,255,0)');
    ctx.fillStyle=highlight;
    ctx.fillRect(0,0,size,size);
    ctx.restore();
  }

  ctx.restore();
}

function getHint(){
  hintDir=engineHint(grid,hintDepth);
  draw();
}

function hideHint(){
  if(hintDir===null) return;
  hintDir=null;
  draw();
}

const gameLoop=new GameEngine();
gameLoop.update=dt=>{
  animationClock.tick(dt);
  if(currentMode.timeLimitMs && !timeAttackExpired && !over && !won){
    if(typeof timeRemainingMs !== 'number'){
      timeRemainingMs = currentMode.timeLimitMs;
    }
    timeRemainingMs = Math.max(0, (timeRemainingMs ?? currentMode.timeLimitMs) - dt*1000);
    if(timeRemainingMs <= 0){
      timeRemainingMs = 0;
      handleTimeAttackTimeout();
    }
    updateTimerDisplay();
  }
  if(reduceMotion){
    return;
  }
  // Animation optimization - batch updates
  let needsRedraw = false;
  
  if(anim){
    anim.p+=dt*1000/ANIM_TIME;
    needsRedraw = true;
    if(anim.p>=1){
      grid=anim.after;
      anim=null;

      // Reset merge animations to start the pulse effect now that slide is complete
      for(const [key, mergeAnim] of mergedAnim.entries()) {
        mergeAnim.p = 0;
        mergeAnim.scale = 1.1;
      }

      addTile();
      check();
      net?.send('move',{grid,score});
      if(pendingHistoryCommit){
        historyManager.commit({
          grid,
          score,
          rngState: rng.serialize(),
          meta: { mergeStreak, lastMoveHadMerge }
        });
        pendingHistoryCommit = false;
        updateUndoDisplay();
      }
    }
  }
  
  // Update new tile scale-in animation
  if(newTileAnim){
    newTileAnim.p += dt*1000/(ANIM_TIME*1.5); // Slower for better visibility
    newTileAnim.scale = Math.min(newTileAnim.p, 1);
    needsRedraw = true;
    if(newTileAnim.p >= 1){
      newTileAnim = null;
    }
  }
  
  // Update merged tile pulse animations (decay from 1.1 to 1.0 over ~150ms)
  const MERGE_ANIM_TIME = ANIM_TIME * 1.25;
  const keysToDelete = [];
  for(const [key, animObj] of mergedAnim.entries()) {
    animObj.p += dt*1000/MERGE_ANIM_TIME;
    needsRedraw = true;
    if(animObj.p >= 1) {
      keysToDelete.push(key);
    } else {
      // Decay scale from 1.1 to 1.0
      animObj.scale = 1.1 - (animObj.p * 0.1);
    }
  }
  
  // Clean up completed animations in batch
  keysToDelete.forEach(key => mergedAnim.delete(key));
  
  // Only render if animations need updating or it's the first frame
  if(needsRedraw || renderCache.lastFrameTime === 0) {
    gameLoop.render();
  }
};
gameLoop.render=()=>{
  if(reduceMotion && gameLoop.running){
    return;
  }
  draw(anim?{base:anim.base,tiles:anim.tiles,p:Math.min(anim.p,1)}:null);
};

const handleReduceMotionChange = (eventMatches) => {
  const shouldReduce = !!eventMatches;
  if(shouldReduce === reduceMotion) return;

  reduceMotion = shouldReduce;

  if(reduceMotion){
    gameLoop.stop?.();
    if(anim){
      const pendingAfter = anim.after;
      anim = null;
      grid = pendingAfter;
      addTile({ skipAnimation: true });
      check();
      net?.send('move',{grid,score});
      if(pendingHistoryCommit){
        historyManager.commit({
          grid,
          score,
          rngState: rng.serialize(),
          meta: { mergeStreak, lastMoveHadMerge }
        });
        pendingHistoryCommit = false;
        updateUndoDisplay();
      }
    }
    newTileAnim = null;
    mergedAnim.clear();
    renderCache.skipFrames = 0;
    if(currentMode.timeLimitMs && !gameLoop.running){
      gameLoop.start();
    }
  }else{
    renderCache.skipFrames = 0;
    renderCache.lastFrameTime = 0;
    if(!gameLoop.running && Array.isArray(grid)){
      gameLoop.start();
    }
  }

  if(Array.isArray(grid)){
    draw();
  }
};

if(reduceMotionQuery){
  const onMotionChange = (event) => handleReduceMotionChange(event?.matches);
  if(typeof reduceMotionQuery.addEventListener === 'function'){
    reduceMotionQuery.addEventListener('change', onMotionChange);
  }else if(typeof reduceMotionQuery.addListener === 'function'){
    reduceMotionQuery.addListener(onMotionChange);
  }
}

const diagHandle = window.__g2048 = window.__g2048 || {};
diagHandleRef = diagHandle;
diagHandle.gameLoop = gameLoop;
diagHandle.reset = reset;
Object.defineProperty(diagHandle, 'score', {
  configurable: true,
  enumerable: true,
  get(){ return score; }
});
Object.defineProperty(diagHandle, 'grid', {
  configurable: true,
  enumerable: true,
  get(){ return Array.isArray(grid) ? copyGrid(grid) : null; }
});
Object.defineProperty(diagHandle, 'best', {
  configurable: true,
  enumerable: true,
  get(){ return best; }
});
Object.defineProperty(diagHandle, 'undoLeft', {
  configurable: true,
  enumerable: true,
  get(){ return undoLeft; }
});
Object.defineProperty(diagHandle, 'over', {
  configurable: true,
  enumerable: true,
  get(){ return over; }
});
Object.defineProperty(diagHandle, 'won', {
  configurable: true,
  enumerable: true,
  get(){ return won; }
});
Object.defineProperty(diagHandle, 'size', {
  configurable: true,
  enumerable: true,
  get(){ return N; }
});
Object.defineProperty(diagHandle, 'mode', {
  configurable: true,
  enumerable: true,
  get(){ return currentModeKey; }
});
Object.defineProperty(diagHandle, 'timeRemainingMs', {
  configurable: true,
  enumerable: true,
  get(){ return timeRemainingMs; }
});
Object.defineProperty(diagHandle, 'highestTile', {
  configurable: true,
  enumerable: true,
  get(){ return highestTile; }
});
Object.defineProperty(diagHandle, 'undosUsed', {
  configurable: true,
  enumerable: true,
  get(){ return undosUsed; }
});
diagHandle.readyEvents = diagReadyEvents;
diagHandle.scoreEvents = diagScoreEvents;
diagHandle.readyListeners = diagReadyListeners;
diagHandle.scoreListeners = diagScoreListeners;
updateModeDiagnostics();

document.getElementById('hintBtn')?.addEventListener('click',()=>{ getHint(); });
document.getElementById('themeToggle')?.addEventListener('click',()=>{
  currentTheme=currentTheme==='dark'?'light':'dark';
  localStorage.setItem(LS_THEME,currentTheme);
  applyTheme();
  draw();
});

// Add undo button functionality
document.getElementById('undoBtn')?.addEventListener('click',()=>{
  if(!currentMode.allowUndo){
    announceToScreenReader('Undo is disabled in this mode.');
    return;
  }
  const undone = undoMove();
  announceToScreenReader(undone ? 'Move undone.' : 'No moves to undo.');
});
document.getElementById('redoBtn')?.addEventListener('click',()=>{
  if(!currentMode.allowUndo){
    announceToScreenReader('Redo is disabled in this mode.');
    return;
  }
  const redone = redoMove();
  announceToScreenReader(redone ? 'Move redone.' : 'No moves to redo.');
});

overlayRestartBtn?.addEventListener('click',()=>{
  if(initializationFailed){
    const action=overlayRestartBtn?.dataset?.initErrorAction;
    if(action==='back' && window.history.length>1){
      window.history.back();
      return;
    }
    if(action==='reload'){
      window.location.reload();
      return;
    }
    window.location.href='../../';
    return;
  }
  hideGameOverModal(); reset(false,'overlay-restart');
});
overlayBackBtn?.addEventListener('click',()=>{
  hideGameOverModal();
  if(window.history.length>1) window.history.back();
  else window.location.href='../../';
});

net?.on('move',msg=>{ oppGrid=msg.grid; oppScore=msg.score; drawOpponent(); updateStatus(); });
net?.on('garbage',msg=>injectGarbage(msg.count||1));
net?.on('start',()=>{
  document.getElementById('lobby')?.style.setProperty('display','none');
  document.getElementById('game')?.style.removeProperty('display');
  reset(true,'match-start');
  net?.send('move',{grid,score});
});

// Add window resize listener for responsive canvas
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    updateCanvas();
    draw();
  }, 100);
});

// Screen reader announcements
function announceToScreenReader(message) {
  // Create or update live region for announcements
  let liveRegion = document.getElementById('srAnnouncements');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'srAnnouncements';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.position = 'absolute';
    liveRegion.style.left = '-10000px';
    liveRegion.style.width = '1px';
    liveRegion.style.height = '1px';
    liveRegion.style.overflow = 'hidden';
    document.body.appendChild(liveRegion);
  }
  
  // Clear and set new message
  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion.textContent = message;
  }, 100);
}

function announceGameMove() {
  const maxTile = Math.max(...grid.flat().filter(v => v > 0));
  if (maxTile >= 2048 && !won) {
    announceToScreenReader(`Congratulations! You reached ${maxTile}! Current score: ${score.toLocaleString()}`);
  }
  // Announce score changes on significant increases
  const scoreIncrease = score - (lastAnnouncedScore || 0);
  if (scoreIncrease >= 100) {
    lastAnnouncedScore = score;
    announceToScreenReader(`Score: ${score.toLocaleString()}`);
  }
}

// Track last announced score for game state announcements
let lastAnnouncedScore = 0;

// Add canvas focus styles and handlers
const gameCanvas = document.getElementById('board');
if (gameCanvas) {
  gameCanvas.addEventListener('focus', () => {
    announceToScreenReader(`2048 game board focused. Current score: ${score.toLocaleString()}. Use arrow keys to move tiles.`);
  });
  
  gameCanvas.addEventListener('blur', () => {
    hideHint(); // Hide hint when canvas loses focus
  });
}

// Focus trap management for modal
function setupModalFocusTrap() {
  const modal = gameOverOverlay;
  const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  
  function trapFocus(e) {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }
  }
  
  // Store trap function to remove later
  modal._focusTrap = trapFocus;
  modal.addEventListener('keydown', trapFocus);
}

function removeModalFocusTrap() {
  if (gameOverOverlay && gameOverOverlay._focusTrap) {
    gameOverOverlay.removeEventListener('keydown', gameOverOverlay._focusTrap);
    gameOverOverlay._focusTrap = null;
  }
}

// Theme toggle accessibility
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    // Allow the existing toggle handler to update the theme first
    setTimeout(() => {
      // currentTheme has already been updated by the primary click handler
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      // Update both text and ARIA label to reflect the current and next themes
      themeToggle.textContent = currentTheme === 'dark' ? 'Light' : 'Dark';
      themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
      announceToScreenReader(`Switched to ${currentTheme} theme.`);
    }, 100);
  });
}

function showInitializationErrorOverlay(){
  initializationFailed=true;
  const hasHistory=window.history.length>1;
  const actionLabel=hasHistory?'Back':'Reload';
  const actionAria=hasHistory?'Return to the previous page':'Reload the game';
  if(overlayBackBtn){
    overlayBackBtn.classList.add('hidden');
    overlayBackBtn.setAttribute('aria-hidden','true');
    overlayBackBtn.setAttribute('tabindex','-1');
  }
  if(overlayRestartBtn){
    overlayRestartBtn.textContent=actionLabel;
    overlayRestartBtn.setAttribute('aria-label',actionAria);
    overlayRestartBtn.dataset.initErrorAction=hasHistory?'back':'reload';
  }
  showGameOverModal('Something went wrong','Something went wrong. Use the button below to continue.');
  if(gameOverMessage){
    gameOverMessage.setAttribute('tabindex','-1');
    gameOverMessage.focus();
  }
}

function initializeGame(){
  try{
    setupModeUI();
    applyModeSettings();
    updateCanvas();
    applyTheme();
    reset(true);
    if(!reduceMotion || currentMode.timeLimitMs){
      gameLoop.start();
    }
    net?.send('move',{grid,score});
    window.DIAG?.ready?.();
    announceGameReady();
    announceToScreenReader('2048 game loaded. Press Tab to navigate controls or focus the game board to start playing.');
  }catch(error){
    try{
      pushEvent('game',{
        level:'error',
        message:'[2048] init failed',
        details:{
          error:error?.message || 'unknown',
          stack:error?.stack || null
        }
      });
    }catch{}
    try{
      recordReadyEvent('init-error',{ reason: error?.message || 'unknown' });
    }catch{}
    gameLoop.stop?.();
    window.DIAG?.error?.(error);
    try{
      window.parent?.postMessage({ type:'GAME_ERROR', slug:'g2048', message:error?.message, error:error?.message }, '*');
    }catch{}
    showInitializationErrorOverlay();
  }
}

initializeGame();

import('./diag-adapter.js');
