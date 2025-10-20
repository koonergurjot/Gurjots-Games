import { drawGlow } from '../../shared/fx/canvasFx.js';
import { showToast, showModal } from '../../shared/ui/hud.js';
import getThemeTokens from '../../shared/skins/index.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';
import { gameEvent } from '../../shared/telemetry.js';
import {
  initUi,
  loadLadderRating,
  saveLadderRating,
  loadLevelSelection,
  saveLevelSelection,
  loadPuzzleProgress,
  savePuzzleProgress,
  hasMilestone,
  markMilestone,
  onProfileChange,
  updateRatingDisplay,
} from './ui.js';

installErrorReporter();
getThemeTokens();

const VICTORY_AUDIO_URL=new URL('../../assets/audio/victory.wav',import.meta.url).href;
let victoryAudio=null;
let audioReady=typeof window==='undefined';
function ensureVictoryAudio(){
  if(!audioReady||typeof Audio==='undefined') return null;
  if(!victoryAudio){
    try{
      victoryAudio=new Audio(VICTORY_AUDIO_URL);
      victoryAudio.preload='auto';
      victoryAudio.volume=0.85;
    }catch{
      victoryAudio=null;
      return null;
    }
  }
  return victoryAudio;
}
if(!audioReady&&typeof window!=='undefined'){
  const unlock=()=>{audioReady=true;ensureVictoryAudio();};
  window.addEventListener('pointerdown',unlock,{once:true,passive:true});
  window.addEventListener('keydown',unlock,{once:true});
}else{
  ensureVictoryAudio();
}

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

function requireElementById(id){
  const el=document.getElementById(id);
  if(!el) throw new Error(`Chess: required element #${id} was not found.`);
  return el;
}

function requireCanvas(id){
  const el=requireElementById(id);
  if(!(el instanceof HTMLCanvasElement)) throw new Error(`Chess: element #${id} must be a <canvas>.`);
  return el;
}

function require2dContext(canvas){
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error(`Chess: canvas #${canvas.id} does not provide a 2D context.`);
  return ctx;
}

