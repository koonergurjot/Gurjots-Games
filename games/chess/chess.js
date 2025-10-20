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

const VICTORY_AUDIO_SRC='/assets/audio/victory.wav';
const audioSupported=typeof Audio!=='undefined';
let audioReady=typeof window==='undefined';
let audioUnlockAttached=false;
let victoryAudio=null;
let victoryAudioFailed=false;

function ensureAudioUnlock(){
  if(audioReady||audioUnlockAttached||typeof window==='undefined') return;
  audioUnlockAttached=true;
  const unlock=()=>{
    audioReady=true;
    prepareVictoryAudio();
  };
  window.addEventListener('pointerdown',unlock,{ once:true, passive:true });
  window.addEventListener('keydown',unlock,{ once:true });
}

function prepareVictoryAudio(){
  if(!audioReady||victoryAudio||victoryAudioFailed||!audioSupported) return;
  try{
    victoryAudio=new Audio(VICTORY_AUDIO_SRC);
    victoryAudio.preload='auto';
    victoryAudio.volume=0.85;
  }catch(err){
    victoryAudioFailed=true;
    console.warn('[chess] failed to prepare victory audio',err);
  }
}

function getVictoryAudio(){
  if(!audioReady){
    ensureAudioUnlock();
    return null;
  }
  if(!victoryAudio && !victoryAudioFailed){
    prepareVictoryAudio();
  }
  return victoryAudio;
}

ensureAudioUnlock();
if(audioReady){
  prepareVictoryAudio();
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
  const audio=getVictoryAudio();
  if(audio){
    try{
      audio.pause();
      audio.currentTime=0;
    }catch{}
  }
}

function playVictorySound(){
  if(victorySoundPlayed) return;
  const audio=getVictoryAudio();
  if(!audio) return;
  victorySoundPlayed=true;
  try{ audio.currentTime=0; audio.play().catch(()=>{}); }
  catch{}
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

const pieceSrcs={
  bb:'/assets/chess2d/pieces/black-bishop.svg',
  bk:'/assets/chess2d/pieces/black-king.svg',
  bn:'/assets/chess2d/pieces/black-knight.svg',
  bp:'/assets/chess2d/pieces/black-pawn.svg',
  bq:'/assets/chess2d/pieces/black-queen.svg',
  br:'/assets/chess2d/pieces/black-rook.svg',
  wb:'/assets/chess2d/pieces/white-bishop.svg',
  wk:'/assets/chess2d/pieces/white-king.svg',
  wn:'/assets/chess2d/pieces/white-knight.svg',
  wp:'/assets/chess2d/pieces/white-pawn.svg',
  wq:'/assets/chess2d/pieces/white-queen.svg',
  wr:'/assets/chess2d/pieces/white-rook.svg',
};
const pieceImgs={};
const boardImage=new Image();
boardImage.decoding='async';

const highlightVarMap={
  selection:'--chess-highlight-selection',
  target:'--chess-highlight-target',
  lastMove:'--chess-highlight-last-move',
  hintFrom:'--chess-highlight-hint-from',
  hintTo:'--chess-highlight-hint-to',
  check:'--chess-highlight-check',
  boardBackdrop:'--chess-board-backdrop',
};
const highlightFallbacks={
  selection:'rgba(80,200,255,0.25)',
  target:'rgba(80,200,255,0.15)',
  lastMove:'rgba(255,214,0,0.28)',
  hintFrom:'rgba(125,211,252,0.35)',
  hintTo:'rgba(56,189,248,0.25)',
  check:'rgba(248,113,113,0.32)',
  boardBackdrop:'#0f172a',
};
let highlightPalette={ ...highlightFallbacks };
function refreshHighlightPalette(){
  highlightPalette={ ...highlightFallbacks };
  if(typeof window==='undefined' || !window.getComputedStyle) return;
  const style=window.getComputedStyle(document.documentElement);
  Object.entries(highlightVarMap).forEach(([key,cssVar])=>{
    const val=style.getPropertyValue(cssVar).trim();
    if(val) highlightPalette[key]=val;
  });
}
function getHighlightColor(key){
  return highlightPalette[key]||highlightFallbacks[key]||'rgba(0,0,0,0)';
}
refreshHighlightPalette();

function boardReady(){
  return Array.isArray(board) && board.length===ROWS && Array.isArray(board[0]);
}
function requestBoardDraw(){
  if(boardReady()) draw();
}

const THEME_STORAGE_KEY='chess:theme';
const themeToggleBtn=document.getElementById('chess-theme-toggle');
function applyBoardTheme(mode){
  const useHighContrast=(mode==='high-contrast');
  if(useHighContrast){
    document.documentElement.setAttribute('data-chess-theme','high-contrast');
  } else {
    document.documentElement.removeAttribute('data-chess-theme');
  }
  if(themeToggleBtn instanceof HTMLButtonElement){
    themeToggleBtn.setAttribute('aria-pressed', useHighContrast?'true':'false');
    themeToggleBtn.textContent=useHighContrast?'Use standard theme':'Use high-contrast theme';
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, useHighContrast?'high-contrast':'standard');
  } catch {}
  refreshHighlightPalette();
  requestBoardDraw();
}
let initialTheme='standard';
try {
  const stored=localStorage.getItem(THEME_STORAGE_KEY);
  if(stored==='high-contrast' || stored==='standard') initialTheme=stored;
} catch {}
applyBoardTheme(initialTheme);
if(themeToggleBtn instanceof HTMLButtonElement){
  themeToggleBtn.addEventListener('click',()=>{
    const pressed=themeToggleBtn.getAttribute('aria-pressed')==='true';
    applyBoardTheme(pressed?'standard':'high-contrast');
  });
}

