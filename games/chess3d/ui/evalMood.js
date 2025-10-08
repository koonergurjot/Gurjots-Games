const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalize(evaluation) {
  if (!evaluation) return { score: 0, intensity: 0 };
  if (typeof evaluation.mate === 'number' && evaluation.mate !== 0) {
    return { score: evaluation.mate > 0 ? 1 : -1, intensity: 1, mate: true };
  }
  if (Number.isFinite(evaluation.cp)) {
    const raw = evaluation.cp / 800;
    const score = clamp(raw, -1, 1);
    const intensity = clamp(Math.abs(evaluation.cp) / 700, 0, 1);
    return { score, intensity, mate: false };
  }
  return { score: 0, intensity: 0 };
}

export function mountEvalMood(stageEl, getCamera){
  if (!stageEl) {
    return { update: () => {} };
  }
  const overlay = document.createElement('div');
  overlay.className = 'eval-mood';
  stageEl.appendChild(overlay);

  const resolveCameraSide = () => {
    try {
      const camera = typeof getCamera === 'function' ? getCamera() : null;
      if (camera?.position?.z !== undefined) {
        return camera.position.z < 0 ? 'white' : 'black';
      }
    } catch (_) {}
    return 'black';
  };

  const apply = (evaluation) => {
    const { score, intensity } = normalize(evaluation);
    if (!evaluation || !intensity) {
      overlay.style.opacity = '0';
      overlay.style.background = 'radial-gradient(circle at 50% 80%, rgba(255,220,140,0.35) 0%, rgba(6,10,22,0) 70%)';
      stageEl.style.setProperty('--eval-tilt', '0deg');
      stageEl.style.setProperty('--eval-roll', '0deg');
      stageEl.style.setProperty('--eval-shift', '0px');
      stageEl.style.setProperty('--eval-glow-strength', '0');
      return;
    }
    const sign = score >= 0 ? 1 : -1;
    const sideFacing = resolveCameraSide();
    const focus = sign >= 0
      ? (sideFacing === 'white' ? '82%' : '18%')
      : (sideFacing === 'white' ? '18%' : '82%');
    const hue = sign >= 0 ? 42 : 215;
    const sat = sign >= 0 ? 90 : 84;
    const baseLight = sign >= 0 ? 64 : 60;
    const lightness = clamp(baseLight + intensity * 20 * (sign >= 0 ? 1 : -1), 40, 78);
    const alpha = 0.38 + intensity * 0.32;
    const rimAlpha = 0.25 + intensity * 0.4;
    const baseColor = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
    const rimColor = `hsla(${hue + (sign >= 0 ? -8 : 8)}, ${sat - 12}%, ${Math.max(38, lightness - 10)}%, ${rimAlpha})`;
    overlay.style.background = `radial-gradient(circle at 50% ${focus}, ${baseColor} 0%, ${rimColor} 36%, rgba(8,12,24,0) 72%)`;
    overlay.style.opacity = (0.2 + intensity * 0.55).toFixed(3);
    const tilt = sign * (1.2 + intensity * 3);
    const roll = sign * (0.45 + intensity * 1.2);
    const shift = sign * (sideFacing === 'white' ? -1 : 1) * intensity * 14;
    stageEl.style.setProperty('--eval-tilt', `${tilt.toFixed(2)}deg`);
    stageEl.style.setProperty('--eval-roll', `${roll.toFixed(2)}deg`);
    stageEl.style.setProperty('--eval-shift', `${shift.toFixed(2)}px`);
    stageEl.style.setProperty('--eval-glow-strength', (0.08 + intensity * 0.22).toFixed(3));
  };

  return {
    update: apply
  };
}