(function(){
let statusEl;
try{
const c=requireCanvas('board'), ctx=require2dContext(c);
const fx=requireCanvas('fx'), fxCtx=require2dContext(fx);
const COLS=8, ROWS=8;
const DEFAULT_BOARD_CSS_SIZE=480;
const rect=c.getBoundingClientRect();
const cssSize=Math.max(1, Math.min(DEFAULT_BOARD_CSS_SIZE, rect.width||DEFAULT_BOARD_CSS_SIZE));
const dpr=window.devicePixelRatio||1;
c.style.width=`${cssSize}px`; c.style.height=`${cssSize}px`;
fx.style.width=`${cssSize}px`; fx.style.height=`${cssSize}px`;
const pixelSize=Math.round(cssSize*dpr);
c.width=pixelSize; c.height=pixelSize;
fx.width=pixelSize; fx.height=pixelSize;
ctx.setTransform(dpr,0,0,dpr,0,0);
fxCtx.setTransform(dpr,0,0,dpr,0,0);
const S=cssSize/COLS;
statusEl=requireElementById('status');
const depthEl=/** @type {HTMLSelectElement} */ (requireElementById('difficulty'));
const timeControlSelect=/** @type {HTMLSelectElement} */ (requireElementById('time-control'));
const clockModeLabelEl=requireElementById('clock-mode-label');
const clockElements={
  w:{
    root:requireElementById('clock-player-white'),
    time:requireElementById('clock-w-time'),
    increment:requireElementById('clock-w-increment'),
  },
  b:{
    root:requireElementById('clock-player-black'),
    time:requireElementById('clock-b-time'),
    increment:requireElementById('clock-b-increment'),
  },
};
const trainingStartBtn=/** @type {HTMLButtonElement} */ (requireElementById('training-start'));
const trainingHintBtn=/** @type {HTMLButtonElement} */ (requireElementById('training-hint'));
const trainingStatusEl=requireElementById('training-status');
const trainingProgressEl=requireElementById('training-progress');
const trainingStreakEl=requireElementById('training-streak');
const lobbyStatusEl=requireElementById('lobby-status');
const rankingsList=/** @type {HTMLOListElement} */ (requireElementById('rankings'));
const findMatchBtn=/** @type {HTMLButtonElement} */ (requireElementById('find-match'));
const evaluationBarFill=requireElementById('evaluation-bar-fill');
const evaluationScoreEl=requireElementById('evaluation-score');
const evaluationHistoryCanvas=requireCanvas('evaluation-history');
const evaluationHistoryCtx=require2dContext(evaluationHistoryCanvas);
const evaluationSwingsList=requireElementById('evaluation-swings');
const evalRect=evaluationHistoryCanvas.getBoundingClientRect();
const evalCssWidth=Math.max(160, evalRect.width||220);
const evalCssHeight=Math.max(120, evalRect.height||140);
const evalDpr=window.devicePixelRatio||1;
evaluationHistoryCanvas.width=Math.round(evalCssWidth*evalDpr);
evaluationHistoryCanvas.height=Math.round(evalCssHeight*evalDpr);
evaluationHistoryCtx.setTransform(evalDpr,0,0,evalDpr,0,0);
function configureDifficultySelect(){
  if(!depthEl) return;
  depthEl.innerHTML='';
  AI_LEVELS.forEach(level=>{
    const option=document.createElement('option');
    option.value=level.id;
    option.textContent=level.label;
    depthEl.appendChild(option);
  });
  const saved=loadLevelSelection();
  if(saved && AI_LEVEL_MAP.has(saved)){
    depthEl.value=saved;
  }else if(AI_LEVELS.length){
    depthEl.value=AI_LEVELS[1]?.id||AI_LEVELS[0].id;
  }
}
configureDifficultySelect();
initUi();
updateRatingDisplay(localLadderRating);
if(depthEl){
  depthEl.addEventListener('change',()=>{
    const selected=depthEl.value;
    if(!AI_LEVEL_MAP.has(selected) && AI_LEVELS.length){
      depthEl.value=AI_LEVELS[0].id;
    }
    saveLevelSelection(depthEl.value);
    if(activeMatch){
      activeMatch.level=getSelectedAiLevel();
      activeMatch.levelId=activeMatch.level.id;
    }
  });
}
const EMPTY = '.';
// Simple FEN start
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const COLORS={w:1,b:-1};
let board=[], turn='w', sel=null, moves=[], over=false;
let runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let gameOverSent = false;
let lastMove=null; let lastMoveInfo=null; let premove=null;
let puzzleIndex=-1, puzzleStep=0;
let puzzleStreak=0;
let bestPuzzleStreak=0;
let puzzleSolvedCount=0;
let dailyPuzzleDateKey=null;
let storedPuzzleCurrent=-1;
let puzzlesState={ status:'loading', total:0, error:null };
let puzzleHintUsed=false;
let hintMove=null;
let anim=null;
let castleRights={w:{K:true,Q:true},b:{K:true,Q:true}};
let epTarget=null; // {x,y} square available for en passant capture
let repTable={};
let overMsg=null;
let onlineMode=false;
let localColor='w';
let lastSentMove=null;
const netMoveQueue=[];
let postedReady=false;
let victorySoundPlayed=false;
let localLadderRating=loadLadderRating();
let hasLoggedElo1400=hasMilestone('elo1400');
let activeMatch=null;
let nonPuzzlePlyCount=0;
let mateInThreeAwarded=false;

function resetVictorySound(){
  victorySoundPlayed=false;
  const audio=ensureVictoryAudio();
  if(audio){
    try{
      audio.pause();
      audio.currentTime=0;
    }catch{}
  }
}

function playVictorySound(){
  if(victorySoundPlayed) return;
  const audio=ensureVictoryAudio();
  if(!audio) return;
  victorySoundPlayed=true;
  try{
    audio.currentTime=0;
    const play=audio.play();
    if(play&&typeof play.catch==='function') play.catch(()=>{});
  }catch{}
}

const AI_UNAVAILABLE_MESSAGE='AI unavailable – switching to local play';
let aiMoveTimeout=null;
let aiUnavailableNotified=false;

const ChessNamespace = window.Chess = window.Chess || {};
const stateCallbacks = Array.isArray(ChessNamespace.stateCallbacks)
  ? ChessNamespace.stateCallbacks
  : [];
ChessNamespace.stateCallbacks = stateCallbacks;

function onState(listener){
  if(typeof listener!=='function') return ()=>{};
  stateCallbacks.push(listener);
  return ()=>{
    const idx=stateCallbacks.indexOf(listener);
    if(idx>=0) stateCallbacks.splice(idx,1);
  };
}
ChessNamespace.onState = onState;

const TIME_CONTROLS=[
  { id:'none', label:'Free Play (∞)', baseMs:0, incrementMs:0, summary:'Free play — no clock' },
  { id:'rapid', label:'Rapid 10 | 5', baseMs:10*60*1000, incrementMs:5000, summary:'Rapid • 10 min +5s' },
  { id:'blitz', label:'Blitz 5 | 3', baseMs:5*60*1000, incrementMs:3000, summary:'Blitz • 5 min +3s' },
  { id:'bullet', label:'Bullet 1 | 0', baseMs:60*1000, incrementMs:0, summary:'Bullet • 1 min' },
  { id:'classic', label:'Classical 15 | 10', baseMs:15*60*1000, incrementMs:10000, summary:'Classical • 15 min +10s' },
];
const AI_LEVELS=[
  { id:'1', label:'Level 1', depth:1, rating:900, delta:10 },
  { id:'2', label:'Level 2', depth:2, rating:1050, delta:15 },
  { id:'3', label:'Level 3', depth:3, rating:1200, delta:20 },
  { id:'4', label:'Level 4', depth:4, rating:1350, delta:25 },
  { id:'5', label:'Level 5', depth:5, rating:1500, delta:30 },
];
const AI_LEVEL_MAP=new Map(AI_LEVELS.map(level=>[level.id,level]));
const LADDER_MIN_RATING=800;
const DAILY_PUZZLE_LIMIT=10;
const timeControlMap=new Map(TIME_CONTROLS.map(tc=>[tc.id,tc]));
let activeTimeControl=timeControlMap.get(timeControlSelect.value)||timeControlMap.get('rapid')||TIME_CONTROLS[0];
timeControlSelect.value=activeTimeControl.id;
clockModeLabelEl.textContent=activeTimeControl.summary;
const moveTimers={w:0,b:0};
const clockState={w:activeTimeControl.baseMs||0,b:activeTimeControl.baseMs||0};
const incrementFlash={w:0,b:0};
let turnStartedAt=null;
const INCREMENT_FLASH_DURATION=1400;
const CLOCK_EPSILON=10; // ms tolerance before flagging

const evaluationHistory=[];
const advantageSwings=[];
let halfMoveCounter=0;
const EVAL_SWING_THRESHOLD=150; // centipawns
const EVAL_HISTORY_LIMIT=120;

const PIECE_VALUES={p:100,n:320,b:330,r:500,q:900,k:0};

function nowMs(){
  if(typeof performance!=='undefined' && typeof performance.now==='function'){
    return performance.now();
  }
  return Date.now();
}

function resetMoveTimers(){
  moveTimers.w=0;
  moveTimers.b=0;
  resetClocks();
}

function snapshotTimers(){
  return {
    w: Math.round(moveTimers.w),
    b: Math.round(moveTimers.b),
  };
}

function resetClocks(){
  const base=activeTimeControl.baseMs||0;
  clockState.w=base;
  clockState.b=base;
  incrementFlash.w=0;
  incrementFlash.b=0;
  if(base>0 && puzzleIndex<0 && !over){
    turnStartedAt=nowMs();
  }else if(base>0){
    turnStartedAt=nowMs();
  }else{
    turnStartedAt=nowMs();
  }
  updateClockDisplay();
}

function stopClock(){
  turnStartedAt=null;
  updateClockDisplay();
}

function getClockSnapshot(){
  if(!activeTimeControl || activeTimeControl.baseMs<=0) return null;
  return {
    control:activeTimeControl.id,
    remaining:{
      w: Math.round(getClockRemaining('w')),
      b: Math.round(getClockRemaining('b')),
    },
  };
}

function getClockRemaining(color){
  if(!activeTimeControl || activeTimeControl.baseMs<=0) return 0;
  const base=clockState[color];
  if(turn===color && turnStartedAt!==null && !over && puzzleIndex<0){
    return Math.max(0, base-(nowMs()-turnStartedAt));
  }
  return Math.max(0, base);
}

function formatClock(ms, short=false){
  if(ms===null) return '–';
  if(ms===Infinity) return '∞';
  if(ms<=0) return short?'0.0':'0:00';
  const totalSeconds=Math.floor(ms/1000);
  const minutes=Math.floor(totalSeconds/60);
  const seconds=totalSeconds%60;
  if(minutes>=1){
    const secStr=seconds.toString().padStart(2,'0');
    return `${minutes}:${secStr}`;
  }
  const tenths=Math.floor((ms%1000)/100);
  return `${seconds}.${tenths}`;
}

function updateClockDisplay(){
  if(!clockElements.w||!clockElements.b) return;
  const now=nowMs();
  const active=(color)=>turn===color && turnStartedAt!==null && !over && puzzleIndex<0 && activeTimeControl.baseMs>0;
  ['w','b'].forEach(color=>{
    const el=clockElements[color];
    if(!el) return;
    const remaining=activeTimeControl.baseMs>0?getClockRemaining(color):null;
    const timeText=activeTimeControl.baseMs>0?formatClock(remaining):'∞';
    if(el.time) el.time.textContent=timeText;
    if(el.root){
      el.root.classList.toggle('chess-clock__player--active', active(color));
    }
    if(el.increment){
      if(incrementFlash[color] && (now-incrementFlash[color])<INCREMENT_FLASH_DURATION){
        const incText=activeTimeControl.incrementMs>0?`+${formatClock(activeTimeControl.incrementMs,true)}`:'';
        el.increment.textContent=incText;
        el.increment.classList.add('chess-clock__increment--visible');
      }else{
        el.increment.textContent='';
        el.increment.classList.remove('chess-clock__increment--visible');
      }
    }
  });
}

function startClockTicker(){
  if(typeof requestAnimationFrame!=='function') return;
  if(startClockTicker.started) return;
  startClockTicker.started=true;
  function tick(){
    updateClockDisplay();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function resetEvaluationTracking(){
  evaluationHistory.length=0;
  advantageSwings.length=0;
  halfMoveCounter=0;
  recordEvaluationSample({ skipIncrement:true });
}

function recordEvaluationSample(options={}){
  const score=evaluateBoardScore();
  if(!options.skipIncrement) halfMoveCounter++;
  evaluationHistory.push({ ply:halfMoveCounter, score });
  if(evaluationHistory.length>EVAL_HISTORY_LIMIT) evaluationHistory.shift();
  const prev=evaluationHistory[evaluationHistory.length-2];
  if(prev){
    const delta=score-prev.score;
    if(Math.abs(delta)>=EVAL_SWING_THRESHOLD){
      advantageSwings.unshift({
        ply:halfMoveCounter,
        score,
        delta,
        mover:options.mover||null,
      });
      if(advantageSwings.length>6) advantageSwings.pop();
    }
  }
  updateEvaluationVisualization(score);
  return score;
}

function formatEvalScore(score){
  const pawns=score/100;
  const precision=Math.abs(pawns)<10?1:0;
  const formatted=pawns.toFixed(precision);
  return (pawns>=0?'+':'')+formatted;
}

function formatEvalDelta(delta){
  const pawns=Math.abs(delta)/100;
  const precision=pawns<10?1:0;
  const base=pawns.toFixed(precision);
  return `${delta>=0?'+':'-'}${base}`;
}

function updateEvaluationVisualization(currentScore){
  const score=typeof currentScore==='number'?currentScore:evaluateBoardScore();
  if(evaluationScoreEl) evaluationScoreEl.textContent=formatEvalScore(score);
  const magnitudes=evaluationHistory.map(e=>Math.abs(e.score));
  magnitudes.push(Math.abs(score));
  const maxAbs=Math.max(400, ...magnitudes);
  if(evaluationBarFill){
    const pct=(score+maxAbs)/(maxAbs*2);
    evaluationBarFill.style.height=`${Math.round(pct*100)}%`;
  }
  drawEvaluationHistory(maxAbs);
  updateAdvantageSwingList();
}

function drawEvaluationHistory(maxAbs){
  if(!evaluationHistoryCtx) return;
  evaluationHistoryCtx.clearRect(0,0,evalCssWidth,evalCssHeight);
  const entries=evaluationHistory.length?evaluationHistory:[{ ply:0, score:0 }];
  const step=entries.length>1?(evalCssWidth/(entries.length-1)):0;
  const toY=(score)=>{
    const pct=(score+maxAbs)/(maxAbs*2);
    return evalCssHeight-(pct*evalCssHeight);
  };
  // zero line
  evaluationHistoryCtx.strokeStyle='rgba(148, 163, 184, 0.35)';
  evaluationHistoryCtx.lineWidth=1;
  const zeroY=toY(0);
  evaluationHistoryCtx.beginPath();
  evaluationHistoryCtx.moveTo(0, zeroY);
  evaluationHistoryCtx.lineTo(evalCssWidth, zeroY);
  evaluationHistoryCtx.stroke();

  evaluationHistoryCtx.strokeStyle='rgba(125, 211, 252, 0.85)';
  evaluationHistoryCtx.lineWidth=2;
  evaluationHistoryCtx.beginPath();
  entries.forEach((entry, idx)=>{
    const x=idx*step;
    const y=toY(entry.score);
    if(idx===0) evaluationHistoryCtx.moveTo(x,y);
    else evaluationHistoryCtx.lineTo(x,y);
  });
  evaluationHistoryCtx.stroke();
}

function updateAdvantageSwingList(){
  if(!evaluationSwingsList) return;
  evaluationSwingsList.innerHTML='';
  if(!advantageSwings.length){
    const li=document.createElement('li');
    li.textContent='No big swings yet — keep playing!';
    li.className='evaluation-swings__empty';
    evaluationSwingsList.appendChild(li);
    return;
  }
  advantageSwings.forEach(entry=>{
    const li=document.createElement('li');
    const mover=entry.mover==='b'?'Black':'White';
    const moveNo=Math.max(1, Math.ceil(entry.ply/2));
    const verb=entry.delta>=0?'surges':'slips';
    li.textContent=`Move ${moveNo}: ${mover} ${verb} ${formatEvalDelta(entry.delta)} to ${formatEvalScore(entry.score)}`;
    evaluationSwingsList.appendChild(li);
  });
}

function updateTrainingHUD(){
  if(!trainingStatusEl || !trainingProgressEl || !trainingStreakEl) return;
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const total=Math.min(puzzles.length, DAILY_PUZZLE_LIMIT);
  const statusState=puzzlesState.status||'loading';
  if(onlineMode){
    trainingStatusEl.textContent='Training is unavailable during online play.';
    trainingProgressEl.textContent='';
    if(trainingStartBtn){
      trainingStartBtn.textContent='Daily Puzzles';
      trainingStartBtn.disabled=true;
    }
  } else if(statusState==='loading'){
    trainingStatusEl.textContent='Loading daily puzzles...';
    trainingProgressEl.textContent='';
    if(trainingStartBtn){
      trainingStartBtn.textContent='Loading...';
      trainingStartBtn.disabled=true;
    }
  } else if(statusState==='error'){
    trainingStatusEl.textContent='Daily puzzles are currently unavailable.';
    trainingProgressEl.textContent='Check your connection and try again.';
    if(trainingStartBtn){
      trainingStartBtn.textContent='Retry Download';
      trainingStartBtn.disabled=onlineMode;
    }
  } else if(puzzleIndex>=0 && puzzles[puzzleIndex]){
    const puzzle=puzzles[puzzleIndex];
    const steps=Array.isArray(puzzle.solution)?puzzle.solution.length:0;
    const displayStep=Math.min(puzzleStep+1, Math.max(steps,1));
    const baseLabel=`Puzzle ${puzzleIndex+1} of ${total}`;
    trainingStatusEl.textContent=puzzle.goal||`Puzzle ${puzzleIndex+1}`;
    trainingProgressEl.textContent=steps>0?`${baseLabel} • Step ${displayStep} / ${steps}`:baseLabel;
    if(trainingStartBtn){
      trainingStartBtn.textContent='In Progress';
      trainingStartBtn.disabled=true;
    }
  } else if(total<=0){
    trainingStatusEl.textContent='No daily puzzles available yet.';
    trainingProgressEl.textContent='';
    if(trainingStartBtn){
      trainingStartBtn.textContent='Start Daily Puzzles';
      trainingStartBtn.disabled=true;
    }
  } else {
    const solved=Math.min(puzzleSolvedCount, total);
    const pointer=puzzleIndex>=0?puzzleIndex:(storedPuzzleCurrent>=0?storedPuzzleCurrent:-1);
    const remaining=Math.max(0, total-solved);
    if(solved>=total){
      trainingStatusEl.textContent='Daily puzzles complete — come back tomorrow!';
      trainingProgressEl.textContent=`Solved ${solved} of ${total}.`;
      if(trainingStartBtn){
        trainingStartBtn.textContent='All Clear';
        trainingStartBtn.disabled=true;
      }
    } else {
      const nextIndex=pointer>=0?pointer:solved;
      trainingStatusEl.textContent=`Daily puzzle ${nextIndex+1} is ready.`;
      trainingProgressEl.textContent=`Solved ${solved} of ${total} • ${remaining} remaining.`;
      if(trainingStartBtn){
        if(pointer>=0 && pointer!==solved){
          trainingStartBtn.textContent='Resume Puzzle';
        } else if(solved>0){
          trainingStartBtn.textContent='Next Puzzle';
        } else {
          trainingStartBtn.textContent='Start Daily Puzzles';
        }
        trainingStartBtn.disabled=onlineMode;
      }
    }
  }
  const streakLabel=(bestPuzzleStreak>0 && puzzleStreak!==bestPuzzleStreak)
    ?`Streak ${puzzleStreak} (Best ${bestPuzzleStreak})`
    :`Streak ${puzzleStreak}`;
  trainingStreakEl.textContent=streakLabel;
  if(trainingHintBtn){
    const disableHint=onlineMode || puzzleIndex<0 || puzzlesState.status!=='ready';
    trainingHintBtn.disabled=disableHint;
  }
}

function startPuzzleLadder(){
  if(onlineMode){
    status('Training is unavailable during online play.');
    return;
  }
  if(puzzlesState.status==='loading'){
    status('Daily puzzles are still loading.');
    return;
  }
  if(puzzlesState.status==='error'){
    status('Reloading daily puzzles...');
    if(typeof window!=='undefined' && typeof window.reloadChessPuzzles==='function'){
      window.reloadChessPuzzles();
    }
    return;
  }
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const total=Math.min(puzzles.length, DAILY_PUZZLE_LIMIT);
  if(!total){
    status('No daily puzzles available.');
    return;
  }
  if(puzzleSolvedCount>=total){
    status('Daily puzzles complete — come back tomorrow!');
    return;
  }
  puzzleHintUsed=false;
  hintMove=null;
  const target=storedPuzzleCurrent>=0
    ?Math.max(0, Math.min(storedPuzzleCurrent, total-1))
    :Math.max(0, Math.min(puzzleSolvedCount, total-1));
  loadPuzzle(target,{ reason:'training-start' });
  status(`Daily puzzle ${target+1} loaded.`);
}

function persistPuzzleProgress(overrides={}){
  if(!dailyPuzzleDateKey) return;
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const total=Math.min(puzzles.length, DAILY_PUZZLE_LIMIT);
  let currentPointer=puzzleIndex>=0?puzzleIndex:(storedPuzzleCurrent>=0?storedPuzzleCurrent:null);
  if(total<=0) currentPointer=null;
  const data={
    solved: Math.max(0, Math.min(puzzleSolvedCount, total)),
    current: currentPointer,
    streak: Math.max(0, puzzleStreak),
    best: Math.max(puzzleStreak, bestPuzzleStreak),
  };
  if(overrides && typeof overrides==='object'){
    Object.assign(data, overrides);
  }
  if(total<=0){
    data.current=null;
  }
  if(data.current!=null){
    const clamped=Math.max(0, Math.min(Number(data.current), total-1));
    data.current=Number.isFinite(clamped)?Math.round(clamped):null;
  }
  if(data.current!=null && total<=0){
    data.current=null;
  }
  savePuzzleProgress(dailyPuzzleDateKey, data);
  storedPuzzleCurrent=data.current!=null?data.current:-1;
}

function applyStoredPuzzleProgress(){
  if(!dailyPuzzleDateKey){
    puzzleSolvedCount=0;
    storedPuzzleCurrent=-1;
    puzzleStreak=0;
    bestPuzzleStreak=0;
    puzzleHintUsed=false;
    hintMove=null;
    updateTrainingHUD();
    return;
  }
  const progress=loadPuzzleProgress(dailyPuzzleDateKey);
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const total=Math.min(puzzles.length, DAILY_PUZZLE_LIMIT);
  puzzleSolvedCount=Math.max(0, Math.min(progress.solved||0, total));
  puzzleStreak=Math.max(0, progress.streak||0);
  bestPuzzleStreak=Math.max(puzzleStreak, progress.best||0);
  if(Number.isInteger(progress.current) && progress.current>=0 && progress.current<total){
    storedPuzzleCurrent=progress.current;
  } else {
    storedPuzzleCurrent=-1;
  }
  puzzleHintUsed=false;
  hintMove=null;
  updateTrainingHUD();
}

function handleDailyPuzzleState(detail){
  if(!detail || typeof detail!=='object') return;
  puzzlesState={
    status: detail.status||'loading',
    total:Array.isArray(detail.puzzles)?detail.puzzles.length:0,
    error:detail.error||null,
  };
  if(puzzlesState.status==='ready' && Array.isArray(detail.puzzles)){
    window.puzzles=detail.puzzles.slice();
  }
  if(Object.prototype.hasOwnProperty.call(detail,'dateKey')){
    dailyPuzzleDateKey=detail.dateKey||null;
  }
  if(puzzlesState.status==='ready'){
    puzzleIndex=-1;
    puzzleStep=0;
    applyStoredPuzzleProgress();
  } else if(puzzlesState.status==='error'){
    window.puzzles=[];
    puzzleIndex=-1;
    puzzleStep=0;
  }
  updateTrainingHUD();
  updatePuzzleAvailability();
}

function getSelectedAiLevel(){
  const id=depthEl?depthEl.value:null;
  if(id && AI_LEVEL_MAP.has(id)) return AI_LEVEL_MAP.get(id);
  return AI_LEVELS[0];
}

function ratingChangeFor(level, result){
  const delta=Number(level?.delta)||15;
  if(result==='win') return delta;
  if(result==='lose') return -delta;
  return 0;
}

function beginLocalMatch(reason){
  if(onlineMode || puzzleIndex>=0) return;
  const level=getSelectedAiLevel();
  const now=nowMs();
  activeMatch={
    startTime: now,
    level,
    levelId: level.id,
    ratingBefore: localLadderRating,
    reason: reason||'reset',
  };
  nonPuzzlePlyCount=0;
  mateInThreeAwarded=false;
  const meta={
    level: level.id,
    opponentRating: level.rating,
    ratingBefore: localLadderRating,
    reason: reason||'reset',
  };
  gameEvent('match_start',{ slug:'chess', meta });
}

function finishLocalMatch(result, meta={}){
  if(!activeMatch) return;
  const now=nowMs();
  const durationMs=Math.max(0, Math.round(now-(activeMatch.startTime||now)));
  const level=activeMatch.level||getSelectedAiLevel();
  let ratingAfter=localLadderRating;
  if(result==='win' || result==='lose'){
    const delta=ratingChangeFor(level, result);
    ratingAfter=Math.max(LADDER_MIN_RATING, Math.round(localLadderRating+delta));
    localLadderRating=ratingAfter;
    saveLadderRating(localLadderRating);
  }
  const eventMeta={
    level: level.id,
    opponentRating: level.rating,
    ratingBefore: activeMatch.ratingBefore,
    ratingAfter,
    reason: meta.reason||activeMatch.reason||'',
  };
  if(result==='win'){
    gameEvent('match_win',{ slug:'chess', meta:eventMeta });
  } else if(result==='lose'){
    gameEvent('match_lose',{ slug:'chess', meta:eventMeta });
  }
  gameEvent('match_end',{ slug:'chess', result, durationMs, meta:eventMeta });
  if(result==='win' && ratingAfter>=1400 && !hasLoggedElo1400){
    markMilestone('elo1400');
    hasLoggedElo1400=true;
    gameEvent('score_event',{ slug:'chess', name:'beat_elo_1400' });
  }
  activeMatch=null;
}

if(typeof window!=='undefined'){
  window.addEventListener('chess:puzzles-state',(event)=>{
    handleDailyPuzzleState(event&&event.detail?event.detail:{});
  });
  if(window.chessDailyPuzzlesState){
    handleDailyPuzzleState(window.chessDailyPuzzlesState);
  }
}

onProfileChange(()=>{
  localLadderRating=loadLadderRating();
  updateRatingDisplay(localLadderRating);
  hasLoggedElo1400=hasMilestone('elo1400');
  if(puzzlesState.status==='ready'){
    applyStoredPuzzleProgress();
  } else {
    puzzleSolvedCount=0;
    storedPuzzleCurrent=-1;
    puzzleStreak=0;
    bestPuzzleStreak=0;
    updateTrainingHUD();
  }
});

function showPuzzleHint(){
  if(onlineMode || puzzleIndex<0) return;
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const puzzle=puzzles[puzzleIndex];
  if(!puzzle || !Array.isArray(puzzle.solution) || !puzzle.solution.length) return;
  const stepIndex=Math.min(puzzleStep, puzzle.solution.length-1);
  hintMove=strToMove(puzzle.solution[stepIndex]);
  puzzleHintUsed=true;
  puzzleStreak=0;
  persistPuzzleProgress();
  updateTrainingHUD();
  status('Hint highlighted — streak reset.');
  draw();
}

function clearHint(){ hintMove=null; }

function failPuzzle(message){
  puzzleHintUsed=false;
  clearHint();
  puzzleStreak=0;
  persistPuzzleProgress();
  updateTrainingHUD();
  status(message||'Incorrect, try again.');
  loadPuzzle(puzzleIndex,{ reason:'puzzle-retry' });
}

function handlePuzzleSolved(){
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  if(!puzzles.length || puzzleIndex<0) return;
  const current=puzzleIndex;
  const total=Math.min(puzzles.length, DAILY_PUZZLE_LIMIT);
  if(!puzzleHintUsed){
    puzzleStreak++;
    if(puzzleStreak>bestPuzzleStreak) bestPuzzleStreak=puzzleStreak;
  } else {
    puzzleStreak=0;
  }
  puzzleHintUsed=false;
  clearHint();
  puzzleSolvedCount=Math.max(puzzleSolvedCount, Math.min(current+1, total));
  gameEvent('score_event', { slug:'chess', name:'puzzle_solved' });
  if(puzzleStreak===10){
    gameEvent('combo', { slug:'chess', count:10, name:'puzzle_streak' });
    gameEvent('score_event', { slug:'chess', name:'puzzle_streak_10' });
  }
  persistPuzzleProgress();
  updateTrainingHUD();
  const next=current+1;
  if(next<total){
    persistPuzzleProgress({ current: next });
    loadPuzzle(next,{ reason:'puzzle-advance' });
    status(`Puzzle ${current+1} complete!`);
  } else {
    puzzleIndex=-1;
    puzzleStep=0;
    storedPuzzleCurrent=-1;
    persistPuzzleProgress({ current:null, solved:puzzleSolvedCount });
    updateTrainingHUD();
    reset({ reason:'puzzle-complete' });
    status('Daily puzzles complete — continue in free play.');
  }
}

function queuePuzzleReply(moveStr){
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  if(!puzzles.length || puzzleIndex<0) return;
  const reply=strToMove(moveStr);
  const piece=board[reply.from.y][reply.from.x];
  movePiece(reply.from,reply.to,{});
  animateMove(reply.from,reply.to,piece,()=>{
    finalizeMove({ source:'puzzle-reply', moveStr });
    puzzleStep++;
    clearHint();
    updateTrainingHUD();
    if(over) return;
    if(puzzleIndex>=0){
      const puzzle=puzzles[puzzleIndex];
      if(puzzle && Array.isArray(puzzle.solution) && puzzleStep>=puzzle.solution.length){
        handlePuzzleSolved();
      } else {
        draw();
      }
    }
  });
}

function processPuzzleMove(moveStr){
  if(puzzleIndex<0) return false;
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const puzzle=puzzles[puzzleIndex];
  if(!puzzle || !Array.isArray(puzzle.solution) || !puzzle.solution.length) return false;
  const expected=puzzle.solution[puzzleStep];
  if(moveStr!==expected){
    failPuzzle('Incorrect — streak reset.');
    return true;
  }
  puzzleStep++;
  clearHint();
  finalizeMove({ source:'puzzle-local', moveStr });
  updateTrainingHUD();
  if(over) return true;
  if(puzzleStep>=puzzle.solution.length){
    handlePuzzleSolved();
    return true;
  }
  const replyStr=puzzle.solution[puzzleStep];
  queuePuzzleReply(replyStr);
  return true;
}

function getPlayMode(){
  if(onlineMode) return 'online';
  if(puzzleIndex>=0) return 'puzzle';
  return 'free-play';
}

function cloneMoveDetails(info){
  if(!info) return null;
  return {
    from: { x: info.from.x, y: info.from.y },
    to: { x: info.to.x, y: info.to.y },
    piece: info.piece,
    color: info.color,
    captured: info.captured,
    promotion: info.promotion || null,
    castle: info.castle || null,
    enPassant: !!info.enPassant,
  };
}

function evaluateBoardScore(){
  let total=0;
  for(let y=0;y<board.length;y++){
    const row=board[y];
    if(!row) continue;
    for(let x=0;x<row.length;x++){
      const piece=row[x];
      if(piece===EMPTY) continue;
      const value=PIECE_VALUES[toUpper(piece).toLowerCase()]||0;
      total+=colorOf(piece)==='w'?value:-value;
    }
  }
  return total;
}

function baseState(extra={}){
  const base={
    mode:getPlayMode(),
    puzzleIndex,
    puzzleStep,
    onlineMode,
    localColor,
    nextTurn:turn,
    over,
    status:statusEl.textContent||'',
    timers:snapshotTimers(),
    clock:getClockSnapshot(),
    evaluation:evaluateBoardScore(),
    evaluationHistory:evaluationHistory.slice(-40).map(entry=>({ ply:entry.ply, score:entry.score })),
    advantageSwings:advantageSwings.slice(0,6).map(entry=>({ ply:entry.ply, score:entry.score, delta:entry.delta, mover:entry.mover })),
    lastMove:cloneMoveDetails(lastMoveInfo),
  };
  return Object.assign(base, extra);
}

function emitState(state, meta={}){
  const payload=baseState(meta);
  payload.state=state;
  payload.timestamp=Date.now();
  ChessNamespace.lastState=state;
  const listeners=stateCallbacks.slice();
  for(const listener of listeners){
    try {
      listener(payload);
    } catch(err){
      console.warn('Chess state callback failed', err);
    }
  }
  return payload;
}
ChessNamespace.emitState = emitState;

function applyMoveTiming(mover){
  const now=nowMs();
  let elapsed=null;
  let flagged=false;
  if(turnStartedAt!==null){
    elapsed=Math.max(0, now-turnStartedAt);
    moveTimers[mover]+=elapsed;
    if(activeTimeControl.baseMs>0 && puzzleIndex<0){
      const before=Math.max(0, clockState[mover]);
      const remaining=Math.max(0, before-elapsed);
      if(remaining<=CLOCK_EPSILON && before>0){
        flagged=true;
        clockState[mover]=0;
      }else{
        clockState[mover]=remaining;
      }
      if(!flagged && activeTimeControl.incrementMs>0){
        clockState[mover]+=activeTimeControl.incrementMs;
        incrementFlash[mover]=now;
      }
    }
  }
  if(flagged){
    turnStartedAt=null;
  }else{
    turnStartedAt=now;
  }
  updateClockDisplay();
  return { elapsed, now, flagged };
}

function dispatchMoveEvent({mover, moveStr, source, elapsed, moveInfo, nextTurn}){
  const payload=emitState('playing', {
    mover,
    move:moveStr,
    source,
    elapsedMs:elapsed==null?null:Math.round(elapsed),
    nextTurn:nextTurn??turn,
    lastMove:moveInfo||cloneMoveDetails(lastMoveInfo),
  });
  const moverName=mover==='w'?'White':'Black';
  const sourceLabel=source && source!=='local'?`${source} `:'';
  const message=`[chess] ${moverName} ${sourceLabel}move ${moveStr}`.replace(/\s+/g,' ').trim();
  pushEvent('state', {
    message,
    details:payload,
    slug:'chess',
  });
  return payload;
}

function handleGameOverState(stateId, extra={}){
  const payload=emitState(stateId, Object.assign({
    message: overMsg,
  }, extra, {
    lastMove:cloneMoveDetails(lastMoveInfo),
  }));
  const level=stateId==='checkmate'?'info':'warn';
  const message=payload.message?`[chess] ${payload.message}`:`[chess] ${stateId}`;
  pushEvent('state', {
    level,
    message,
    details:payload,
    slug:'chess',
  });
  if(stateId==='checkmate'&&extra&&typeof extra.winner==='string'){
    const lower=extra.winner.toLowerCase();
    const winnerColor=lower.startsWith('white')?'w':lower.startsWith('black')?'b':null;
    if(winnerColor&&winnerColor===localColor){
      playVictorySound();
    }
  }
  if(!gameOverSent){
    gameOverSent=true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.max(0, Math.round(now - (runStartTime || now)));
    let winnerColor = null;
    if(extra && typeof extra.winner==='string'){
      const lower = extra.winner.toLowerCase();
      if(lower.startsWith('white')) winnerColor='w';
      else if(lower.startsWith('black')) winnerColor='b';
    }
    let result = 'draw';
    if(winnerColor){
      result = winnerColor===localColor ? 'win' : 'lose';
    }else if(stateId==='timeout' && extra && typeof extra.flagged==='string'){
      const flagged = extra.flagged === 'w' ? 'w' : extra.flagged === 'b' ? 'b' : null;
      if(flagged){
        result = flagged===localColor ? 'lose' : 'win';
      }
    }
    const value = result==='win' ? 1 : result==='lose' ? 0 : 0.5;
    const meta = {
      state: stateId,
      winner: extra?.winner || null,
      loser: extra?.loser || null,
      reason: payload?.message || '',
    };
    gameEvent('game_over', {
      slug: 'chess',
      value,
      durationMs,
      meta,
    });
    if(result==='win' || result==='lose'){
      gameEvent(result, {
        slug: 'chess',
        meta,
      });
    }
    if(!onlineMode && puzzleIndex<0){
      finishLocalMatch(result, { reason: meta.reason || payload?.message || stateId });
    }
  }
  return payload;
}

function handleFlagFor(flaggedColor, meta={}){
  if(over) return;
  const loser=flaggedColor==='w'?'White':'Black';
  const winner=flaggedColor==='w'?'Black':'White';
  over=true;
  overMsg=`${winner} wins on time`;
  status(`${loser} ran out of time!`);
  stopClock();
  handleGameOverState('timeout', Object.assign({
    winner,
    loser,
    flagged:flaggedColor,
  }, meta));
}

function getSnapshot(){
  return {
    board:board.map(row=>row.slice()),
    turn,
    over,
    mode:getPlayMode(),
    status:statusEl.textContent||'',
    timers:snapshotTimers(),
    clock:getClockSnapshot(),
    evaluation:evaluateBoardScore(),
    evaluationHistory:evaluationHistory.slice(-40).map(entry=>({ ply:entry.ply, score:entry.score })),
    advantageSwings:advantageSwings.slice(0,6).map(entry=>({ ply:entry.ply, score:entry.score, delta:entry.delta, mover:entry.mover })),
    puzzleIndex,
    puzzleStep,
    onlineMode,
    localColor,
    lastMove:cloneMoveDetails(lastMoveInfo),
    lastState:ChessNamespace.lastState||null,
  };
}
ChessNamespace.getSnapshot = getSnapshot;
ChessNamespace.getEvaluation = ()=>evaluateBoardScore();

emitState('menu', { reason:'init' });

// piece sprites encoded as base64 data URIs to avoid external binary assets
const pieceSrcs={
  bb:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAAqUExURUxpcSUlJSUlJSUlJSUlJSUlJSUlJSwsLHd0dGdkZFZTUkVCQjw6OiYmJk6AIV8AAAAIdFJOUwAWNFWCq977e1jxYQAABB5JREFUeNrtnN1y4yoQhA8gGP7m/V/3OJHiXswqsiUGUVv0dS6+6m6GkaLkv6mpqampqam2Umo4JL04fshZMxKU5afcMGALF7JjhLlalWOMKa+GqVG8St6H+KU8CJfmh4L3cVMiZra3Y7mSKqZvLn0zlVkTjFDKA9hlmamkWu26uV3EnNa2gyszs7m98MEXVA8x83I/Vqix2N7eeFChW2zvd6ugWqtF93ZLMXOsC8/m/mmaSywC1b03YmWWHeJKpJcR79QYa00eKEKMCHAhwhGoKPjwNIvUIDtg9t6Hp1nLOJupj4OYhS0+rlSVWdreTBXi38xybO+jCj9UMAv52gGoyq1UEd/CtbxQYc0CdH8us1H58jbU2CwYft1Dhe3P/WlWStx5jGnCZECGYFDrBd6ZS7mNKoBqyxDFS3HjMj0PYQJVnaH7NmvjIt3vEGZfRFhmaDazNi6netWdAsyqM7SMlRWrTodiVVRFhvTngk/itYcV/qHdR1b9kyG4TI8Isy/N2rBM9djRo16460JtVsZ9iHNY1Kt/hGW1FDLsFaNGhBWWRczIsE+MDhFW1VrqasmfRszJ2ixMrbpaeM+rJc0iX5mFxldTS/r5Ea2BWVXjq6lVv36WN+u48RDGbU+z6sb3sQsvu3exDH6KaiwRuzAmkeEvBzHXWBJP3EgnwKzjgyj9th42wKxXLCqunn4p6qrwx/MBgqUCGaLwH80HYBnBDE9hCaWo6gyPL2pogyeJWRrew6JYC2NEqFrxRYfTFPQC5bLY/65gLe0bnwqs/WfEvIdF7TuPHf53LPc7lhM6iPuD8hgrNz+KGo/Sr/oIi3tjbTrCUiJYcQcL6oplgFXpRiyN98q1XrDSIFip0A6VJFY8qSR0ElUjLBKY8hewMOXbir6wwmkq3IkCV/VQWFhswmkqLDYCa+B1LCOwNF/IEEtz+wlxgQqPGAKdv4xlRd7XnKMSajzKlU5RCVUL5cpnsTDjB0kxVRmOkGISzBC/7sknqMQyRIp8miojQ4lf+JyiwqvTAexKtVkD2JU6mAW70gkqMbNwGOkjKswsJ/0JxMdU8p99OsT4LlSPL3c1gesYClROdfhm5GMq1j0+z6C3oECFUyjPBYb8FFHOlDd1pdKG+CHi9+WMFiVarOOTcnbRIkx23yAqtI/WnMw4htYCpRhC8LsKIaytKzhtSzBledU3i/9YIcREP2Cq6QxlTsFfUsRfVbajiv66QgJXk6/ucvBNFOiLq+HnnFDYFA8UYlhVgGH1ur6SPnHiaT35sKheNSv4EugKnA+wS+Dp8LyI2Qk8S19VYmbVYE2OjdVghbbMJIC1NPlLv+blsgNi5etYxJwEsNxFLB4SSwlh0cR6V2lidcfKrUUNsCT0z2I5Ic1/3jQ1NTU1NTXVXv8DA9cW7QuQRUgAAAAASUVORK5CYII=',
  bk:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAAzUExURUxpcSIiIiUlJSUlJSUlJSUlJSUlJSUlJSUlJYWDgnd0dGNgYFZTUk5MS0NAQDIxMSYmJtBHgnAAAAAJdFJOUwARMVJ8nr7f8e5A/hcAAASpSURBVHja7ZzdcqQgEEZF/lyhgfd/2l0tx68cZEDFjNni5C6l40l32+k2VrpGo9FoNH4hPKLvHsAQ3hFN6xdq2T8r46O0xhf2UVrGLjStplWvt8daEv3+i90q0gKiaT1VK+7t0DL43te0xhX7YgRf0zL2E02raTWtpvU4rdE+UcutkAXkXnxJCzgL/IMmCAvcY7T8c7TYCw0tVDpb6L4FQ2mhuOSPXb3nQs4IwXvWrfAQAr1r6bczl1NxZg0Ylzps0Upw1k3IgIpHcbHlRKGGsEWJvqtBL4cAoiuopbQAhRB41/VChX20uBwzjs/23jvnvd9eAaW12RTFNr5+AmcO8pIYk2HGO2vGCfMPa8lt5Mhu8QF454gQSHJ+ERMXQjWECbco2Q3rFYJ9w61KZHdYzlNnAybDBG2dYjMffRtO+9AsNvBTCVRzpBJSMAtuZ3SAE4gDys9aWUgliQ0gmgnY8QKbrLzBZloddyZecrJCqG7zOtZb+b1W8NKsK4dNncHcaIX6kgcLy95qhQ7GD6XQweo2aE5jV4oOIeAefEC4MELB6kYcwlVWWUjhndCBcDEE634tV3wziqk5IFi34qZwDawwhx7BulvLlWZxzmE6WITtvgCi6Wi6nsUeOUw05sSMd+ZomrOoC0sLOYwvAzzlmxJwaa3AimYHj2BFVimx/MEuURGYIzIV76AVrQ5y2g/Zum3Rx/FzkLzv5t0s4UXFNa/nik9cSfWoQfkhN/59H+T7PwMVPwYbUlrRdNSrVLxmq5cUvNw1LQstQDvBxvIaael+px1e0ArQinKYfVwDLbl3h6e05CUtfVILc8meli/SGn5OC0k8fyeiv5zTkkgicNAq6FupkpdntLC1+JQWL+3yibu+P60lcSggV9DlUQMGWoDQuI5r8ZAI1jxwFQ6ndrSJcMlzWv2Ago9zqAr3HjealJc4o8V0osej4suGZmMTaQziuBZTIdHiMdcUzYE02qQXL9PKWSFY6sBCln36U641W1EyWPi8fLicyXiVa8n0TIP1tTRcFkReQ1+glbdCsMrD5TNepVoibZWvrHxLBh5eWa28FTp8HqZzXprltDAru5QV+uCBNAb65KVYgVaftVLdIUTei3PxaWgWgvMhZzWwM4+abQIKIKE1k7A6XlhAZbzKtHzS6uyfMXSmTUx472l3z/clVqI7Qf/Ri8hmIfpoJbtT9AO8ahBbPcMLVmgN572eZQWvZ1nB61lW8KptxboqXu4pVoDD67qVr2OF6eRRVvCiSla6jhXGnEdZYcy5aoUtoBrqQnm5aJSpBtNxGonIrfjl6wX9A1aY3KuCJY3I4XWpPH4isXxVK3vYHAZrXFWY+BwSEJJoXjuFMsTvihljxjTGmDnlG08tqiZweAlZqBzAWLeKVUskU4vSeAlDPtTsEQpv4l3E+npec1mZsQ5YWi/Cl/fLgFmwnzEvtgHDg7ZL6DVWGZO85BovUSVYNELoGpOaR7iuVZatCtWoriEEX19LVPgN7WxdfAiqRmnVf1VRV5gbbH2tcLXiUVp1a75p/ZyWukmLN61SmtbPa7nK+Cpa9flvtaS+B97+t1Sj0Wg0Go3a/AV5W8+wGCGcewAAAABJRU5ErkJggg==',
  bn:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAAwUExURUxpcSUlJSUlJSUlJSUlJSUlJSUlJSUlJSwsLHd0dGZjYlZTUk5LSkVCQjo5OCYmJvq3tckAAAAJdFJOUwASKUhtlMDg/auJd7sAAAS8SURBVHja7ZztbqswDIYXyIdpnLz3f7enkkUDEm28JmHoiOfvpu7pa2NCgvZzc3Nzc3Nzc3PzY2Y7X05q8gBgL2Y1E3A9r4mAC3p5APnBF/OaAORlWdK1vByA5Um8lpeXsJZ4LS8CeHnyuJTXBOAhWlfysgAW0bqSlwOoaImXs7P5WysTgLRqiZdA3tnpT2sYX1riVQhu/rOGp2XVEhJhA/2B2RReYS1xA6eci1yw5nyrVMLawZxeauROFJsDgLwI8QBOYnaq2ExiVbL6aBbsSdfg3qou5qcTskLpq/gRfomRPWVJyrWoSmApS2CDOyzsxqhKjAAgTKMbK22s9IHRPPZOSGorIa2B2RPuhDFeyMuvYW3/Jmu88kCvCQBvS8gEAEntNQ992Fk2a5kLeAUgb8JirMQKLF5j5sS8NnwUMlZY5UUA/LAalrD0WjGtXm5EDdNhWBSj3mseXEN6WUlY2vYyg2tIOWeinPRTNeXuZTQEpI1WEh01PKaMdn26jxWqcfnODU8S1pfwy2vufZdu10oAwoAlTfya1D8uB31YiWtx+e4P97EKV7Q6xhXKJluV9yuwJHSbXQ5lZmk6+7MWATCdbjukthKtShVtl6tQP0lTTUvi8n2OK1hpxRqt3KOKFmVRqguLFVq2w+M9PbRWH7Vi6ldFDyBqrfRaodNs0FiBpLVqWhnA1DwblFYMIKu0EgDbPBuUE4sAkE6LANc6G/RWEhertHzrbNBbSVyxrpUBtMwGKaHSKjgAH7R4pzW1zQa9lZkBZFZoJQBz29af3urH/EbLNj1UlMZ6u6mVILu2ohWVWu77FWk8suL9KGeCWMmU03S8TIim89X3n86brQj3uiWwVsu3nK9+LAUnkaK5lL1aw3atvLx9Os70BIIzJd+k08pA+D6tx/GHZ0LBz5tdCqqsL9rXEBYAH2rR8SGrB5AqWu1pTcdX+2rlvXN23qX7OSzea4G+0zr+9tLlsOag5iCuhtWuNePAKyXZyD6yAlfCai5i+VOZ9x9OR/cN48WqGlZ7y4vXXoyP982mIFbKsNoXXNLelHlTQpqOTq+Jozas9uXp5CBQTvymhBZ1K057IFotYoQd/rADdY9q7QubgrEehWAOml2sNGF13eMy1gUcHYabAABJb1W0TLcXhZ2dDy5B0hx0KudDO3orPtLyg62i1krf8eOtpITqjm/HKK34WMsMsvJqqzNby/3mfFM549uxAIg1Vme21gQArCrhma0lK1dNWGe2lgWQoyasM1vLEEAqq1NbywFIX2sRQGP6XRvWia0lYfH3WgDs+Z1VSG9baxr0jmdqqmEYVcO4gZ9IDsecNB4IyDGy7CYRVNATMZTxMOg6JHwJjRkPxoYPiezBG8iazlKOUCA5SXk8Wd7y/OHmJfohL9LPBCFzLCZ6noYZQujXX06UKkZVN5YvZ3taZXFqQzJz3RYziEsfGJ3mhByX7TtFiBUeUX5vH1in1wT9Kysx+ZbVL3Yp4yTHZTUjvdySATI9Oit2hQHYDjWk2BfqUEUAOfYlA6FHa8W+JACmfenHsX9zTVfreNGam7Uo9qZdyw3SsrfWrXVr/VIr96aH1gD+Wy0bxmDv/wV0c3Nzc3Nz05N/hvp2TMltDMoAAAAASUVORK5CYII=',
  bp:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAAwUExURUxpcSQkJCUlJSUlJSUlJSUlJSUlJSUlJSwsK3d0dGZjYlZTUk1KSUVCQjo5OSYmJrRYvAoAAAAJdFJOUwAfN1Z6o8Tg+2/nYHEAAANxSURBVHja7ZsLjqswDEWH8HPifPa/29cGpFvBEDptsJFezgqOboxxXPrTaDQajUaj0Wg0Go1Go9FoNG5LZ/redLdS6sc5rUyDuUlMQ3YC8/Cjz0BpB2mLmXnxCOycYw5xlZw61aLKFpGttY5XAmXRXvEAs4BbpEBIT3pVq2Af8AZS9OrTA0ZUr8T0wKg0BoLVDv/0mjXqfjqyQuGPOkcYUVdbfPYyKmHBak+Iz/alEZbHEd4lrnEJy/GxVkgpDcJatHQsPiY845plrUxKySEsAEKurk68wSOsA60g3urH3B3cudYg3R7CuRZJd9Q5twc+15rktVzT+kNtcQmP2hJ+Esth4UmU7VvuHa1evMufnCG6vOw7MZat8E4UZCzHFdYzHDWG06IV5i3hzpV84Qgxnd4lrqATFob5wHs8rEate2I4ssI9Uf4Y4QUpWCWjuIOIDCcfVkhzN2KWlREveEAJR6gTVoqOd3hS2wmaaYnKMoBXxE5QPKrCPB8CApNemZIrbEYCAhOPCmHt45IOrENU1nJBSzawPq3bmvLCBg3MiGl5xy6v4sFxuzdiA7PnE0JGcnDu8Cp8T0tuAoxc5vXtOAvO8f7MCmENgrexeGaFJ7GTHExBAIgIyI2opqwVUgLUCd4S39caRH8IXplTol+1pmFlE5Zcr/BhAxZIWuRnEl7lZiVa+4HhtXvj6I3zaFTQ0rr3oLSIN16FXY18u/fb4iLdM/QMr5ucIuUzXPHbzqVa8MBv4jKKBe8YeO24EJbj370I1SW/3yLr+MBL9TsIaMEL1TXqHGGwtjyYDhqrQLJZ68hLYfVmCL+hl+5iZMStGGGpe8HK2wcnl0RRr/50jaSx2h2wsWFQ8BokuugEK1e8wcJr6mQ+M2Wb4RKvd1nqBaIiZxFWKTChlWBPS7Hvrc5XgmSu/8w0w2/gPQLrL/7MFFm9bUbwuqJbcSGqolq8yMvAClH9gXjN9mb+3Ape0yXjFaQ+9Rrqb5cJVp+BY6y5Z3Oo9c8ItePqMDJ8A6VEtSvLfW3FHnFVW/rB6nOo6sNoMCJ/B/ZxQh+/vn+Kfc2bKuEIv6Hqspfw3eT3pzjXbA9suQYBxVVldnAI69viMjUrnoF2zUOLLNehYkMdsfW7mxZXgupqxTpgGVdDqx7/gdZclaH9rbrRaDQajcYl/ANeH9tMXnlbSwAAAABJRU5ErkJggg==',
  bq:'data:image/png;base64,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',
  br:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWBAMAAADOL2zRAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAAwUExURUxpcSUlJSUlJSYmJiUlJSYmJiUlJYiGhXh1dW1ramBeXVZTUk1LSkVCQjk3NyYmJt1oLkIAAAAHdFJOUwApUXmew+Gm1HRSAAAEE0lEQVR42u3aT28bVRQF8PMmCZK74ZkUljBxYU1w2KcFwTYBUdYgAduw84IPwARQ5WUd/qhLYsQXYFrKFkWGig0SycReAm1mXtMorapkbp89447TdJ7vs0fNZn4baybR0bl3ni1ZMkqlUqlUKk1C1JaWlmoS03v1Q0p8+hamtUZDh5jQC2++c/k9aNQXUh+0Fy9/8PYCbDjvknYPgKCjzS8b3/rXOxFJAMukfeKCbT4Z7ACAQw8aja997c9B1koy7htPbYDTzt9pAojSvxGcRWgKEoBLXQVU/rgElhkiPZjvd0n2L+7rCftuko4U9LDR+D4iokVWLwH8/8VfaREBJVwMJJcxnJd3FSBZWYSHV+ACCu4ga354WwIOCHUgVFCcLC0GXIDSXi5Ge/VmJAAF8Holc4JwDahgXyLVBM7h1sIglN1LpFkOtH0kCJqL/bQmv5czeBWAhISWXSbR0qLXgHLSrOy2Sy4gbHqJNOBcWiDrdY3SaHYvJFkK9ZqLjFO7AJNZnPb5N8OsDkAYUjLIHvJ98HopkTdGFk1g717m/b9KFiDBtBI3fJNOENABd0aYSbsZGQrpJax2D/kMe4miekm7Xi7GIfDM0d++QRAEXVpl9oqNvQT6euysmTFZEj0wrdFPhhE1OuTuHrdw0XiIBI7ANUexn+N6oEW0yu51BLGIjKhWqxKJKgAh8RvYXifaTlrshjQU7gVbHd1ql2gffA5RvBOEdFoY9u+6sPASmXwMK8uUikItCDUaugdLK0Tx3s6W3lkneGwQeABby7SVnYNR+bUc5JBQSFFXgcPhfKpQqJARE/QaFeIxNW0WutP0ahJGUQ9DFVaWaSlxTmXGIp3j45s4wXGHrws96+eYW2zaGTWFlJw+K5o8S+UMTUX0gpqwVwUqN6tpmSUNT1YwszIqNwu2vXLjCcI6S+VWtc/KY58FYtzj9srPV8XMqCaasUnIVbHLEsYzJy2zCHlUMVnE7GWPv6/Cegko5CHrLAPLrAqU4VA0rbIkTIRVFoy9YNfLuHtR3IxnmUU58xXdS9llNQkGlbN6bwsQ483NzTJRllkEE35WRlRrtQv1pb56vVarStibpdud3TCipwjDvS5dBN8cma2C7fwajYpiXfFEycNLYHotnWbHb7euepn1VtvvhDTwPrMVadubXp6NG6Sxmgk94D+e2c96TMn72v67N853vC/wa/SfN2rdW19vtbyr3gk/0CHnaMXpojfa7bZ/kr6zmT6OiHHIXqF/PU8/MJN2y/Ou0F2Ms0I/bvjjbX5FB+PXFfssv0RjFybo2OfpkhzzOeEgBk8P7pgsAT4Jszm67fP8SqtF9jJkFe152vZ5bpAqsleZNZVZPGl+vris6hnNaPbcZ3wflb8HKZVKlh4BcIrQAbkOku4AAAAASUVORK5CYII=',
  wb:'data:image/png;base64,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',
  wk:'data:image/png;base64,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',
  wn:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAABCUExURUxpcUFBQUNDQ0REREREREVFRUVFRUVFRf////j4+O7u7uHh4dPT08jIyLe3t6SkpJOTk4KCgm5ubl1dXU9PT0ZGRposUvgAAAAIdFJOUwAeRW2Rtd7xrVkNMAAABXFJREFUeNrtnNmS2yoURSOhiUlIDP//qzegVu/rtk0jA7YqpZWqVJ7aq9mHAzpy5c/FxcXFxcXFxcWfpiXt+aR69xdyMqt2dO58Xo23Op+XT3Dl88m8Wm81TdPJvDrnLPurRc/l1W+LNdFzeY3OqaAFr5OUlpxO50Wcc2zTgtcpKt5MAfrt1ZG2+bDW4NwKreAVGIeONB/NcIZW8AJD136s4A2FlWc21oHxA2bNsO9DrwW4VKv+lhvIB6wWWN3AuFx2tbFr3nyh0RRa92ZCafsl9r66ilhBTC5mEyNv24NuRbk/gwuhNrG+eYsV6ioKC2JYsOoJKlhFYUKIxb5jwQZvlSCFJKUOzaKpHeGSZoUFU9YHWbO7jmjuB7xmgwtG3ZOQpiP2IEnFyjK3VlLNLMFLrBW9mq3eYSV8OlaleC3eq6119XMMWlRaF/iUFzLUsKLMug3LaBy2e41NnVY6Q4uubkcm9K+tvoYqGVoKLe6+ETTJy+/HrkbTWmFFF7ej09qXkAblVfjJEFrm24pREF2uGeVVK0Ph7LqsWq+SJiH2su+qZqgUPQQXHl06RvIjQ0YPIvYYh0oHDzi+XGvZ5SJoWi/ChEfaoss1oOBfRQSWksvVHbjSCBZLURRcrtalVxYXPJIilqtMhE6kWTEheCzFUF19sQiXX60QVVQrbMam6Hwmcb/RaHHNZS6qzZgeIRVxrYApkmKPu/Kv8JgWEyj6pkQj1QlW+GAe10KKmRFaDqsoPEGrTIrDgVNnlsLD6BME9uKY3xvWRCvpdJqWQnFl9AaWZuWPFYWKj2jJzOJqQntPs+LG/wq+tCJaKK4utzekWTHjPCqixcSOzjquyT4lTbby1cViWuhclXsDEhw6H7mgEa3cmkdvSLdqwnM3j2qhobYZEa5JVtIGq22kw2LNdidjKw7b2+iHP54zCpTbrDYtmqJlnevyplm/nTBce6v+e3gSu13kdgi8X31YIWjmTFlv1X0fCTyuhQ7R57xfjUbB5BKkxhYDsNj1Aqw5Wnp6+nTsxw/GefAygMQz5Ldaw8ta9tmk3TgwtGhzzrBYhmB5WYs8LhQuxAqnsUf76eOLxX5oja/vxIXesVsNfd+RzQlWOtZys7XwOfL+hysvRZr7zOMRUpGthbuW/ZmKCB29ffg7WEFjGebXFhbArfx2sTTODdAEK0njGRbYifByKz6OhQj7O6sBVpHFymyngIzOY5RAhPdD2XZEgs/ghbSQTsAsM6dcGkR4+55Y84QHyOyjGjTd6L6w1iLCHxXIEmYAQJZ4gCW9A0PzYDkVBQkR4hqYbTY8thrQRdIjxBQin6YlaOuwQrHHI0zuD4VGTIbTAxFiCFHXSjN6KEJUfH2r9AhR8bWsBlilR4in10rA6kiE6PF16F+zQo+vAsEeTI6wfmk16FdJi1W/tDCeSJqHv6m0MJ6ghyNE1+pqdSzLjkUIVK3S6hDhocXCnLlWvWuavFj1D0Qslnh5seZaB+KYsVi4a5WmzagsTJmL0+/bEN/IlXKeVWDZCP8Mf8+zlHVPHmS4UC5mtazaWJeCNVqvi5ol2kONfQibg1htqrSHhgzPlySgtTae5+ojKS3VjQ6YEMwsBWeMTgAw5itv3vJ2YCxaXeRLyq5KcjYdhYlZacwQS4BJiVF8yoEr4zykpJUWUz4yiHXlvik/T0XYXny0xe6j0w10oolM/s//KfA1QUxSd50spoBCjJmLtd4I5brp3L6KKX1J8MSfl6GmZSlxHcRsrRiYJmWVlqRlmfMfF1uUVtHiavIrnhaGo6NmaFlaGJajhVextDToEP+elqalsZfWpRW07FKaEiVfgX9Wiwx1INf/BXRxcXFxcXFRkv8AcTNxXM/9WZYAAAAASUVORK5CYII=',
  wp:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAA8UExURUxpcUFBQUNDQ0REREREREVFRUVFRUVFRf////j4+O/v7+Li4tPT08TExK+vr5SUlICAgGtra1VVVUZGRh1ZfCsAAAAIdFJOUwAgPF19qsrhYMPqTAAAA6lJREFUeNrtmw1y4yAMRmub2BbgP7j/XTd4mH671YRkUix1trzpAd5IQgjF/Wg0Go1Go9FoNBqNRqPRaDQaP5auv9P9KKXejDEzmv6HhMlM8R8m86GPiZxp0E7fFBNhXxd3Z1n3nEvVKhti4lhonilj1yMmeuUEhmU+pcAa4p1B1WqjbEXAHopefbyzzrACdlPLYzfBiuGS16RR9zdYEcenI3nTOYT7Qyty/lBJY7puLKwYftUIV59TSI9wZxo7+coKtqy1xBiNsFbqWCUrsj5V1ySfQ1/UIu83ZFGwwVPRivyZxUG6tI65rOW8D9LFNZ5Ni0r4s7hu0lrbS1qjqNb0ktauokUlLKIlXFtUwqG2ZE/iMy2cRNm+Vc4h+pZsl1/KwUKXF74Ty8HCnSg9QRS7AyYI6XmrmMJz3uoVptPgSlYLplPpWf5xBj1meVlGpJFXu8fLR5guZi+WwATeifJphBekYBV71R0E0ud8BjsIpec+6t66T46IFCrtAXdLjBQt9FJR+jEvt4g4bgvYCcqHarPzgytxQcDkQ1XYjHj5gJnI9oC8pyJgkgcw+DlRGiH8KhmwIYeKafG+uuxoqyKT6V0o/RGDtXtJLU9P8JlVbHDuSnM8Sh7Rknu77lTm79txFNwxu2dWyKERnOP3shWChdISCRdY/CcIEbiJPnuA/8oSAYIlHK7gGRGIXtadyYwxHp4RYhxNhgVLqlc4plVYIAmuIpjXzpcPCosb5oVVjQ4mN1bHO8SgqJUqnoh7BdXi6vBOdF+LK+rm0BPz0s7ilHPIvVLn0vw4YyXmhZWbWrACGxxwLY56lbXOzAvhGrSOYeCzcmYJSsuR8XwAPfTadLaBJuafFLkXBlOjcQqDhRb3WhQWgn1kv6Ezr1Xcq5/41xnca4eXXKy2GVrqXtiNFDYjVmO1a5gVxyFeMuexG2EFrbLX2MksApdnVkjkFhODQKiCg1VZDCvBW3dprWMRCK2yWN6hTv3Vn5m+aIXfW7aARF5jtduXrWCWAzZclsG1IFUyc+isF3T2YgLLrNdsb6aIWNE7bJij6xbWBqt3SHk09SfkgyD1DjYgjRX3bP59K5SXqR2sHVbvktpE9Vc9rN4FnyjVe9XD6n2wAxD4gPl1sI+rlUNbwYpc1SyOZw6pAtjHVVrc1tGquezt2LP+W62rqzg7OGh9t0X0Ap9NatQ8tMJMdcD9U+XbV6pE+A1aYatEVa2K/P9aU1VM+7fqRqPRaDQal/AHIBXUlyHpytIAAAAASUVORK5CYII=',
  wq:'data:image/png;base64,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',
  wr:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAMAAAAL34HQAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAA/UExURUxpcUFBQUNDQ0REREREREVFRUVFRUVFRf////j4+O/v7+Li4tPT08XFxbS0tKCgoI+Pj3p6emNjY1NTU0ZGRi8lq24AAAAIdFJOUwAiRmyXweDwOT8tswAABJNJREFUeNrtnOFu2kgURs+dMWn2h0m6u+//hLvbFtRCwL7fimIxJMEqtmcorXyQIkV2yPGZYRgZCWZmZmZmZmZmZmZmZmZmSBg5MMMAENJdaEUzW3LOSlL7s7Uelrxntbutlh0AaMSRv+kQYHT8wxGrAHSAIVRcTwjhlOZTmy6rcZccA8yCxQjWWYSnU0B3L1DLYqxJfG4AIPwJm/bVM8VH+K9TqJ5JrNtWeWtZfKbDhQUC6bL0ygon/RbARTfwNXy+UixwDfHhGUDNbvN1s902sEwa8tfVJeiwJTSbzbevm93R5/khZtSyGmhfvm13DtAmDzvN9YRIR7uTff/ysnegtoxagLabvdI4Es61jMtaAdSCAUa72wFk1BJYQ6rir2sZ9NbyJI0DylsLI+HwlLSMPq0ncIxE9loEklp7+ssadOHs+vTkLSd/rHwtjL5/pPOjrXHCCtQyEnIIANY5wiXpkA6miyiohUPor9WnBaCcq/y6xt6s5HUjMNB7LRkWwOo3KQ3W5NQSr2mBj72XL+M5nfiqlsg55fV2EAX0a0GH3tYSBV+J4Ndp+cjdZjWuFi/Qz/t3GRtYq2IcGnPQgPxzawJWbm7ZVCsoUAubHqtALcJkrTurZRSqpTWEDFrrvFp4Bq0ATl4tQTTGETq5ACJ7LRaMIK0skfy1fAULmxQrwiq3Fi3YA8OxyJHKoCW71heohntZoLOK8KXNf8emARa2U9/0MUAgQSIYRxYRaEq8W8WPgO+bFMIOYGacIwkdcAJHYgzApza3VvLCG/8uFPgxLiRZDCSr7FqEaslYVo1TSAuqWHOORPfgiNE9jHPWbQOltNL9N9cBlwAzjPdYB6S7bSW00gTb+AUHerAPaVqV20QZyHmLvHVxEQmM0lqAcwl5j5hIlKwFDBErXOuKTZNcP0mrBtGP+yWtZTmtK/fjci5gN9Ea5KUbaTkDvAprJSQGeUlA+VoaKi6we9DC71ML3fiVuLxOyycuXCHb+tDvJcCKazlXoBtpJTT0LAHcRy1040HU8EVXlNdyhlJeC9DwPaxKz60AGu4vCEW1ahCDEdQltYyxtbDCWj5cC8pricFeXl5LYjgqqwUIxk2ukrXGa9ndaKEbTfkliBEIluW0DPAxtQRYUS0xkPJaTKnF71Cr6G5LdHhhLTGO+9TSXWnpJlr1lFp1KS0DfLQWVkxryiBiv36tavyMNzMDw7qDKY8QSBInZMW0ALdg38HsqkgSknBZsUVu8YSM0XzZF9AKIda9STind7jWrXterRCfOKEDHH8g8R4zjONYHyAVaz2flsVn0udzLoZhwUIMBukTzxxatlgCNG0jxmNVrABWe2XRsoca2O+dqYTFAljvlEPrYQn+0pKD+CHAapdBq3qGdivOMRlXIUOcY48RPjeTtewv8I3SyaMRAPZHgH81XivF2jYYeRDVY8o1XutDTbslJ4+R9cvEHUSooSUrLdRhopYBDVlpAJuu5SIr8ixaIjP6bbUoo8XkWgWYXqsuU6sepVWeWev316r4IdHIS8ijFedBvLLWav5uipmZmZmZmZlfhf8Bdgj15hIjYjgAAAAASUVORK5CYII='
};
const pieceImgs={};
Object.keys(pieceSrcs).forEach(k=>{ const img=new Image(); img.src=pieceSrcs[k]; img.onload=()=>draw(); pieceImgs[k]=img; });

// pre-render board texture
const boardTex=document.createElement('canvas');
boardTex.width=pixelSize; boardTex.height=pixelSize;
const bctx=require2dContext(boardTex);
bctx.setTransform(dpr,0,0,dpr,0,0);

const BOARD_LIGHT_BASE={ h:34, s:52, l:72 };
const BOARD_DARK_BASE={ h:28, s:58, l:40 };
const LIGHT_BAND_AMPLITUDE=2.4;
const LIGHT_BAND_FREQ=0.06;
const DARK_RADIAL_STRENGTH=7.5;
const S_PX=pixelSize/COLS;
const boardImageData=bctx.createImageData(pixelSize,pixelSize);

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value,min,max){
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {number} h
 * @param {number} s
 * @param {number} l
 */
function hslToRgb(h,s,l){
  const hue=((h%360)+360)%360;
  const sat=clamp(s,0,100)/100;
  const lum=clamp(l,0,100)/100;
  if(sat===0){
    const gray=Math.round(lum*255);
    return { r:gray, g:gray, b:gray };
  }
  const c=(1-Math.abs(2*lum-1))*sat;
  const x=c*(1-Math.abs((hue/60)%2-1));
  const m=lum-c/2;
  let r1=0,g1=0,b1=0;
  if(hue<60){ r1=c; g1=x; }
  else if(hue<120){ r1=x; g1=c; }
  else if(hue<180){ g1=c; b1=x; }
  else if(hue<240){ g1=x; b1=c; }
  else if(hue<300){ r1=x; b1=c; }
  else { r1=c; b1=x; }
  const r=Math.round((r1+m)*255);
  const g=Math.round((g1+m)*255);
  const b=Math.round((b1+m)*255);
  return { r, g, b };
}

function renderBoardTexture(phase=0){
  const data=boardImageData.data;
  let offset=0;
  for(let py=0;py<pixelSize;py++){
    const row=Math.min(ROWS-1, Math.floor(py/S_PX));
    const yLocal=py-row*S_PX;
    for(let px=0;px<pixelSize;px++){
      const col=Math.min(COLS-1, Math.floor(px/S_PX));
      const xLocal=px-col*S_PX;
      const u=(xLocal+0.5)/S_PX;
      const v=(yLocal+0.5)/S_PX;
      const light=((row+col)&1)===0;
      if(light){
        const band=Math.sin(xLocal*LIGHT_BAND_FREQ+phase);
        const dx=u-0.5;
        const dy=v-0.5;
        const centerBoost=(1-clamp(Math.sqrt(dx*dx+dy*dy)/0.7,0,1))*1.2;
        const lightness=clamp(BOARD_LIGHT_BASE.l+band*LIGHT_BAND_AMPLITUDE+centerBoost,0,100);
        const { r, g, b }=hslToRgb(BOARD_LIGHT_BASE.h, BOARD_LIGHT_BASE.s, lightness);
        data[offset++]=r;
        data[offset++]=g;
        data[offset++]=b;
        data[offset++]=255;
      }else{
        const dx=u-0.5;
        const dy=v-0.5;
        const dist=Math.sqrt(dx*dx+dy*dy);
        const radial=clamp(dist/0.6,0,1);
        const lightness=clamp(BOARD_DARK_BASE.l-radial*DARK_RADIAL_STRENGTH,0,100);
        const { r, g, b }=hslToRgb(BOARD_DARK_BASE.h, BOARD_DARK_BASE.s, lightness);
        data[offset++]=r;
        data[offset++]=g;
        data[offset++]=b;
        data[offset++]=255;
      }
    }
  }
  bctx.putImageData(boardImageData,0,0);
}

let boardPhase=0;
let boardPhaseAccum=0;
const BOARD_PHASE_SPEED=0.00016;
const BOARD_PHASE_STEP=0.04;

function scheduleBoardAnimation(){
  if(typeof requestAnimationFrame!=='function') return;
  const reduceMotion=typeof window!=='undefined' && typeof window.matchMedia==='function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  if(reduceMotion) return;
  function step(ts){
    if(!step.last) step.last=ts;
    const delta=ts-step.last;
    step.last=ts;
    if(delta>0){
      const deltaPhase=delta*BOARD_PHASE_SPEED;
      boardPhase=(boardPhase+deltaPhase)%(Math.PI*2);
      boardPhaseAccum+=deltaPhase;
      if(boardPhaseAccum>=BOARD_PHASE_STEP){
        boardPhaseAccum%=BOARD_PHASE_STEP;
        renderBoardTexture(boardPhase);
        draw();
      }
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

renderBoardTexture(boardPhase);
scheduleBoardAnimation();
updateTrainingHUD();
updatePuzzleAvailability();
startClockTicker();

if(timeControlSelect){
  timeControlSelect.addEventListener('change',()=>{
    const nextId=timeControlSelect.value;
    const next=timeControlMap.get(nextId)||TIME_CONTROLS[0];
    if(next.id===activeTimeControl.id) return;
    activeTimeControl=next;
    clockModeLabelEl.textContent=activeTimeControl.summary;
    if(puzzleIndex>=0){
      loadPuzzle(puzzleIndex,{ reason:'time-control-change' });
    } else {
      reset({ reason:'time-control-change' });
    }
  });
}

if(trainingStartBtn){
  trainingStartBtn.addEventListener('click',()=>{ startPuzzleLadder(); });
}
if(trainingHintBtn){
  trainingHintBtn.addEventListener('click',()=>{ showPuzzleHint(); });
}

function reset(options={}){
  resetVictorySound();
  if(puzzleIndex>=0){ loadPuzzle(puzzleIndex, options); return; }
  if(!onlineMode && activeMatch){
    finishLocalMatch('draw', { reason: options.reason||'reset' });
  }
  nonPuzzlePlyCount=0;
  mateInThreeAwarded=false;
  board = parseFEN(START); turn='w'; sel=null; moves=[]; over=false; overMsg=null;
  castleRights={w:{K:true,Q:true},b:{K:true,Q:true}};
  epTarget=null;
  repTable={};
  lastMove=null;
  lastMoveInfo=null;
  premove=null;
  resetMoveTimers();
  clearHint();
  puzzleHintUsed=false;
  resetEvaluationTracking();
  updateTrainingHUD();
  updatePuzzleAvailability();
  recordPosition();
  draw(); status(currentTurnLabel());
  const payload=emitState('playing', {
    reason: options.reason||'reset',
    move:null,
    mover:null,
    nextTurn:turn,
  });
  pushEvent('state', {
    message:`[chess] game reset (${payload.mode})`,
    details:payload,
    slug:'chess',
  });
  runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  gameOverSent = false;
  gameEvent('play', {
    slug: 'chess',
    meta: {
      mode: payload.mode,
      reason: payload.reason,
    },
  });
  if(!onlineMode && puzzleIndex<0){
    beginLocalMatch(options.reason||'reset');
  }
}
function loadPuzzle(i, options={}){
  resetVictorySound();
  if(onlineMode){
    status('Puzzles are unavailable during online play.');
    return;
  }
  const puzzles=Array.isArray(window.puzzles)?window.puzzles:[];
  const total=Math.min(puzzles.length, DAILY_PUZZLE_LIMIT);
  if(!total || !window.puzzles || !Array.isArray(window.puzzles) || i<0 || i>=total || !window.puzzles[i]){
    status('Puzzle unavailable.');
    return;
  }
  puzzleIndex=i; puzzleStep=0;
  storedPuzzleCurrent=i;
  puzzleSolvedCount=Math.max(0, Math.min(puzzleSolvedCount, total));
  const p=window.puzzles[i];
  board=parseFEN(p.fen); turn='w'; sel=null; moves=[]; over=false; overMsg=null;
  castleRights={w:{K:true,Q:true},b:{K:true,Q:true}};
  epTarget=null; repTable={};
  lastMove=null;
  lastMoveInfo=null;
  premove=null;
  resetMoveTimers();
  recordPosition();
  clearHint();
  puzzleHintUsed=false;
  resetEvaluationTracking();
  updateTrainingHUD();
  updatePuzzleAvailability();
  const title=p.title||`Challenge ${i+1}`;
  const goal=p.goal?` — ${p.goal}`:'';
  status(`${title}${goal}`.trim());
  draw();
  persistPuzzleProgress();
  const payload=emitState('playing', {
    reason: options.reason||'puzzle-load',
    move:null,
    mover:null,
    nextTurn:turn,
    puzzleIndex:i,
    puzzleStep,
  });
  pushEvent('state', {
    message:`[chess] puzzle ${i+1} loaded`,
    details:payload,
    slug:'chess',
  });
  runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  gameOverSent = false;
  gameEvent('play', {
    slug: 'chess',
    meta: {
      mode: payload.mode,
      reason: payload.reason,
      puzzle: i,
    },
  });
}
function parseFEN(f){ const rows=f.split('/'); const b=[]; for(const r of rows){ const row=[]; for(const ch of r){ if(/[1-8]/.test(ch)){ for(let i=0;i<Number(ch);i++) row.push(EMPTY);} else row.push(ch);} b.push(row);} return b; }
function boardToFEN(){
  const rows=[];
  for(const r of board){
    let line=""; let count=0;
    for(const p of r){
      if(p===EMPTY){ count++; }
      else {
        if(count){ line+=count; count=0; }
        line+=p;
      }
    }
    if(count) line+=count;
    rows.push(line);
  }
  return rows.join('/');
}
function castleStr(){
  let s='';
  if(castleRights.w.K) s+='K';
  if(castleRights.w.Q) s+='Q';
  if(castleRights.b.K) s+='k';
  if(castleRights.b.Q) s+='q';
  return s||'-';
}
function recordPosition(){
  const key=boardToFEN()+" "+turn+" "+castleStr()+" "+(epTarget?coordToSquare(epTarget.x,epTarget.y):'-');
  repTable[key]=(repTable[key]||0)+1;
}
function threefold(){
  return Object.values(repTable).some(v=>v>=3);
}
function stalemate(side){
  if(inCheck(side)) return false;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=pieceAt(x,y); if(p===EMPTY||colorOf(p)!==side) continue;
    if(genMoves(x,y).length) return false;
  }
  return true;
}
function squareAttacked(x,y,by){
  for(let yy=0;yy<8;yy++) for(let xx=0;xx<8;xx++){
    const p=pieceAt(xx,yy); if(p===EMPTY||colorOf(p)!==by) continue;
    const ms=genMovesNoFilter(xx,yy);
    if(ms.some(m=>m.x===x&&m.y===y)) return true;
  }
  return false;
}
function pieceAt(x,y){ if(y<0||y>=8||x<0||x>=8) return null; return board[y][x]; }
function colorOf(p){ if(!p||p===EMPTY) return null; return (p===p.toUpperCase())?'w':'b'; }
function toUpper(p){return p.toUpperCase();}
function same(a,b){return a.x===b.x&&a.y===b.y;}
function coordToSquare(x,y){ return 'abcdefgh'[x]+(8-y); }
function moveToStr(from,to){ return coordToSquare(from.x,from.y)+coordToSquare(to.x,to.y); }
function strToMove(s){ return {from:{x:'abcdefgh'.indexOf(s[0]),y:8-parseInt(s[1])}, to:{x:'abcdefgh'.indexOf(s[2]),y:8-parseInt(s[3])}}; }

function genMoves(x,y){
  const p=pieceAt(x,y); if(!p||p===EMPTY) return [];
  const isW = colorOf(p)==='w';
  const res=[]; const P=toUpper(p);
  function push(nx,ny,capOnly=false,quietOnly=false,extra={}){
    const t=pieceAt(nx,ny); if(nx<0||nx>=8||ny<0||ny>=8) return;
    if(t!==EMPTY && colorOf(t)===colorOf(p)) return;
    if(capOnly && (t===EMPTY)) return;
    if(quietOnly && (t!==EMPTY)) return;
    res.push(Object.assign({x:nx,y:ny},extra));
  }
  if(P==='P'){
    const dir = isW? -1: +1;
    // forward
    if(pieceAt(x,y+dir)===EMPTY){
      if(y+dir===0||y+dir===7) push(x,y+dir,false,true,{promo:true});
      else push(x, y+dir, false, true);
      if((isW&&y===6)||(!isW&&y===1)){
        if(pieceAt(x,y+2*dir)===EMPTY) push(x,y+2*dir,false,true);
      }
    }
    // captures
    [x-1,x+1].forEach(nx=>{
      const ty=y+dir; const t=pieceAt(nx,ty);
      if(t!==EMPTY && colorOf(t)!==colorOf(p)){
        if(ty===0||ty===7) push(nx,ty,true,false,{promo:true});
        else push(nx,ty,true,false);
      }
    });
    // en passant
    if(epTarget && epTarget.y===y+dir && Math.abs(epTarget.x-x)===1 && pieceAt(epTarget.x,y)=== (isW?'p':'P')){
      push(epTarget.x, epTarget.y, true, false, {ep:true});
    }
  } else if(P==='N'){
    [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(d=>push(x+d[0], y+d[1]));
  } else if(P in {'B':1,'R':1,'Q':1}){
    const dirs = (P==='B')? [[1,1],[-1,1],[1,-1],[-1,-1]] : (P==='R')? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      let nx=x+dx, ny=y+dy;
      while(nx>=0&&nx<8&&ny>=0&&ny<8){
        const t=pieceAt(nx,ny);
        if(t===EMPTY){ res.push({x:nx,y:ny}); }
        else { if(colorOf(t)!==colorOf(p)) res.push({x:nx,y:ny}); break; }
        nx+=dx; ny+=dy;
      }
    }
  } else if(P==='K'){
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(dx||dy) push(x+dx,y+dy); }
    const rights=castleRights[isW?'w':'b'];
    const enemy=isW?'b':'w';
    if(!inCheck(isW?'w':'b')){
      // kingside
      if(rights.K && pieceAt(x+1,y)===EMPTY && pieceAt(x+2,y)===EMPTY && !squareAttacked(x+1,y,enemy) && !squareAttacked(x+2,y,enemy) && toUpper(pieceAt(7,y))==='R' && colorOf(pieceAt(7,y))===colorOf(p)){
        push(x+2,y,false,true,{castle:'K'});
      }
      // queenside
      if(rights.Q && pieceAt(x-1,y)===EMPTY && pieceAt(x-2,y)===EMPTY && pieceAt(x-3,y)===EMPTY && !squareAttacked(x-1,y,enemy) && !squareAttacked(x-2,y,enemy) && toUpper(pieceAt(0,y))==='R' && colorOf(pieceAt(0,y))===colorOf(p)){
        push(x-2,y,false,true,{castle:'Q'});
      }
    }
  }
  // Filter out moves that leave own king in check (basic legality)
  const legal=[];
  for(const m of res){
    const fromPiece=board[y][x];
    let captured, rookFrom, rookTo, epCap;
    if(m.ep){
      epCap=board[y][m.x];
      board[m.y][m.x]=fromPiece;
      board[y][m.x]=EMPTY;
      board[y][x]=EMPTY;
    } else if(m.castle){
      board[m.y][m.x]=fromPiece; board[y][x]=EMPTY;
      if(m.castle==='K'){ rookFrom={x:7,y}; rookTo={x:5,y}; }
      else { rookFrom={x:0,y}; rookTo={x:3,y}; }
      board[rookTo.y][rookTo.x]=board[rookFrom.y][rookFrom.x];
      board[rookFrom.y][rookFrom.x]=EMPTY;
    } else {
      captured=board[m.y][m.x];
      board[m.y][m.x]=fromPiece; board[y][x]=EMPTY;
    }
    if(!inCheck(colorOf(fromPiece))) legal.push(m);
    if(m.ep){
      board[y][x]=fromPiece; board[m.y][m.x]=EMPTY; board[y][m.x]=epCap;
    } else if(m.castle){
      board[y][x]=fromPiece; board[m.y][m.x]=EMPTY;
      board[rookFrom.y][rookFrom.x]=board[rookTo.y][rookTo.x];
      board[rookTo.y][rookTo.x]=EMPTY;
    } else {
      board[y][x]=fromPiece; board[m.y][m.x]=captured;
    }
  }
  return legal;
}

function kingPos(side){ for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=pieceAt(x,y); if(p!==EMPTY && toUpper(p)==='K' && colorOf(p)===side) return {x,y}; } return null; }
function inCheck(side){
  const k=kingPos(side); if(!k) return false;
  // naive: see if any enemy move attacks k
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=pieceAt(x,y); if(p===EMPTY || colorOf(p)===side) continue;
    const ms = genMovesNoFilter(x,y); // pseudo
    if(ms.some(m=>m.x===k.x && m.y===k.y)) return true;
  }
  return false;
}
function genMovesNoFilter(x,y){ // like genMoves but no legality filter
  const p=pieceAt(x,y); if(!p||p===EMPTY) return [];
  const isW = colorOf(p)==='w';
  const res=[]; const P=toUpper(p);
  function push(nx,ny,capOnly=false,quietOnly=false){
    const t=pieceAt(nx,ny); if(nx<0||nx>=8||ny<0||ny>=8) return;
    if(t!==EMPTY && colorOf(t)===colorOf(p)) return;
    if(capOnly && (t===EMPTY)) return;
    if(quietOnly && (t!==EMPTY)) return;
    res.push({x:nx,y:ny});
  }
  if(P==='P'){
    const dir = isW? -1: +1;
    push(x+1, y+dir, true, false);
    push(x-1, y+dir, true, false);
    // (No en passant / promotions in pseudo)
  } else if(P==='N'){
    [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(d=>push(x+d[0], y+d[1]));
  } else if(P in {'B':1,'R':1,'Q':1}){
    const dirs = (P==='B')? [[1,1],[-1,1],[1,-1],[-1,-1]] : (P==='R')? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      let nx=x+dx, ny=y+dy;
      while(nx>=0&&nx<8&&ny>=0&&ny<8){
        const t=pieceAt(nx,ny);
        if(t===EMPTY){ res.push({x:nx,y:ny}); }
        else { if(colorOf(t)!==colorOf(p)) res.push({x:nx,y:ny}); break; }
        nx+=dx; ny+=dy;
      }
    }
  } else if(P==='K'){
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(dx||dy) push(x+dx,y+dy); }
  }
  return res;
}

function status(t){ statusEl.textContent=t; }
function updateLobbyStatus(message){ if(lobbyStatusEl) lobbyStatusEl.textContent=message||''; }
function updateRankings(list){
  if(!rankingsList) return;
  rankingsList.innerHTML='';
  if(Array.isArray(list)){
    list.forEach(p=>{
      const li=document.createElement('li');
      li.textContent=`${p.name||'Player'}: ${p.rating}`;
      rankingsList.appendChild(li);
    });
  }
}
function updatePuzzleAvailability(){
  updateTrainingHUD();
}
function clearNetworkQueues(){ netMoveQueue.length=0; lastSentMove=null; }
function currentTurnLabel(){
  if(onlineMode){
    return (turn===localColor)?'Your move':'Opponent to move';
  }
  return (turn==='w'?'White':'Black')+' to move';
}

function hasUsableAi(){
  const aiEngine=window.ai;
  return !!(aiEngine && typeof aiEngine.bestMove==='function');
}

function cancelPendingAiMove(){
  if(aiMoveTimeout!==null){
    clearTimeout(aiMoveTimeout);
    aiMoveTimeout=null;
  }
}

function handleAiUnavailable(){
  cancelPendingAiMove();
  if(!aiUnavailableNotified){
    const payload=baseState({ reason:'ai-unavailable' });
    pushEvent('state', {
      level:'warn',
      message:`[chess] ${AI_UNAVAILABLE_MESSAGE}`,
      details:payload,
      slug:'chess',
    });
    if(typeof showToast==='function') showToast(AI_UNAVAILABLE_MESSAGE);
  }
  aiUnavailableNotified=true;
  let labelMessage='';
  if(!over){
    const label=currentTurnLabel();
    labelMessage=inCheck(turn)?`${label} — CHECK!`:label;
  }
  const combined=labelMessage?`${AI_UNAVAILABLE_MESSAGE} ${labelMessage}`:AI_UNAVAILABLE_MESSAGE;
  status(combined);
}
function startOnlineMode(){
  onlineMode=true;
  clearNetworkQueues();
  puzzleIndex=-1; puzzleStep=0; hintMove=null; puzzleHintUsed=false;
  updatePuzzleAvailability();
  reset({ reason:'online-start' });
}
function stopOnlineMode(){
  if(!onlineMode) return;
  onlineMode=false;
  updatePuzzleAvailability();
  clearNetworkQueues();
  updateRankings([]);
  if(findMatchBtn) findMatchBtn.disabled=false;
  reset({ reason:'online-stop' });
}
function scheduleProcessNetQueue(){
  if(anim || !netMoveQueue.length) return;
  const next=netMoveQueue.shift();
  processNetMove(next);
}
function sendNetworkMove(moveStr){
  if(!onlineMode || typeof ChessNet==='undefined') return;
  lastSentMove=moveStr;
  try{ ChessNet.sendMove(moveStr); }
  catch(err){ /* ignore network send errors in offline tests */ }
}
function enqueueNetMove(moveStr){
  if(!onlineMode) return;
  if(anim) netMoveQueue.push(moveStr);
  else processNetMove(moveStr);
}
function highlightSquare(x,y,color){ drawGlow(fxCtx, x*S+S/2, y*S+S/2, S*0.6, color); }
function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'chess' }, '*'); } catch {}
  }
  ctx.clearRect(0,0,cssSize,cssSize);
  fxCtx.clearRect(0,0,cssSize,cssSize);
  ctx.drawImage(boardTex,0,0,cssSize,cssSize);
  if(sel){
    highlightSquare(sel.x, sel.y, 'rgba(80,200,255,0.25)');
    moves.forEach(m=> highlightSquare(m.x, m.y, 'rgba(80,200,255,0.15)'));
  }
  if(lastMove){
    highlightSquare(lastMove.from.x, lastMove.from.y, 'rgba(255,230,0,0.25)');
    highlightSquare(lastMove.to.x, lastMove.to.y, 'rgba(255,230,0,0.25)');
  }
  if(hintMove){
    highlightSquare(hintMove.from.x, hintMove.from.y, 'rgba(125,211,252,0.35)');
    highlightSquare(hintMove.to.x, hintMove.to.y, 'rgba(56,189,248,0.25)');
  }
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    if(anim && anim.progress<1 && anim.to.x===x && anim.to.y===y) continue;
    const p=pieceAt(x,y); if(p===EMPTY) continue;
    const color=colorOf(p)==='w'?'w':'b';
    const type=toUpper(p).toLowerCase();
    const img=pieceImgs[color+type];
    if(img.complete) ctx.drawImage(img,x*S,y*S,S,S);
  }
  if(anim && anim.progress<1){
    const x=anim.from.x*S+(anim.to.x-anim.from.x)*S*anim.progress;
    const y=anim.from.y*S+(anim.to.y-anim.from.y)*S*anim.progress;
    const color=colorOf(anim.piece)==='w'?'w':'b';
    const type=toUpper(anim.piece).toLowerCase();
    const img=pieceImgs[color+type];
    if(img.complete) ctx.drawImage(img,x,y,S,S);
  }
  if(overMsg){ overlay(overMsg); }
  markFirstFrame();
}