boardImage.addEventListener('load',()=>{ requestBoardDraw(); });
boardImage.src='/assets/chess2d/board.svg';
Object.keys(pieceSrcs).forEach(k=>{
  const img=new Image();
  img.decoding='async';
  img.src=pieceSrcs[k];
  img.onload=()=>requestBoardDraw();
  pieceImgs[k]=img;
});


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
  if(boardImage.complete && boardImage.naturalWidth>0){
    ctx.drawImage(boardImage,0,0,cssSize,cssSize);
  } else {
    ctx.fillStyle=getHighlightColor('boardBackdrop');
    ctx.fillRect(0,0,cssSize,cssSize);
  }
  if(sel){
    highlightSquare(sel.x, sel.y, getHighlightColor('selection'));
    moves.forEach(m=> highlightSquare(m.x, m.y, getHighlightColor('target')));
  }
  if(lastMove){
    highlightSquare(lastMove.from.x, lastMove.from.y, getHighlightColor('lastMove'));
    highlightSquare(lastMove.to.x, lastMove.to.y, getHighlightColor('lastMove'));
  }
  if(hintMove){
    highlightSquare(hintMove.from.x, hintMove.from.y, getHighlightColor('hintFrom'));
    highlightSquare(hintMove.to.x, hintMove.to.y, getHighlightColor('hintTo'));
  }
  if(inCheck('w')){
    const wk=kingPos('w');
    if(wk) highlightSquare(wk.x, wk.y, getHighlightColor('check'));
  }
  if(inCheck('b')){
    const bk=kingPos('b');
    if(bk) highlightSquare(bk.x, bk.y, getHighlightColor('check'));
  }
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    if(anim && anim.progress<1 && anim.to.x===x && anim.to.y===y) continue;
    const p=pieceAt(x,y); if(p===EMPTY) continue;
    const color=colorOf(p)==='w'?'w':'b';
    const type=toUpper(p).toLowerCase();
    const img=pieceImgs[color+type];
    if(img && img.complete) ctx.drawImage(img,x*S,y*S,S,S);
  }
  if(anim && anim.progress<1){
    const x=anim.from.x*S+(anim.to.x-anim.from.x)*S*anim.progress;
    const y=anim.from.y*S+(anim.to.y-anim.from.y)*S*anim.progress;
    const color=colorOf(anim.piece)==='w'?'w':'b';
    const type=toUpper(anim.piece).toLowerCase();
    const img=pieceImgs[color+type];
    if(img && img.complete) ctx.drawImage(img,x,y,S,S);
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
