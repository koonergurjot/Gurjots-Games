// Shared achievement system
// Schema: { id, title, desc, icon, condition: (event, stats) => boolean }

import { PROFILE_EVENT } from './profile-events.js';

function normalizeProfileName(name) {
  if (typeof name !== 'string') return 'default';
  const trimmed = name.trim();
  return trimmed || 'default';
}

function getAchievementStorageKey(name) {
  return `achievements:${normalizeProfileName(name)}`;
}

function getStatStorageKey(name) {
  return `achstats:${normalizeProfileName(name)}`;
}

let profile = 'default';
let ACH_KEY = getAchievementStorageKey(profile);
let STAT_KEY = getStatStorageKey(profile);

let unlocks = {};
const DEFAULT_MISSION_STATS = { daily: 0, weekly: 0, career: 0, total: 0, dailyStreak: 0, weeklyStreak: 0 };

let stats = { plays: {}, totalPlays: 0, missions: { ...DEFAULT_MISSION_STATS } };

const MASTERABLE_GAME_SLUGS = new Set([
  'pong',
  'snake',
  'tetris',
  'breakout',
  'asteroids',
  'runner',
  'shooter',
  'maze3d',
  '2048',
  'chess',
  'chess3d',
]);

const ENDURANCE_MODE_NAMES = new Set(['Endurance', 'Endless']);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function getMasteredGameCount() {
  const tally = new Map();
  Object.keys(unlocks || {}).forEach((id) => {
    if (typeof id !== 'string') return;
    const slug = id.split('_')[0];
    if (!MASTERABLE_GAME_SLUGS.has(slug)) return;
    tally.set(slug, (tally.get(slug) || 0) + 1);
  });
  let mastered = 0;
  tally.forEach((count) => {
    if (count >= 3) mastered += 1;
  });
  return mastered;
}

function checkWrapMode(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.wrap === true || meta.wrap === 'wrap') return true;
  if (meta.noWalls === true) return true;
  if (meta.rules && typeof meta.rules === 'object') {
    const rules = meta.rules;
    if (rules.wrap === true || rules.wrap === 'wrap') return true;
    if (rules.walls === 'wrap' || rules.walls === false) return true;
  }
  return false;
}

function extractStat(event, key) {
  if (!event || typeof event !== 'object') return NaN;
  if (event[key] != null) {
    const direct = toNumber(event[key]);
    if (!Number.isNaN(direct)) return direct;
  }
  const meta = event.meta;
  if (meta && typeof meta === 'object') {
    if (meta[key] != null) {
      const fromMeta = toNumber(meta[key]);
      if (!Number.isNaN(fromMeta)) return fromMeta;
    }
    if (meta.stats && typeof meta.stats === 'object' && meta.stats[key] != null) {
      const fromStats = toNumber(meta.stats[key]);
      if (!Number.isNaN(fromStats)) return fromStats;
    }
  }
  if (event.stats && typeof event.stats === 'object' && event.stats[key] != null) {
    const fromEventStats = toNumber(event.stats[key]);
    if (!Number.isNaN(fromEventStats)) return fromEventStats;
  }
  return NaN;
}