function overlay(msg){
  ctx.fillStyle='rgba(0,0,0,0.6)';
  ctx.fillRect(0,0,cssSize,cssSize);
  ctx.fillStyle='#fff';
  ctx.font='24px Inter';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(msg,cssSize/2,cssSize/2);
}

registerGameDiagnostics('chess', {
  api: {
    reset(){ ChessNamespace.resetGame({ reason:'diagnostics-reset' }); },
    getScore(){ return ChessNamespace.getEvaluation(); },
    getEntities(){ return ChessNamespace.getSnapshot(); },
  },
});

function animateMove(from,to,piece,cb){
  anim={from,to,piece,progress:0,cb};
  function step(ts){
    if(!anim.start) anim.start=ts;
    anim.progress=(ts-anim.start)/200;
    if(anim.progress>=1){
      anim.progress=1; draw();
      const done=anim.cb; anim=null; if(done) done();
    } else {
      draw();
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function processNetMove(moveStr){
  if(moveStr===lastSentMove){
    lastSentMove=null;
    scheduleProcessNetQueue();
    return;
  }
  const parsed=strToMove(moveStr);
  const fromPiece=pieceAt(parsed.from.x,parsed.from.y);
  if(!fromPiece||fromPiece===EMPTY) return;
  if(colorOf(fromPiece)!==turn) return;
  const legal=genMoves(parsed.from.x,parsed.from.y).find(m=>m.x===parsed.to.x&&m.y===parsed.to.y);
  if(!legal) return;
  const from={x:parsed.from.x,y:parsed.from.y};
  const to={x:legal.x,y:legal.y};
  const piece=board[from.y][from.x];
  movePiece(from,to,legal);
  animateMove(from,to,piece,()=>{ finalizeMove({source:'remote',moveStr}); });
}

function executePremoveIfReady(){
  if(!premove) return null;
  const from={x:premove.from.x,y:premove.from.y};
  const piece=pieceAt(from.x,from.y);
  if(!piece||piece===EMPTY||colorOf(piece)!==turn){ premove=null; return null; }
  const legal=genMoves(from.x,from.y).find(m=>m.x===premove.to.x&&m.y===premove.to.y);
  if(!legal){ premove=null; return null; }
  const to={x:legal.x,y:legal.y};
  const movingPiece=board[from.y][from.x];
  movePiece(from,to,legal);
  animateMove(from,to,movingPiece,()=>{ scheduleProcessNetQueue(); });
  const moveStr=moveToStr(from,to);
  const mover=turn;
  const timing=applyMoveTiming(mover);
  const moveInfo=cloneMoveDetails(lastMoveInfo);
  turn=(turn==='w'?'b':'w');
  recordPosition();
  premove=null;
  dispatchMoveEvent({
    mover,
    moveStr,
    source:'premove',
    elapsed:timing.elapsed,
    moveInfo,
    nextTurn:turn,
  });
  return { moveStr, color:mover, source:'premove' };
}

function finalizeMove({source,moveStr}){
  const mover=turn;
  const moveInfo=cloneMoveDetails(lastMoveInfo);
  const timing=applyMoveTiming(mover);
  if(timing.flagged){
    recordEvaluationSample({ mover });
    handleFlagFor(mover, {
      move:moveStr,
      source,
      elapsedMs:timing.elapsed==null?null:Math.round(timing.elapsed),
    });
    draw();
    scheduleProcessNetQueue();
    return;
  }
  turn=(turn==='w'?'b':'w');
  recordPosition();
  if(!onlineMode && puzzleIndex<0){
    nonPuzzlePlyCount++;
  }
  recordEvaluationSample({ mover });
  dispatchMoveEvent({
    mover,
    moveStr,
    source,
    elapsed:timing.elapsed,
    moveInfo,
    nextTurn:turn,
  });
  const premoveInfo=executePremoveIfReady();
  if(source==='local' && onlineMode){
    sendNetworkMove(moveStr);
  }
  if(premoveInfo && onlineMode && premoveInfo.color===localColor){
    sendNetworkMove(premoveInfo.moveStr);
  }
  const finishingMover=premoveInfo?premoveInfo.color:mover;
  const finishingMove=premoveInfo?premoveInfo.moveStr:moveStr;
  const finishingSource=premoveInfo?'premove':source;
  if(checkmate(turn)){
    const loser=turn==='w'?'White':'Black';
    const winner=turn==='w'?'Black':'White';
    if(onlineMode){
      const youLose=(turn===localColor);
      status(youLose?'You are in checkmate.':'Opponent is in checkmate!');
      overMsg=youLose?'Opponent wins':'You win';
    } else {
      status(loser+' in checkmate!');
      overMsg=winner+' wins';
    }
    over=true;
    stopClock();
    handleGameOverState('checkmate', {
      winner,
      loser,
      mover:finishingMover,
      move:finishingMove,
      source:finishingSource,
      premoveExecuted:!!premoveInfo,
    });
    if(!onlineMode && puzzleIndex<0 && !mateInThreeAwarded && finishingMover===localColor){
      const moveCount=Math.ceil(nonPuzzlePlyCount/2);
      if(moveCount<=3){
        mateInThreeAwarded=true;
        gameEvent('score_event',{ slug:'chess', name:'mate_in_3' });
      }
    }
    draw();
    scheduleProcessNetQueue();
    return;
  }
  if(stalemate(turn)){
    status('Stalemate');
    over=true;
    overMsg='Stalemate';
    stopClock();
    handleGameOverState('stalemate', {
      mover:finishingMover,
      move:finishingMove,
      source:finishingSource,
      premoveExecuted:!!premoveInfo,
    });
    draw();
    scheduleProcessNetQueue();
    return;
  }
  if(threefold()){
    status('Draw by repetition');
    over=true;
    overMsg='Draw by repetition';
    stopClock();
    handleGameOverState('threefold', {
      mover:finishingMover,
      move:finishingMove,
      source:finishingSource,
      premoveExecuted:!!premoveInfo,
    });
    draw();
    scheduleProcessNetQueue();
    return;
  }
  let aiUnavailableThisTurn=false;
  if(!onlineMode && puzzleIndex<0 && turn==='b'){
    if(hasUsableAi()){
      aiUnavailableNotified=false;
      status('AI thinking...');
      cancelPendingAiMove();
      aiMoveTimeout=setTimeout(()=>{ aiMoveTimeout=null; aiMove(); },20);
      scheduleProcessNetQueue();
      return;
    }
    handleAiUnavailable();
    aiUnavailableThisTurn=true;
  }
  if(!over && !aiUnavailableThisTurn){
    const label=currentTurnLabel();
    if(inCheck(turn)) status(label+' — CHECK!');
    else status(label);
  }
  draw();
  scheduleProcessNetQueue();
}

function handleIncomingMove(moveStr){ enqueueNetMove(moveStr); }

function handleNetworkStatus(message){
  updateLobbyStatus(message);
  if(typeof message==='string'){
    if(/white/i.test(message) && /you are/i.test(message)) localColor='w';
    else if(/black/i.test(message) && /you are/i.test(message)) localColor='b';
    if(/disconnected/i.test(message)){
      stopOnlineMode();
    }
  }
  if(onlineMode && !over){
    const label=currentTurnLabel();
    if(inCheck(turn)) status(label+' — CHECK!');
    else status(label);
  }
  if(findMatchBtn && !onlineMode) findMatchBtn.disabled=false;
}

function handlePlayers(list){ updateRankings(list); }

function handleFindMatch(){
  if(typeof ChessNet==='undefined') return;
  const rating=(typeof Ratings!=='undefined' && Ratings && typeof Ratings.getRating==='function')?Ratings.getRating():1200;
  startOnlineMode();
  if(findMatchBtn) findMatchBtn.disabled=true;
  updateLobbyStatus('Connecting...');
  ChessNet.onMove(handleIncomingMove);
  ChessNet.onStatus(handleNetworkStatus);
  ChessNet.onPlayers(handlePlayers);
  const wsUrl=new URL('/ws/chess', location.origin); // Intentionally follows hosting domain/protocol.
  ChessNet.connect(wsUrl.href, rating);
}
if(findMatchBtn) findMatchBtn.addEventListener('click', handleFindMatch);

function movePiece(from,to,opts={}){
  const piece=board[from.y][from.x];
  const color=colorOf(piece);
  if(toUpper(piece)==='K'){
    castleRights[color].K=false; castleRights[color].Q=false;
  }
  if(toUpper(piece)==='R'){
    if(color==='w'){
      if(from.x===0&&from.y===7) castleRights.w.Q=false;
      if(from.x===7&&from.y===7) castleRights.w.K=false;
    } else {
      if(from.x===0&&from.y===0) castleRights.b.Q=false;
      if(from.x===7&&from.y===0) castleRights.b.K=false;
    }
  }
  const target=board[to.y][to.x];
  let capturedPiece=target;
  if(toUpper(target)==='R'){
    const tColor=colorOf(target);
    if(tColor==='w'){
      if(to.x===0&&to.y===7) castleRights.w.Q=false;
      if(to.x===7&&to.y===7) castleRights.w.K=false;
    } else {
      if(to.x===0&&to.y===0) castleRights.b.Q=false;
      if(to.x===7&&to.y===0) castleRights.b.K=false;
    }
  }
  if(opts.ep){
    const dir=color==='w'?-1:1;
    capturedPiece=board[to.y-dir][to.x];
    board[to.y-dir][to.x]=EMPTY;
  }
  board[to.y][to.x]=piece;
  board[from.y][from.x]=EMPTY;
  if(opts.castle==='K'){
    board[to.y][to.x-1]=board[to.y][to.x+1];
    board[to.y][to.x+1]=EMPTY;
  } else if(opts.castle==='Q'){
    board[to.y][to.x+1]=board[to.y][to.x-2];
    board[to.y][to.x-2]=EMPTY;
  }
  let promotionPiece=null;
  if(toUpper(piece)==='P' && (to.y===0||to.y===7)){
    promotionPiece=color==='w'?'Q':'q';
    board[to.y][to.x]=promotionPiece;
  }
  epTarget=null;
  if(toUpper(piece)==='P' && Math.abs(to.y-from.y)===2){
    epTarget={x:from.x,y:(from.y+to.y)/2};
  }
  lastMove={from:{x:from.x,y:from.y},to:{x:to.x,y:to.y}};
  lastMoveInfo={
    from:{x:from.x,y:from.y},
    to:{x:to.x,y:to.y},
    piece,
    color,
    captured:capturedPiece===EMPTY?null:capturedPiece,
    promotion:promotionPiece,
    castle:opts.castle||null,
    enPassant:!!opts.ep,
  };
}

function aiMove(){
  if(over || onlineMode) return;
  if(!hasUsableAi()){
    handleAiUnavailable();
    return;
  }
  aiUnavailableNotified=false;
  const level=getSelectedAiLevel();
  const depth=Math.max(1, parseInt(level.depth,10)||1);
  const fen=boardToFEN()+" "+turn;
  const aiEngine=window.ai;
  const move=aiEngine.bestMove(fen, depth);
  if(!move) return;
  const from={x:move.from.x,y:move.from.y};
  const to={x:move.to.x,y:move.to.y};
  const piece=board[from.y][from.x];
  const moveStr=moveToStr(from,to);
  movePiece(from,to,{});
  animateMove(from,to,piece,()=>{ finalizeMove({source:'ai', moveStr}); });
}
c.addEventListener('click', (e)=>{
  if(over || anim) return;
  const r=c.getBoundingClientRect();
  const x=((e.clientX-r.left)/S)|0, y=((e.clientY-r.top)/S)|0;
  if(!sel){
    const p=pieceAt(x,y); if(!p||p===EMPTY||colorOf(p)!==turn) return;
    if(onlineMode && colorOf(p)!==localColor) return;
    sel={x,y}; moves=genMoves(x,y); draw(); return;
  } else {
    if(onlineMode){
      const selPiece=pieceAt(sel.x,sel.y);
      if(!selPiece || colorOf(selPiece)!==localColor){ sel=null; moves=[]; draw(); return; }
    }
    const m = moves.find(mm=>mm.x===x&&mm.y===y);
    if(m){
        const from={x:sel.x,y:sel.y};
        const to={x:m.x,y:m.y};
        const piece=board[sel.y][sel.x];
        const moveStr=moveToStr(from,to);
        movePiece(from,to,m);
        sel=null; moves=[];
        animateMove(from,to,piece,()=>{
          if(puzzleIndex>=0){
            const consumed=processPuzzleMove(moveStr);
            if(consumed) return;
          }
          finalizeMove({source:'local', moveStr});
        });
        return;
    } else { sel=null; moves=[]; draw(); }
  }
});
// Right-click to set premove
c.addEventListener('contextmenu',(e)=>{ e.preventDefault(); if(puzzleIndex>=0||anim) return; const r=c.getBoundingClientRect(); const x=((e.clientX-r.left)/S)|0, y=((e.clientY-r.top)/S)|0; if(!sel){ const p=pieceAt(x,y); if(!p||p===EMPTY||colorOf(p)!==turn) return; if(onlineMode && colorOf(p)!==localColor) return; sel={x,y}; moves=genMoves(x,y); draw(); } else { if(onlineMode){ const selPiece=pieceAt(sel.x,sel.y); if(!selPiece||colorOf(selPiece)!==localColor){ sel=null; moves=[]; draw(); return; } } const m=moves.find(mm=>mm.x===x&&mm.y===y); if(m){ premove={from:{x:sel.x,y:sel.y}, to:{x:m.x,y:m.y}}; sel=null; moves=[]; status('Premove set'); draw(); } else { sel=null; moves=[]; draw(); } } });
function checkmate(side){
  // if in check and no legal moves
  if(!inCheck(side)) return false;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=pieceAt(x,y); if(p===EMPTY||colorOf(p)!==side) continue;
    const ms=genMoves(x,y); if(ms.length) return false;
  }
  return true;
}
addEventListener('keydown', e=>{ if(e.key==='r'||e.key==='R') reset({ reason:'keyboard' }); });
Object.assign(ChessNamespace, {
  resetGame:(options)=>reset(options||{}),
  executeMove:(details)=>finalizeMove(details),
  signalGameOver:(state, meta)=>handleGameOverState(state, meta||{}),
});
reset({ reason:'initial-load' });
if (typeof reportReady === 'function') reportReady('chess');
}catch(err){
  try{ pushEvent('error',{ level:'error', message:'Chess failed to boot', details:{ error:String(err) } }); }catch(_){ }
  console.error('Chess failed to boot', err);
  const detail=err==null?'':String(err);
  const statusMessage='Chess failed to start. Please refresh the page.';
  try{
    if(!statusEl && typeof document!=='undefined') statusEl=document.getElementById('status');
    if(statusEl) statusEl.textContent=statusMessage;
  }catch(_){ }
  let hudShown=false;
  if(typeof document!=='undefined'){
    try{
      if(typeof showModal==='function'){
        const content=document.createElement('div');
        const heading=document.createElement('h2'); heading.textContent='Chess failed to start'; content.appendChild(heading);
        const body=document.createElement('p'); body.textContent='Please refresh the page or try again later.'; content.appendChild(body);
        if(detail){ const detailEl=document.createElement('pre'); detailEl.textContent=detail; detailEl.className='error-detail'; content.appendChild(detailEl); }
        showModal(content,{ closeButton:true });
        hudShown=true;
      }
    }catch(_){ }
  }
  if(!hudShown && typeof showToast==='function'){
    try{ showToast(detail?`${statusMessage} (${detail})`:statusMessage,{ duration:10000 }); hudShown=true; }catch(_){ }
  }
  if(typeof window!=='undefined'){
    try{
      if(!window.__GG_CHESS_GAME_ERROR__){
        window.__GG_CHESS_GAME_ERROR__=true;
        const payload={ type:'GAME_ERROR', slug:'chess', error:detail, message:statusMessage };
        try{ window.postMessage(payload,'*'); }catch(_){ }
        try{ if(window.parent && typeof window.parent.postMessage==='function') window.parent.postMessage(payload,'*'); }catch(_){ }
      }
    }catch(_){ }
  }
}
})();
