export const MATCH_VARIANTS = {
  Classic: {
    id: 'Classic',
    label: 'Classic',
    toScore: 11,
    winByTwo: true,
    stamina: false,
  },
  Endurance: {
    id: 'Endurance',
    label: 'Endurance',
    toScore: 50,
    winByTwo: false,
    stamina: true,
  },
  Ladder: {
    id: 'Ladder',
    label: 'AI Ladder',
    toScore: 11,
    winByTwo: true,
    stamina: false,
  },
};

export const STAMINA_CONFIG = {
  drainPerSecond: 0.55,
  recoveryPerSecond: 0.65,
  minSpeedFactor: 0.8,
  activityThreshold: 0.18,
};

export const SPIN_CONFIG = {
  tangentFactor: 0.15,
  offsetFactor: 320,
  maxSpin: 9,
  maxAngleDeg: 78,
  curveAccel: 22,
  decay: 0.972,
};

export const COMBO_CONFIG = {
  minCount: 6,
};

// Rally heat. The premise of this game is "win the rally, not the point", but a
// long rally paid nothing beyond an achievement at 10 and 25. Heat builds with
// every exchange and decays when a point ends, so a rally you have invested in
// is worth protecting: the trail brightens, the court glows, and the side that
// finally wins the point banks an overdrive serve.
export const HEAT_CONFIG = {
  // Rally length at which heat reaches full.
  fullAt: 14,
  // Rally length that banks an overdrive serve for whoever wins the point.
  overdriveAt: 8,
  // Extra launch speed multiplier on an overdrive serve.
  overdriveSpeed: 1.28,
};

export const LADDER_TIERS = [
  { id: 'Easy', label: 'Easy', reactionMs: 280, predictionNoise: 80, maxSpeed: 480 },
  { id: 'Medium', label: 'Medium', reactionMs: 200, predictionNoise: 54, maxSpeed: 560 },
  { id: 'Hard', label: 'Hard', reactionMs: 140, predictionNoise: 32, maxSpeed: 680 },
  { id: 'Boss', label: 'Boss', reactionMs: 90, predictionNoise: 18, maxSpeed: 760 },
];

export const TELEMETRY_SLUG = 'pong';
