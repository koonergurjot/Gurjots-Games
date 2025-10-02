// Quest system with daily/weekly rotations and XP rewards

// Pools of possible quests
const DAILY_POOL = [
  {
    id: 'd_play_any',
    description: 'Play a game',
    goal: 1,
    xp: 25,
    criteria: { action: 'play' }
  },
  {
    id: 'd_play3',
    description: 'Play 3 games',
    goal: 3,
    xp: 50,
    criteria: { action: 'play' }
  },
  {
    id: 'd_play3d3',
    description: 'Play 3 different 3D games',
    goal: 3,
    xp: 100,
    criteria: { action: 'play', tag: '3D', unique: true }
  }
];

const WEEKLY_POOL = [
  {
    id: 'w_play10',
    description: 'Play 10 games',
    goal: 10,
    xp: 150,
    criteria: { action: 'play' }
  },
  {
    id: 'w_play3d5',
    description: 'Play 5 different 3D games',
    goal: 5,
    xp: 250,
    criteria: { action: 'play', tag: '3D', unique: true }
  }
];

const DAILY_COUNT = 2;
const WEEKLY_COUNT = 1;

export const QUESTS_UPDATED_EVENT = 'quests:updated';

// deterministic PRNG
function xmur3(str){
  let h = 1779033703 ^ str.length;
  for(let i=0;i<str.length;i++){
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return function(){
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seedStr){
  const seed = xmur3(seedStr)();
  const rand = mulberry32(seed);
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weekKey(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function profileId(){
  try {
    return localStorage.getItem('profile') || 'default';
  } catch {
    return 'default';
  }
}

function progressKey(type, seed){
  return `questProgress:${profileId()}:${type}:${seed}`;
}

function loadProgress(type, seed){
  try {
    return JSON.parse(localStorage.getItem(progressKey(type, seed)) || '{}');
  } catch {
    return {};
  }
}

function saveProgress(type, seed, obj){
  try {
    localStorage.setItem(progressKey(type, seed), JSON.stringify(obj));
  } catch {
    // ignore write failures so quest progression degrades gracefully
  }
}

function xpKey(){
  return `profile:xp:${profileId()}`;
}

export function getXP(){
  try {
    const parsed = Number(localStorage.getItem(xpKey()));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function addXP(n){
  try {
    const k = xpKey();
    const prev = getXP();
    const next = prev + n;
    if (Number.isFinite(next)){
      localStorage.setItem(k, String(next));
    }
  } catch {
    // ignore write failures so XP tracking degrades gracefully
  }
}

function select(pool, count, seedStr){
  return seededShuffle(pool, seedStr).slice(0, count);
}

function withProgress(selection, progress){
  return selection.map(q => ({
    ...q,
    progress: progress[q.id]?.count || 0,
    completed: !!progress[q.id]?.done
  }));
}

function emitQuestUpdate(detail){
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  let event = null;
  if (typeof window.CustomEvent === 'function'){
    event = new window.CustomEvent(QUESTS_UPDATED_EVENT, { detail });
  } else if (typeof document !== 'undefined' && typeof document.createEvent === 'function'){
    event = document.createEvent('CustomEvent');
    event.initCustomEvent(QUESTS_UPDATED_EVENT, false, false, detail);
  }
  if (event) window.dispatchEvent(event);
}

export function getActiveQuests(date = new Date()){
  const daySeed = date.toISOString().slice(0,10);
  const weekSeed = weekKey(date);
  const dailySel = select(DAILY_POOL, DAILY_COUNT, daySeed);
  const weeklySel = select(WEEKLY_POOL, WEEKLY_COUNT, weekSeed);

  const dailyProg = loadProgress('daily', daySeed);
  const weeklyProg = loadProgress('weekly', weekSeed);

  const daily = withProgress(dailySel, dailyProg);
  const weekly = withProgress(weeklySel, weeklyProg);

  return { daily, weekly };
}

export function recordPlay(slug, tags = [], date = new Date()){
  const daySeed = date.toISOString().slice(0,10);
  const weekSeed = weekKey(date);

  const dailySel = select(DAILY_POOL, DAILY_COUNT, daySeed);
  const weeklySel = select(WEEKLY_POOL, WEEKLY_COUNT, weekSeed);

  const dailyProg = loadProgress('daily', daySeed);
  const weeklyProg = loadProgress('weekly', weekSeed);

  const lowerTags = tags.map(t => t.toLowerCase());

  function apply(quests, prog, type, seed){
    quests.forEach(q => {
      if (q.criteria.action !== 'play') return;
      if (q.criteria.tag && !lowerTags.includes(q.criteria.tag.toLowerCase())) return;

      let entry = prog[q.id] || { count: 0, uniques: [], done: false };
      if (q.criteria.unique){
        if (entry.uniques.includes(slug)) return; // already counted
        entry.uniques.push(slug);
        entry.count = entry.uniques.length;
      } else {
        entry.count += 1;
      }
      if (!entry.done && entry.count >= q.goal){
        entry.done = true;
        addXP(q.xp);
      }
      prog[q.id] = entry;
    });
    saveProgress(type, seed, prog);
  }

  apply(dailySel, dailyProg, 'daily', daySeed);
  apply(weeklySel, weeklyProg, 'weekly', weekSeed);

  emitQuestUpdate({
    xp: getXP(),
    daily: withProgress(dailySel, dailyProg),
    weekly: withProgress(weeklySel, weeklyProg),
    timestamp: date.toISOString()
  });
}

export default { getActiveQuests, recordPlay, getXP };
