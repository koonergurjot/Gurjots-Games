const SNAKE_SKINS = [
  { id: 'default', name: 'Purple', color: '#8b5cf6', unlock: p => true },
  { id: 'gold', name: 'Gold', color: '#fcd34d', unlock: p => p.best >= 10 },
  { id: 'emerald', name: 'Emerald', color: '#10b981', unlock: p => p.plays >= 5 }
];

const FRUIT_SKINS = [
  { id: 'classic', name: 'Classic', icons: ['🍎','🍌','🍇','🍒','🍊','🍉'], color: '#22d3ee', unlock: p => true },
  { id: 'gems', name: 'Gems', icons: ['💎','🔶','🔷'], color: '#eab308', unlock: p => p.best >= 15 }
];

const BOARD_THEMES = [
  { id: 'dark', name: 'Dark', colors: ['#111623', '#0f1320'], unlock: p => true },
  { id: 'light', name: 'Light', colors: ['#f3f4f6', '#e5e7eb'], unlock: p => p.plays >= 3 }
];
