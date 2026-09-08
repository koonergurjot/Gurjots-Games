// Per-game premise and objectives.
//
// Every game here reported a score and nothing else: no stated goal, no reason
// to prefer one way of playing over another. This gives each one a premise (why
// you are here) and three concrete objectives (what to actually try), tracked
// off the same gameEvent stream progression already uses, so a game opts in by
// reporting what happened rather than by wiring up objective logic.
//
// Objective kinds:
//   run_score       reach a score in a single run
//   run_event       fire a named event N times in a single run
//   run_event_max   reach N on a value the event carries (level, wave, rally
//                   length) -- games report "level 4", not four separate
//                   events, so counting them would measure the wrong thing
//   career          accumulate N across every run, forever
//
// An objective may also pin a `name`, for games that report several distinct
// things through one event type -- chess sends every milestone as a score_event
// and distinguishes them by name.

const STORAGE_KEY = 'gg:objectives';
export const OBJECTIVE_EVENT = 'gg:objective';

export const BRIEFINGS = {
  pong: {
    title: 'Pong Classic',
    premise: 'A service match against a machine that never blinks. Win the rally, not the point.',
    objectives: [
      { id: 'pong_rally', kind: 'run_event_max', event: 'combo', goal: 12, label: 'Keep a 12-hit rally alive' },
      { id: 'pong_win', kind: 'run_event', event: 'win', goal: 1, label: 'Win a match' },
      { id: 'pong_career', kind: 'career', event: 'win', goal: 10, label: 'Win 10 matches in all' },
    ],
  },
  snake: {
    title: 'Snake',
    premise: 'You are the last thing moving in a shut-down arcade cabinet. Grow long enough and the machine boots you to the next tier.',
    objectives: [
      { id: 'snake_50', kind: 'run_score', goal: 50, label: 'Score 50 in one run' },
      { id: 'snake_tier', kind: 'run_event_max', event: 'level_up', goal: 3, label: 'Reach speed tier 3' },
      { id: 'snake_career', kind: 'career', event: 'game_over', goal: 25, label: 'Complete 25 runs' },
    ],
  },
  tetris: {
    title: 'Tetris',
    premise: 'The well never stops filling. Every line you clear buys a few more seconds of order.',
    objectives: [
      { id: 'tetris_line', kind: 'run_event_max', event: 'level_up', goal: 3, label: 'Reach level 3' },
      { id: 'tetris_score', kind: 'run_score', goal: 5000, label: 'Score 5,000 in one run' },
      { id: 'tetris_career', kind: 'career', event: 'level_up', goal: 20, label: 'Clear 20 levels in all' },
    ],
  },
  breakout: {
    title: 'Breakout',
    premise: 'A wall stands between you and the next chamber. There is exactly one ball and no other way through.',
    objectives: [
      { id: 'breakout_clear', kind: 'run_event', event: 'level_up', goal: 1, label: 'Clear a full wall' },
      { id: 'breakout_score', kind: 'run_score', goal: 2000, label: 'Score 2,000 in one run' },
      { id: 'breakout_deep', kind: 'run_event_max', event: 'level_up', goal: 4, label: 'Reach chamber 4' },
    ],
  },
  chess: {
    title: 'Chess',
    premise: 'A full game against an engine that plays five strengths. Beat it once, then beat it faster.',
    objectives: [
      { id: 'chess_win', kind: 'run_event', event: 'win', goal: 1, label: 'Win a game' },
      { id: 'chess_puzzle', kind: 'career', event: 'score_event', name: 'puzzle_solved', goal: 5, label: 'Solve 5 daily puzzles' },
      { id: 'chess_career', kind: 'career', event: 'win', goal: 10, label: 'Win 10 games in all' },
    ],
  },
  chess3d: {
    title: 'Chess 3D',
    premise: 'The same game, played on a board you can turn. Line up the shot from an angle the engine did not expect.',
    objectives: [
      { id: 'chess3d_win', kind: 'run_event', event: 'win', goal: 1, label: 'Win a game' },
      { id: 'chess3d_play', kind: 'career', event: 'play', goal: 5, label: 'Play 5 games' },
      { id: 'chess3d_career', kind: 'career', event: 'win', goal: 5, label: 'Win 5 games in all' },
    ],
  },
  '2048': {
    title: '2048',
    premise: 'Every merge doubles. The board only ever gets tighter, so plan the tile after next.',
    objectives: [
      { id: '2048_512', kind: 'run_score', goal: 5000, label: 'Score 5,000 in one run' },
      // score_event carries the highest tile reached, so the tile itself is the
      // number to measure rather than a count of milestone events.
      { id: '2048_tile', kind: 'run_event_max', event: 'score_event', goal: 1024, label: 'Build a 1024 tile' },
      { id: '2048_career', kind: 'career', event: 'game_over', goal: 15, label: 'Finish 15 boards' },
    ],
  },
  asteroids: {
    title: 'Asteroids',
    premise: 'A mining lane has gone to rubble and something is guarding it. Clear the waves, take the supply drops, reach the gatekeeper.',
    objectives: [
      { id: 'ast_wave', kind: 'run_event_max', event: 'level_up', goal: 3, label: 'Clear three waves' },
      { id: 'ast_boss', kind: 'run_event', event: 'boss_down', goal: 1, label: 'Destroy a gatekeeper' },
      { id: 'ast_score', kind: 'run_score', goal: 3000, label: 'Score 3,000 in one run' },
    ],
  },
  maze3d: {
    title: 'Maze 3D',
    premise: 'You are somewhere inside a maze that regenerates every run. The exit exists. The clock is the opponent.',
    objectives: [
      { id: 'maze_escape', kind: 'run_event', event: 'win', goal: 1, label: 'Find the exit' },
      { id: 'maze_fast', kind: 'run_event', event: 'fast_escape', goal: 1, label: 'Escape in under 60 seconds' },
      { id: 'maze_career', kind: 'career', event: 'win', goal: 5, label: 'Escape 5 mazes in all' },
    ],
  },
  platformer: {
    title: 'Retro Platformer',
    premise: 'Every coin in the level is a piece of the gate key. Collect them all and the way out opens.',
    objectives: [
      { id: 'plat_coins', kind: 'run_event', event: 'coin_collected', goal: 2, label: 'Collect every coin in a level' },
      // The platformer reports a completed level as a win, not a level_up.
      { id: 'plat_clear', kind: 'run_event', event: 'win', goal: 1, label: 'Reach the goal' },
      { id: 'plat_career', kind: 'career', event: 'win', goal: 5, label: 'Clear 5 levels in all' },
    ],
  },
  runner: {
    title: 'City Runner',
    premise: 'The street scrolls whether you are ready or not. Every near miss is worth more than a safe jump.',
    objectives: [
      { id: 'run_1k', kind: 'run_event_max', event: 'level_up', goal: 1, label: 'Travel 1,000 metres' },
      { id: 'run_score', kind: 'run_score', goal: 500, label: 'Score 500 in one run' },
      { id: 'run_career', kind: 'career', event: 'game_over', goal: 20, label: 'Complete 20 runs' },
    ],
  },
  shooter: {
    title: 'Alien Shooter',
    premise: 'Five waves stand between you and the Gatekeeper. Nothing behind you is holding the line.',
    objectives: [
      { id: 'sh_wave', kind: 'run_event_max', event: 'level_up', goal: 3, label: 'Reach wave 3' },
      { id: 'sh_boss', kind: 'run_event', event: 'boss_down', goal: 1, label: 'Bring down the Gatekeeper' },
      { id: 'sh_score', kind: 'run_score', goal: 2500, label: 'Score 2,500 in one run' },
    ],
  },
  'alien-shooter': {
    title: 'Alien Shooter: Arena',
    premise: 'A closed arena that loops forever, harder each time around. See how deep the loop goes.',
    objectives: [
      { id: 'as_wave', kind: 'run_event_max', event: 'level_up', goal: 4, label: 'Clear 4 waves in one life' },
      { id: 'as_loop', kind: 'run_event', event: 'loop_complete', goal: 1, label: 'Complete a full loop' },
      { id: 'as_score', kind: 'run_score', goal: 4000, label: 'Score 4,000 in one run' },
    ],
  },
  'city-runner': {
    title: 'City Runner: Rush',
    premise: 'A night city on rails. There is no finish line, only the distance you are willing to hold your nerve for.',
    objectives: [
      { id: 'cr_1k', kind: 'run_event_max', event: 'level_up', goal: 1, label: 'Reach the 1km marker' },
      { id: 'cr_5k', kind: 'run_event_max', event: 'level_up', goal: 5, label: 'Reach the 5km marker' },
      { id: 'cr_clean', kind: 'run_event', event: 'clean_streak', goal: 1, label: 'Clear 1km without a hit' },
    ],
  },
  'pixel-platformer': {
    title: 'Pixel Platformer: Sandbox',
    premise: 'No timer, no enemies, no fail state. A forest built for learning exactly how far this character can jump.',
    objectives: [
      { id: 'pp_explore', kind: 'run_event_max', event: 'level_up', goal: 3, label: 'Explore 60 tiles east' },
      { id: 'pp_high', kind: 'run_event', event: 'high_ground', goal: 1, label: 'Stand on the highest platform' },
      { id: 'pp_career', kind: 'career', event: 'level_up', goal: 15, label: 'Explore 300 tiles in all' },
    ],
  },
};