function load() {
  unlocks = {};
  stats = { plays: {}, totalPlays: 0, missions: { ...DEFAULT_MISSION_STATS } };
  try {
    const raw = localStorage.getItem(ACH_KEY);
    unlocks = raw ? JSON.parse(raw) : {};
  } catch { unlocks = {}; }
  try {
    const raw = localStorage.getItem(STAT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    stats.plays = parsed.plays || {};
    stats.totalPlays = parsed.totalPlays || 0;
    const missions = parsed.missions && typeof parsed.missions === 'object' ? parsed.missions : {};
    stats.missions = { ...DEFAULT_MISSION_STATS };
    Object.keys(DEFAULT_MISSION_STATS).forEach((key) => {
      const value = missions?.[key];
      stats.missions[key] = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_MISSION_STATS[key];
    });
    if (missions && typeof missions === 'object') {
      Object.keys(missions).forEach((key) => {
        if (key in stats.missions) return;
        const value = missions[key];
        stats.missions[key] = Number.isFinite(Number(value)) ? Number(value) : stats.missions[key];
      });
    }
  } catch { /* ignore */ }
}

export function setActiveProfile(name) {
  const nextProfile = normalizeProfileName(name);
  if (nextProfile === profile) {
    load();
    return;
  }
  profile = nextProfile;
  ACH_KEY = getAchievementStorageKey(profile);
  STAT_KEY = getStatStorageKey(profile);
  load();
}

function initProfile() {
  let stored = 'default';
  try {
    stored = localStorage.getItem('profile') || 'default';
  } catch {}
  setActiveProfile(stored);
}

initProfile();

function saveUnlocks(){
  try { localStorage.setItem(ACH_KEY, JSON.stringify(unlocks)); } catch {}
}
function saveStats(){
  try {
    localStorage.setItem(
      STAT_KEY,
      JSON.stringify({ plays: stats.plays, totalPlays: stats.totalPlays, missions: stats.missions })
    );
  } catch {}
}

export const registry = [
  { id: 'first_play', title: 'First Play', desc: 'Play any game once', icon: '🎉', condition: (e, s) => s.totalPlays >= 1 },
  { id: 'ten_plays', title: 'Ten Plays', desc: 'Play any game ten times', icon: '🔥', condition: (e, s) => s.totalPlays >= 10 },
  { id: 'five_games', title: 'Variety Gamer', desc: 'Play five different games', icon: '🎮', condition: (e, s) => Object.keys(s.plays).length >= 5 },
  { id: 'asteroids_1000', title: 'Space Ace', desc: 'Score 1000 in Asteroids', icon: '🚀', condition: (e) => e.slug === 'asteroids' && e.type === 'score' && Number(e.value) >= 1000 },
  { id: 'pong_perfect', title: 'Perfect Pong', desc: 'Win Pong 11-0', icon: '🏓', condition: (e) => e.slug === 'pong' && e.type === 'game_over' && e.value && e.value.right >= 11 && e.value.left === 0 },
  { id: 'mission_daily_3', title: 'Routine Runner', desc: 'Complete 3 daily missions', icon: '📆', condition: (_e, s) => (s.missions?.daily || 0) >= 3 },
  { id: 'mission_weekly_5', title: 'Weekend Warrior', desc: 'Complete 5 weekly missions', icon: '🛡️', condition: (_e, s) => (s.missions?.weekly || 0) >= 5 },
  { id: 'mission_total_25', title: 'Mission Master', desc: 'Complete 25 missions overall', icon: '🏅', condition: (_e, s) => (s.missions?.total || 0) >= 25 },
  { id: 'first_daily_done', title: 'Daily Warmup', desc: 'Complete your first daily mission', icon: '🌅', condition: (_e, s) => (s.missions?.daily || 0) >= 1 },
  {
    id: 'weekly_streak_4',
    title: 'Streak Keeper',
    desc: 'Maintain a four-week weekly mission streak',
    icon: '📅',
    condition: (e, s) => {
      const stored = Number(s.missions?.weeklyStreak || s.missions?.weekly || 0);
      if (stored >= 4) return true;
      const totals = e?.totals;
      const current = totals && typeof totals === 'object' ? Number(totals.weeklyStreak || totals.weekly || 0) : 0;
      return Number.isFinite(current) && current >= 4;
    },
  },
  {
    id: 'collection_10_achievements',
    title: 'Achievement Collector',
    desc: 'Unlock ten achievements across the arcade',
    icon: '🏆',
    condition: () => Object.keys(unlocks || {}).length >= 10,
  },
  {
    id: 'five_games_mastered',
    title: 'Arcade Scholar',
    desc: 'Earn three achievements in five different games',
    icon: '🎓',
    condition: () => getMasteredGameCount() >= 5,
  },
  {
    id: 'pong_spin_scientist',
    title: 'Spin Scientist',
    desc: 'Win Pong with six or more spin winners',
    icon: '🌀',
    condition: (e) => e.slug === 'pong' && e.type === 'win' && extractStat(e, 'spinWinners') >= 6,
  },
  {
    id: 'pong_endurance_50',
    title: 'Endurance Champion',
    desc: 'Win a 50-point endurance match in Pong',
    icon: '🏁',
    condition: (e) => {
      if (e.slug !== 'pong' || e.type !== 'win') return false;
      const mode = String(e?.meta?.mode || '').trim();
      if (!ENDURANCE_MODE_NAMES.has(mode)) return false;
      return extractStat(e, 'left') >= 50 || extractStat(e, 'score') >= 50;
    },
  },
  {
    id: 'pong_mayhem_crown',
    title: 'Mayhem Crown',
    desc: 'Claim victory in Pong Mayhem mode',
    icon: '👑',
    condition: (e) => e.slug === 'pong' && e.type === 'win' && String(e?.meta?.mode || '').toLowerCase() === 'mayhem',
  },
  {
    id: 'snake_no_wall_200',
    title: 'Skyline Runner',
    desc: 'Score 200 with wrap walls enabled in Snake',
    icon: '🐍',
    condition: (e) => e.slug === 'snake' && e.type === 'game_over' && checkWrapMode(e.meta) && extractStat(e, 'score') >= 200,
  },
  {
    id: 'snake_poison_master',
    title: 'Venom Handler',
    desc: 'Eat five poison pickups without dying in Snake',
    icon: '☠️',
    condition: (e) => e.slug === 'snake' && e.type === 'game_over' && extractStat(e, 'poisonEaten') >= 5,
  },
  {
    id: 'snake_combo_5',
    title: 'Combo Cruiser',
    desc: 'Reach a combo of five in Snake',
    icon: '🔗',
    condition: (e) => e.slug === 'snake' && e.type === 'combo' && extractStat(e, 'count') >= 5,
  },
  {
    id: 'snake_apples_10',
    title: 'Apple Collector',
    desc: 'Eat 10 apples in one Snake run',
    icon: '🍏',
    condition: (e) => e.slug === 'snake' && e.type === 'game_over' && extractStat(e, 'applesEaten') >= 10,
  },
  {
    id: 'snake_length_25',
    title: 'Serpent Stretch',
    desc: 'Grow your snake to length 25 in Snake',
    icon: '📏',
    condition: (e) => {
      if (e.slug !== 'snake') return false;
      const maxLen = extractStat(e, 'maxLength');
      if (!Number.isFinite(maxLen)) return false;
      return maxLen >= 25;
    },
  },
  {
    id: 'tetris_b2b_5',
    title: 'Back-to-Back Pro',
    desc: 'Chain five back-to-back clears in Tetris',
    icon: '🧱',
    condition: (e) => e.slug === 'tetris' && extractStat(e, 'b2bChain') >= 5,
  },
  {
    id: 'tetris_tspin_double',
    title: 'T-Spin Technician',
    desc: 'Score a T-Spin Double in Tetris',
    icon: '🔄',
    condition: (e) => e.slug === 'tetris' && (e.type === 'line_clear' || e.type === 'score') && String(e?.meta?.clear || e?.meta?.reason || '').toLowerCase() === 'tspin_double',
  },
  {
    id: 'tetris_finesse_a',
    title: 'Finesse A Rank',
    desc: 'Finish a Tetris game with an A finesse score',
    icon: '🅰️',
    condition: (e) => e.slug === 'tetris' && e.type === 'game_over' && String(e?.meta?.finesse || e?.meta?.grade || '').toUpperCase() === 'A',
  },
  {
    id: 'breakout_triple_ball_survivor',
    title: 'Triple Threat Survivor',
    desc: 'Survive the triple-ball chaos in Breakout',
    icon: '🔮',
    condition: (e) => e.slug === 'breakout' && extractStat(e, 'tripleBallSurvived') >= 1,
  },
  {
    id: 'breakout_gold_wall_clear',
    title: 'Gold Wall Crusher',
    desc: 'Clear a gold wall layout in Breakout',
    icon: '🟨',
    condition: (e) => e.slug === 'breakout' && extractStat(e, 'goldWallsCleared') >= 1,
  },
  {
    id: 'asteroids_wave10_nodamage',
    title: 'Untouchable Pilot',
    desc: 'Reach wave 10 in Asteroids without taking damage',
    icon: '🛰️',
    condition: (e) => e.slug === 'asteroids' && e.type === 'game_over' && extractStat(e, 'wavesCleared') >= 10 && extractStat(e, 'damageTaken') === 0,
  },
  {
    id: 'asteroids_precision_70',
    title: 'Sharpshooter',
    desc: 'Finish an Asteroids run with 70% accuracy',
    icon: '🎯',
    condition: (e) => e.slug === 'asteroids' && extractStat(e, 'accuracy') >= 70,
  },
  {
    id: 'runner_2k_no_hit',
    title: 'Flawless Sprinter',
    desc: 'Score 2,000 in Runner without taking a hit',
    icon: '🥇',
    condition: (e) => e.slug === 'runner' && e.type === 'game_over' && extractStat(e, 'score') >= 2000 && extractStat(e, 'hitsTaken') === 0,
  },
  {
    id: 'runner_coin_rush_200',
    title: 'Coin Rush',
    desc: 'Collect 200 coins in a single Runner run',
    icon: '💰',
    condition: (e) => e.slug === 'runner' && extractStat(e, 'coinsCollected') >= 200,
  },
  {
    id: 'shooter_boss_rush',
    title: 'Boss Rush Victor',
    desc: 'Defeat every boss in Arcade Shooter',
    icon: '💥',
    condition: (e) => e.slug === 'shooter' && extractStat(e, 'bossesDefeated') >= extractStat(e, 'bossCount'),
  },
  {
    id: 'shooter_perfect_wave',
    title: 'Perfect Wave',
    desc: 'Clear a wave without missing a shot in Arcade Shooter',
    icon: '🌊',
    condition: (e) => e.slug === 'shooter' && extractStat(e, 'waveAccuracy') === 100,
  },
  {
    id: 'maze_seed_speedrun',
    title: 'Seed Speedrunner',
    desc: 'Speedrun a Maze3D seed under three minutes',
    icon: '⏱️',
    condition: (e) => e.slug === 'maze3d' && e.type === 'win' && extractStat(e, 'durationMs') > 0 && extractStat(e, 'durationMs') <= 180000,
  },
  {
    id: 'maze_no_map_clear',
    title: 'No-Map Navigator',
    desc: 'Clear Maze3D without using the map',
    icon: '🧭',
    condition: (e) => e.slug === 'maze3d' && e.type === 'win' && (e?.meta?.mapUsed === false || e?.meta?.assist === 'none'),
  },
  {
    id: '2048_tile_4096',
    title: '4096 Architect',
    desc: 'Build the 4096 tile in 2048',
    icon: '🔢',
    condition: (e) => e.slug === '2048' && Math.max(extractStat(e, 'maxTile'), extractStat(e, 'tileValue')) >= 4096,
  },
  {
    id: '2048_no_undo_win',
    title: 'No Undo Victory',
    desc: 'Win a 2048 game without using undo',
    icon: '🚫',
    condition: (e) => e.slug === '2048' && e.type === 'win' && extractStat(e, 'undosUsed') === 0,
  },
  {
    id: 'chess_mate_in3',
    title: 'Mate in Three',
    desc: 'Deliver checkmate in three moves or fewer',
    icon: '♞',
    condition: (e) => e.slug === 'chess' && e.type === 'win' && extractStat(e, 'moves') <= 3,
  },
  {
    id: 'chess_puzzle_streak_10',
    title: 'Puzzle Grinder',
    desc: 'Reach a 10 puzzle streak in Chess training',
    icon: '🧩',
    condition: (e) => e.slug === 'chess' && extractStat(e, 'puzzleStreak') >= 10,
  },
  {
    id: 'chess3d_elo_1400',
    title: '3D Tactician',
    desc: 'Reach a 1400 rating in Chess 3D',
    icon: '📈',
    condition: (e) => e.slug === 'chess3d' && (extractStat(e, 'elo') >= 1400 || extractStat(e, 'rating') >= 1400),
  },
  {
    id: 'chess3d_fast_mate_30s',
    title: 'Speedy Strategist',
    desc: 'Deliver mate in Chess 3D under 30 seconds',
    icon: '⚡',
    condition: (e) => e.slug === 'chess3d' && e.type === 'win' && extractStat(e, 'durationMs') > 0 && extractStat(e, 'durationMs') <= 30000,
  },
];

const toastQueue = [];
let showing = false;
let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

function queueToast(ach) {
  toastQueue.push(ach);
  if (!showing) showNextToast();
}

function showNextToast() {
  if (!toastQueue.length) { showing = false; return; }
  showing = true;
  const ach = toastQueue.shift();
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.textContent = `${ach.icon} ${ach.title}`;
  getContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
      showNextToast();
    }, 300);
  }, 3000);
}

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
  .ach-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--button-bg,#111522);color:var(--fg,#cfe6ff);padding:8px 14px;border:1px solid var(--button-border,#27314b);border-radius:8px;opacity:0;transition:opacity .3s,transform .3s;z-index:1000;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-size:14px;}
  .ach-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  `;
  document.head.appendChild(style);
}

export function emitEvent(event = {}) {
  // update stats
  if (event.type === 'play') {
    stats.totalPlays++;
    stats.plays[event.slug] = (stats.plays[event.slug] || 0) + 1;
    saveStats();
  } else if (event.type === 'mission_complete') {
    const kind = event?.mission?.kind;
    stats.missions = stats.missions || { ...DEFAULT_MISSION_STATS };
    if (kind === 'daily' || kind === 'weekly' || kind === 'career') {
      stats.missions[kind] = (stats.missions[kind] || 0) + 1;
    }
    stats.missions.total = (stats.missions.total || 0) + 1;
    const totals = event?.totals;
    if (totals && typeof totals === 'object') {
      Object.entries(totals).forEach(([key, value]) => {
        if (!Number.isFinite(Number(value))) return;
        stats.missions[key] = Number(value);
      });
    }
    saveStats();
  }

  for (const a of registry) {
    if (unlocks[a.id]) continue;
    let unlocked = false;
    try { unlocked = a.condition(event, stats); } catch { unlocked = false; }
    if (unlocked) {
      unlocks[a.id] = Date.now();
      saveUnlocks();
      if (typeof document !== 'undefined') queueToast(a);
    }
  }
}

export function getAchievements(){
  return registry.map(a => ({ ...a, unlocked: !!unlocks[a.id], unlockedAt: unlocks[a.id] }));
}

export function getUnlocks(){
  return { ...unlocks };
}

if (typeof window !== 'undefined') {
  window.addEventListener(PROFILE_EVENT, (event) => {
    const name = event && event.detail && event.detail.profile ? event.detail.profile.name : undefined;
    setActiveProfile(name);
  });
}
