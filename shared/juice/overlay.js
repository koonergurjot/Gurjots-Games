
// shared/juice/overlay.js
import { ParticleSystem } from './particles.js';
import { ScreenShake } from './shake.js';
import { play } from './audio.js';

const overlay = document.createElement('div');
overlay.className='gg-overlay';
Object.assign(overlay.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:20});
document.body.appendChild(overlay);

const canvas = document.createElement('canvas');
Object.assign(canvas.style,{position:'absolute',inset:'0',pointerEvents:'none'});
overlay.appendChild(canvas);

const ps = new ParticleSystem({canvas});
const shake = new ScreenShake();

let lastTime = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t-lastTime)/1000);
  lastTime = t;
  ps.update(dt);
  shake.update(dt);
  ps.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Expose helpers
window.GGFX = {
  particles: ps,
  shake,
  celebrate(x,y){ ps.emit(x,y,{count:40,color:'#6cf',life:0.8,spread:1.2}); play('power'); },
  impact(x,y){ ps.emit(x,y,{count:18,color:'#f66',life:0.4,spread:0.8}); play('hit'); shake.trigger(5,0.2); },
  explode(x,y){ ps.emit(x,y,{count:60,color:'#ffa629',life:0.9,spread:1.6}); play('explode'); shake.trigger(9,0.35); }
};
