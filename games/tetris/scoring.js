const LINE_CLEAR_POINTS = {
  1: 100,
  2: 300,
  3: 500,
  4: 800,
};

const T_SPIN_POINTS = {
  mini0: 100,
  mini1: 200,
  mini2: 400,
  single: 800,
  double: 1200,
  triple: 1600,
};

const FRONT_OFFSETS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function normalizeBounds(bounds) {
  const cols = Number.isFinite(bounds?.cols) ? bounds.cols : Number.isFinite(bounds?.width) ? bounds.width : 10;
  const rows = Number.isFinite(bounds?.rows) ? bounds.rows : Number.isFinite(bounds?.height) ? bounds.height : 20;
  return { cols, rows };
}

function isCellFilled(grid, x, y) {
  if (!grid) return false;
  if (typeof grid.get === 'function') {
    return !!grid.get(x, y);
  }
  if (Array.isArray(grid)) {
    return !!grid?.[y]?.[x];
  }
  return false;
}

export function detectTSpin({ piece, grid, lastRotation, clearedLines = 0, bounds }) {
  if (!piece || piece.t !== 'T' || !lastRotation) {
    return { type: 'none', mini: false, lines: clearedLines, corners: 0, frontFilled: false };
  }
  const { cols, rows } = normalizeBounds(bounds);
  const topLeftX = piece.x;
  const topLeftY = piece.y;
  const cornerOffsets = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: 2, y: 2 },
  ];
  let cornersFilled = 0;
  for (const { x: dx, y: dy } of cornerOffsets) {
    const nx = topLeftX + dx;
    const ny = topLeftY + dy;
    if (nx < 0 || nx >= cols || ny >= rows || isCellFilled(grid, nx, ny)) {
      cornersFilled++;
    }
  }
  if (cornersFilled < 3) {
    return { type: 'none', mini: false, lines: clearedLines, corners: cornersFilled, frontFilled: false };
  }
  const pivotX = topLeftX + 1;
  const pivotY = topLeftY + 1;
  const orientation = ((piece.o ?? 0) % 4 + 4) % 4;
  const frontOffset = FRONT_OFFSETS[orientation] || FRONT_OFFSETS[0];
  const frontX = pivotX + frontOffset.x;
  const frontY = pivotY + frontOffset.y;
  const frontFilled = frontX < 0 || frontX >= cols || frontY >= rows ? true : isCellFilled(grid, frontX, frontY);
  const lines = Math.max(0, clearedLines | 0);
  const kickIndex = Number.isInteger(lastRotation?.kickIndex) ? lastRotation.kickIndex : -1;
  const aggressiveKick = kickIndex >= 2;
  const usedWallKick = !!lastRotation?.kicked;
  let isMini = false;
  if (lines <= 1) {
    if (!frontFilled && !aggressiveKick) {
      isMini = true;
    }
    if (lines === 0 && usedWallKick && kickIndex >= 2) {
      isMini = false;
    }
  }
  if (lines >= 2) {
    isMini = false;
  }
  const type = isMini ? 'mini' : 'full';
  return { type, mini: isMini, lines, corners: cornersFilled, frontFilled };
}

export function createScoringSystem() {
  let score = 0;
  let combo = -1;
  let backToBack = false;

  function reset() {
    score = 0;
    combo = -1;
    backToBack = false;
  }

  function addDropPoints(soft = 0, hard = 0) {
    const softSteps = Math.max(0, soft | 0);
    const hardSteps = Math.max(0, hard | 0);
    const gain = softSteps + hardSteps * 2;
    if (gain > 0) {
      score += gain;
    }
    return { points: gain, total: score };
  }

  function scoreLock({ linesCleared = 0, tspin = { type: 'none', mini: false, lines: 0 }, softDrop = 0, hardDrop = 0 } = {}) {
    const lines = Math.max(0, linesCleared | 0);
    const dropGain = addDropPoints(softDrop, hardDrop).points;
    const tspinType = tspin?.type || 'none';
    const tspinLines = Number.isFinite(tspin?.lines) ? tspin.lines : lines;
    const tspinMini = !!tspin?.mini;
    let base = 0;
    let clearType = 'none';

    if (tspinType !== 'none') {
      if (tspinMini) {
        if (tspinLines <= 0) {
          base = T_SPIN_POINTS.mini0;
          clearType = 'tspin_mini_zero';
        } else if (tspinLines === 1) {
          base = T_SPIN_POINTS.mini1;
          clearType = 'tspin_mini_single';
        } else if (tspinLines === 2) {
          base = T_SPIN_POINTS.mini2;
          clearType = 'tspin_mini_double';
        } else {
          base = T_SPIN_POINTS.single;
          clearType = 'tspin_single';
        }
      } else {
        if (tspinLines === 1) {
          base = T_SPIN_POINTS.single;
          clearType = 'tspin_single';
        } else if (tspinLines === 2) {
          base = T_SPIN_POINTS.double;
          clearType = 'tspin_double';
        } else if (tspinLines === 3) {
          base = T_SPIN_POINTS.triple;
          clearType = 'tspin_triple';
        } else if (tspinLines <= 0) {
          base = T_SPIN_POINTS.mini0;
          clearType = 'tspin_zero';
        }
      }
    } else if (lines > 0) {
      base = LINE_CLEAR_POINTS[lines] || 0;
      if (lines === 1) clearType = 'single';
      else if (lines === 2) clearType = 'double';
      else if (lines === 3) clearType = 'triple';
      else if (lines >= 4) clearType = 'tetris';
    }

    if (lines > 0 || (tspinType !== 'none' && tspinLines > 0)) {
      combo = combo < 0 ? 0 : combo + 1;
    } else {
      combo = -1;
    }

    const comboBonus = combo > 0 ? combo * 50 : 0;
    base += comboBonus;

    const eligibleForB2B = (lines >= 4) || (tspinType !== 'none' && tspinLines > 0 && !tspinMini);
    let b2bJustAwarded = false;
    if (eligibleForB2B) {
      if (backToBack) {
        const bonus = Math.floor(base * 0.5);
        base += bonus;
        b2bJustAwarded = true;
      }
      backToBack = true;
    } else if (lines > 0) {
      backToBack = false;
    }

    score += base;

    return {
      points: base + dropGain,
      linePoints: base,
      dropPoints: dropGain,
      score,
      combo,
      comboBonus,
      backToBack,
      b2bJustAwarded,
      b2bEligible: eligibleForB2B,
      clearType,
      linesCleared: lines,
      tspin: { type: tspinType, mini: tspinMini, lines: tspinLines },
    };
  }

  return {
    reset,
    addDropPoints,
    scoreLock,
    get score() {
      return score;
    },
    get combo() {
      return combo;
    },
    get backToBack() {
      return backToBack;
    },
  };
}

export const CLEAR_DESCRIPTIONS = {
  none: '',
  single: 'Single',
  double: 'Double',
  triple: 'Triple',
  tetris: 'Tetris',
  tspin_single: 'T-Spin Single',
  tspin_double: 'T-Spin Double',
  tspin_triple: 'T-Spin Triple',
  tspin_mini_single: 'T-Spin Mini Single',
  tspin_mini_double: 'T-Spin Mini Double',
  tspin_mini_zero: 'T-Spin Mini',
  tspin_zero: 'T-Spin',
};

export function describeClear(clearType) {
  return CLEAR_DESCRIPTIONS[clearType] || '';
}
