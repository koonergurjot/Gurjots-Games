
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
