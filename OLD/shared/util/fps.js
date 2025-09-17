// shared/util/fps.js
// Utility to monitor frame rate and provide a scale factor.

export function createFpsMonitor(){
  let last = performance.now();
  let fps = 60;
  const samples = [];
  function frame(){
    const now = performance.now();
    const delta = now - last;
    last = now;
    const current = 1000 / delta;
    samples.push(current);
    if (samples.length > 60) samples.shift();
    fps = samples.reduce((a, b) => a + b, 0) / samples.length;
    return fps;
  }
  function getFps(){
    return fps;
  }
  function getScale(base = 60){
    return fps / base;
  }
  return { frame, getFps, getScale };
}
