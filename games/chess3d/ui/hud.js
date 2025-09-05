
export function mountHUD({ onNew, onFlip, onCoords }) {
  const hud = document.getElementById('hud');
  hud.innerHTML = '';

  const btnNew = document.createElement('button');
  btnNew.textContent = 'New Game';
  if (onNew) btnNew.onclick = onNew;

  const btnFlip = document.createElement('button');
  btnFlip.textContent = 'Flip Board';
  if (onFlip) btnFlip.onclick = onFlip;

  const btnCoords = document.createElement('button');
  btnCoords.textContent = 'Coords';
  let show = localStorage.getItem('chess3d.coords') !== '0';
  btnCoords.style.opacity = show ? '1' : '0.8';
  btnCoords.onclick = () => {
    show = !show;
    btnCoords.style.opacity = show ? '1' : '0.8';
    if (onCoords) onCoords(show);
  };

  hud.appendChild(btnNew);
  hud.appendChild(btnFlip);
  hud.appendChild(btnCoords);
}

export function addGameButtons({ onResign, onDraw } = {}) {
  const hud = document.getElementById('hud');
  const btnResign = document.createElement('button');
  btnResign.textContent = 'Resign';
  if (onResign) btnResign.onclick = onResign;

  const btnDraw = document.createElement('button');
  btnDraw.textContent = 'Offer Draw';
  btnDraw.onclick = () => {
    if (confirm('Accept draw?')) {
      if (onDraw) onDraw();
    }
  };

  hud.appendChild(btnResign);
  hud.appendChild(btnDraw);
}
