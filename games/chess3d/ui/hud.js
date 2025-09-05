
export function mountHUD({ onNew, onFlip, onCoords }){
  const hud = document.getElementById('hud');
  hud.innerHTML = '';

  const btnNew = document.createElement('button');
  btnNew.textContent = 'New Game';
  btnNew.onclick = () => onNew && onNew();

  const btnFlip = document.createElement('button');
  btnFlip.textContent = 'Flip Board';
  btnFlip.onclick = () => onFlip && onFlip();

  const btnCoords = document.createElement('button');
  btnCoords.textContent = 'Coords';
  let show = false;
  btnCoords.onclick = () => {
    show = !show;
    btnCoords.style.opacity = show ? '1' : '0.8';
    onCoords && onCoords(show);
  };

  hud.appendChild(btnNew);
  hud.appendChild(btnFlip);
  hud.appendChild(btnCoords);
}
