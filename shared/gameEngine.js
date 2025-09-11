export class GameEngine {
  constructor({ fps = 60 } = {}) {
    this.fps = fps;
    this.dt = 1000 / fps;
    this.acc = 0;
    this.last = 0;
    this.rafId = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      this.acc += t - this.last;
      this.last = t;
      while (this.acc >= this.dt) {
        this.update(this.dt / 1000);
        this.acc -= this.dt;
      }
      this.render();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // Hooks
  update(_dt) {}
  render() {}
}
export default GameEngine;
