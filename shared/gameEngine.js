export class GameEngine {
  constructor({ fps = 60, autoPause = true } = {}) {
    this.fps = fps;
    this.dt = 1000 / fps;
    this.acc = 0;
    this.last = 0;
    this.rafId = null;
    this.running = false;
    this._autoPauseEnabled = autoPause !== false;
    this._autoPauseActive = false;
    this._autoPauseWasRunning = false;

    if (this._autoPauseEnabled) {
      this._handleShellPause = () => { this._pauseForShell(); };
      this._handleShellResume = () => { this._resumeForShell(); };
      this._handleVisibility = () => {
        if (document?.hidden) {
          this._pauseForShell();
        } else {
          this._resumeForShell();
        }
      };
      this._handleMessage = (event) => {
        const data = event && typeof event.data === 'object' ? event.data : null;
        const type = data?.type;
        if (type === 'GAME_PAUSE' || type === 'GG_PAUSE') {
          this._pauseForShell();
        } else if (type === 'GAME_RESUME' || type === 'GG_RESUME') {
          this._resumeForShell();
        }
      };
      window.addEventListener('ggshell:pause', this._handleShellPause);
      window.addEventListener('ggshell:resume', this._handleShellResume);
      document.addEventListener('visibilitychange', this._handleVisibility, { passive: true });
      window.addEventListener('message', this._handleMessage, { passive: true });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._autoPauseActive = false;
    this._autoPauseWasRunning = false;
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

  _pauseForShell() {
    if (!this._autoPauseEnabled) return;
    if (!this.running) return;
    this._autoPauseActive = true;
    this._autoPauseWasRunning = true;
    this.stop();
  }

  _resumeForShell() {
    if (!this._autoPauseEnabled) return;
    if (document?.hidden) return;
    if (!this._autoPauseActive) return;
    this._autoPauseActive = false;
    if (this._autoPauseWasRunning && !this.running) {
      this._autoPauseWasRunning = false;
      this.start();
    } else {
      this._autoPauseWasRunning = false;
    }
  }

  // Hooks
  update(_dt) {}
  render() {}
}
export default GameEngine;
