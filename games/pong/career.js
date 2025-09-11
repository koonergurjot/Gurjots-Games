// AI profiles and unlock order for Pong career mode
// Each opponent defines speed, reaction (portion of width before AI reacts)
// and a cosmetic reward unlocked upon victory.
window.PONG_CAREER = [
  { name: 'Rookie Bot', speed: 0.08, reaction: 0.5, reward: { paddle: '#4ade80' } },
  { name: 'Pro Bot', speed: 0.12, reaction: 0.4, reward: { ball: '#fde047' } },
  { name: 'Elite Bot', speed: 0.15, reaction: 0.3, reward: { paddle: '#a855f7' } },
  { name: 'Champion Bot', speed: 0.18, reaction: 0.25, reward: { paddle: '#ec4899', ball: '#22d3ee' } }
];
