function ensureDocument(doc) {
  if (doc && typeof doc.createElement === 'function') return doc;
  if (typeof document !== 'undefined') return document;
  return null;
}

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export class ShooterUI {
  constructor(options = {}) {
    const doc = ensureDocument(options.document);
    this.document = doc;
    this.totalBosses = Number.isFinite(options.totalBosses) ? Number(options.totalBosses) : 0;
    this.perfectTimer = null;
    if (!doc) {
      this.root = null;
      return;
    }
    const root = options.root || doc.querySelector('.hud');
    this.root = root || null;
    if (!this.root) return;
    this.root.classList.add('hud--enhanced');
    this.waveValue = this.createStat('Wave', '0/0', 'wave');
    this.timerValue = this.createStat('Time', '0:00', 'timer');
    this.statusValue = this.createStat('Status', 'Ready', 'status');
    this.reset(this.totalBosses);
  }

  createStat(label, initialValue, key) {
    const doc = this.document;
    if (!doc || !this.root) return null;
    const stat = doc.createElement('span');
    stat.className = `hud__stat hud__stat--${key}`;
    const labelNode = doc.createElement('span');
    labelNode.className = 'hud__stat-label';
    labelNode.textContent = `${label}:`;
    const valueNode = doc.createElement('span');
    valueNode.className = 'hud__stat-value';
    valueNode.textContent = initialValue;
    stat.append(labelNode, valueNode);
    this.root.appendChild(stat);
    return valueNode;
  }

  reset(totalBosses = this.totalBosses) {
    if (!Number.isFinite(totalBosses)) totalBosses = this.totalBosses;
    this.totalBosses = Math.max(0, Number(totalBosses) || 0);
    this.setWave(0, this.totalBosses);
    this.setTimer(0);
    this.setIntermission(0);
    this.setStatus('Ready');
  }

  setWave(current, total = this.totalBosses, name) {
    if (!this.waveValue) return;
    const safeTotal = Math.max(0, Number.isFinite(total) ? Number(total) : this.totalBosses);
    const safeCurrent = Math.max(0, Number.isFinite(current) ? Number(current) : 0);
    this.waveValue.textContent = safeTotal > 0 ? `${safeCurrent}/${safeTotal}` : String(safeCurrent);
    if (name) {
      this.waveValue.dataset.bossName = name;
      this.waveValue.title = name;
    } else {
      delete this.waveValue.dataset.bossName;
      this.waveValue.removeAttribute('title');
    }
  }

  setTimer(seconds) {
    if (!this.timerValue) return;
    this.timerValue.textContent = formatTime(seconds);
  }

  setIntermission(seconds) {
    if (!this.waveValue) return;
    if (seconds > 0.05) {
      this.waveValue.dataset.intermission = seconds.toFixed(1);
    } else {
      delete this.waveValue.dataset.intermission;
    }
  }

  setStatus(text) {
    if (!this.statusValue) return;
    this.statusValue.textContent = text || '';
  }

  flagPerfectWave() {
    if (!this.waveValue) return;
    this.waveValue.classList.add('is-perfect');
    if (this.perfectTimer) {
      clearTimeout(this.perfectTimer);
    }
    this.perfectTimer = setTimeout(() => {
      this.waveValue?.classList.remove('is-perfect');
      this.perfectTimer = null;
    }, 1200);
  }

  showRunComplete(durationSeconds, perfectCount) {
    const timeText = formatTime(durationSeconds);
    const summary = perfectCount > 0
      ? `${timeText} • ${perfectCount} perfect`
      : timeText;
    this.setStatus(`Boss rush complete (${summary})`);
  }
}

export { formatTime };
