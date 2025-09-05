const coords = [];
let visible = true;

function createLabel(text, styles) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.position = 'absolute';
  el.style.fontSize = '12px';
  el.style.color = '#fff';
  el.style.pointerEvents = 'none';
  for (const key in styles) el.style[key] = styles[key];
  return el;
}

export function initCoords(container) {
  const letters = 'ABCDEFGH';
  for (let i = 0; i < 8; i++) {
    const left = `${((i + 0.5) / 8) * 100}%`;
    const bottomLabel = createLabel(letters[i], {
      bottom: '2px',
      left,
      transform: 'translateX(-50%)',
    });
    const topLabel = createLabel(letters[i], {
      top: '2px',
      left,
      transform: 'translateX(-50%)',
    });
    container.appendChild(bottomLabel);
    container.appendChild(topLabel);
    coords.push(bottomLabel, topLabel);
  }
  for (let i = 0; i < 8; i++) {
    const bottom = `${(i / 8) * 100}%`;
    const leftLabel = createLabel(String(i + 1), {
      left: '2px',
      bottom,
      transform: 'translateY(50%)',
    });
    const rightLabel = createLabel(String(i + 1), {
      right: '2px',
      bottom,
      transform: 'translateY(50%)',
    });
    container.appendChild(leftLabel);
    container.appendChild(rightLabel);
    coords.push(leftLabel, rightLabel);
  }
  setCoordsVisible(visible);
}

export function setCoordsVisible(v) {
  visible = v;
  coords.forEach(el => {
    el.style.display = v ? 'block' : 'none';
  });
}