// game.html and the shells disagree on one name: the catalog slug is 2048 while
// the shell directory (and its data-game) is g2048.
const SLUG_ALIASES = { g2048: '2048' };

function normalizeSlug(slug) {
  if (typeof slug !== 'string') return '';
  return SLUG_ALIASES[slug] || slug;
}

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Objectives are a nicety; never break play over storage limits.
  }
}

export function getBriefing(slug) {
  return BRIEFINGS[normalizeSlug(slug)] || null;
}

/** Completed objective ids for a game, across all runs. */
export function getCompleted(slug) {
  const state = readState();
  const done = state[normalizeSlug(slug)]?.done;
  return Array.isArray(done) ? done : [];
}

/** Career counters for a game, e.g. how many wins ever. */
function getCareer(slug) {
  const state = readState();
  const career = state[normalizeSlug(slug)]?.career;
  return career && typeof career === 'object' ? career : {};
}

// Per-run tallies live in memory: they reset when the run does, and a page
// reload is a new run by definition.
let runSlug = null;
let runEvents = {};
let runEventMax = {};
let runScore = 0;

function resetRun(slug) {
  runSlug = slug;
  runEvents = {};
  runEventMax = {};
  runScore = 0;
}

/** The number an event is reporting: a level, a wave, a rally length. */
function eventMagnitude(event) {
  for (const key of ['level', 'count', 'value']) {
    const n = Number(event[key]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function emit(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(OBJECTIVE_EVENT, { detail }));
  } catch {}
}

function complete(slug, objective) {
  const state = readState();
  const entry = state[slug] || (state[slug] = {});
  const done = Array.isArray(entry.done) ? entry.done : (entry.done = []);
  if (done.includes(objective.id)) return false;
  done.push(objective.id);
  writeState(state);
  emit({ slug, objective, completed: true });
  return true;
}

/** Progress for each objective in a game, for the briefing card and HUD. */
export function getProgress(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  const briefing = getBriefing(slug);
  if (!briefing) return [];
  const done = getCompleted(slug);
  const career = getCareer(slug);
  const live = runSlug === slug;
  return briefing.objectives.map((objective) => {
    const key = objective.name ? `${objective.event}:${objective.name}` : objective.event;
    let have = 0;
    if (objective.kind === 'career') have = career[key] || 0;
    else if (objective.kind === 'run_score') have = live ? runScore : 0;
    else if (objective.kind === 'run_event_max') have = live ? (runEventMax[key] || 0) : 0;
    else have = live ? (runEvents[key] || 0) : 0;
    return {
      ...objective,
      have: Math.min(have, objective.goal),
      done: done.includes(objective.id),
    };
  });
}

/**
 * Fold one gameplay event into the objectives for its game. Cheap, total, and
 * must never throw into the game's own code path.
 */
export function recordGameEvent(event = {}) {
  const slug = normalizeSlug(event.slug);
  const type = typeof event.type === 'string' ? event.type : '';
  if (!slug || !type || !BRIEFINGS[slug]) return null;

  if (type === 'play' || runSlug !== slug) resetRun(slug);

  const keys = [type];
  // Games put the discriminator in different places: chess sends it top level,
  // 2048 tucks it into meta.
  const name = typeof event.name === 'string' && event.name
    ? event.name
    : (typeof event.meta?.name === 'string' ? event.meta.name : '');
  if (name) keys.push(`${type}:${name}`);
  for (const key of keys) {
    runEvents[key] = (runEvents[key] || 0) + 1;
    runEventMax[key] = Math.max(runEventMax[key] || 0, eventMagnitude(event));
  }
  const value = Number(event.value);
  if (Number.isFinite(value)) runScore = Math.max(runScore, value);

  // Career counters persist; run counters do not.
  const state = readState();
  const entry = state[slug] || (state[slug] = {});
  const career = entry.career || (entry.career = {});
  for (const key of keys) career[key] = (career[key] || 0) + 1;
  writeState(state);

  const newlyDone = [];
  for (const objective of getProgress(slug)) {
    if (objective.done) continue;
    if (objective.have >= objective.goal) {
      if (complete(slug, objective)) newlyDone.push(objective);
    }
  }
  return newlyDone.length ? newlyDone : null;
}

export default { BRIEFINGS, getBriefing, getCompleted, getProgress, recordGameEvent, OBJECTIVE_EVENT };
