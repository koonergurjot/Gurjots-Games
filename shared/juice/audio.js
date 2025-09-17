
// shared/juice/audio.js
export const SFX = {
  hit: new Audio('/assets/audio/hit.wav'),
  explode: new Audio('/assets/audio/explode.wav'),
  power: new Audio('/assets/audio/powerup.wav'),
  click: new Audio('/assets/audio/click.wav'),
};
export function play(name){
  try{ const a=SFX[name]; if(a){ a.currentTime=0; a.play().catch(()=>{});} }catch{}
}
