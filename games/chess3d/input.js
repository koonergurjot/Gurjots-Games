/**
 * Handles tile picking and move input. Highlights legal targets using the
 * provided rulesApi.
 */
function _mountInput({ THREE, scene, camera, renderer, controls, boardHelpers, rulesApi, onMove }) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let selectedSquare = null;
  const markers = [];
  let hoverMesh = null;
  let rendererRef = renderer;
  let controlsRef = controls;
  const canvas = rendererRef?.domElement || null;

  function clearMarkers() {
    while (markers.length) {
      scene.remove(markers.pop());
    }
  }

  function showTargets(from, moves) {
    clearMarkers();
    const geom = new THREE.CircleGeometry(boardHelpers.tileSize * 0.4, 24);
    const matFrom = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: false,
    });
    const matTo = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      depthTest: false,
    });
    const posFrom = boardHelpers.squareToPosition(from);
    const sel = new THREE.Mesh(geom, matFrom);
    sel.rotation.x = -Math.PI / 2;
    sel.position.set(posFrom.x, posFrom.y + 0.01, posFrom.z);
    scene.add(sel);
    markers.push(sel);
    moves.forEach((m) => {
      const pos = boardHelpers.squareToPosition(m.to);
      const mesh = new THREE.Mesh(geom, matTo);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, pos.y + 0.01, pos.z);
      scene.add(mesh);
      markers.push(mesh);
    });
  }

  function onPointer(e) {
    if (!rendererRef?.domElement) return;
    const rect = rendererRef.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const tile = intersects.find((i) => i.object.userData && i.object.userData.square);
    if (!tile) return;

    const sq = tile.object.userData.square;
    if (!selectedSquare) {
      const legal = (rulesApi.getLegalMoves && rulesApi.getLegalMoves(sq)) || [];
      if (legal.length) {
        selectedSquare = sq;
        showTargets(sq, legal);
      }
    } else {
      const legal = (rulesApi.getLegalMoves && rulesApi.getLegalMoves(selectedSquare)) || [];
      const ok = legal.some((m) => m.to === sq);
      if (ok && onMove) onMove({ from: selectedSquare, to: sq });
      selectedSquare = null;
      clearMarkers();
    }
  }

  const onPointerDown = () => {
    if (controlsRef) controlsRef.enabled = false;
  };
  const onPointerMove = (e) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const tile = intersects.find((i) => i.object.userData && i.object.userData.square);
    if (tile){
      const pos = boardHelpers.squareToPosition(tile.object.userData.square);
      if (!hoverMesh){
        const g = new THREE.RingGeometry(boardHelpers.tileSize*0.45, boardHelpers.tileSize*0.49, 24);
        const m = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent:true, opacity:0.45, depthWrite:false, depthTest:false });
        hoverMesh = new THREE.Mesh(g,m); hoverMesh.rotation.x = -Math.PI/2; scene.add(hoverMesh);
      }
      hoverMesh.position.set(pos.x, pos.y + 0.02, pos.z);
    }else if (hoverMesh){
      scene.remove(hoverMesh); hoverMesh = null;
    }
  };

  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
  }

  const onWindowPointerEnd = (e) => {
    if (!rendererRef?.domElement) return;
    if (controlsRef) controlsRef.enabled = true;
    onPointer(e);
  };
  const onWindowPointerCancel = () => {
    if (!rendererRef?.domElement) return;
    if (controlsRef) controlsRef.enabled = true;
  };
  // Use window-level listeners so we still receive pointerup/cancel events if the pointer leaves the canvas.
  window.addEventListener('pointerup', onWindowPointerEnd);
  window.addEventListener('pointercancel', onWindowPointerCancel);

  return () => {
    if (canvas) {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
    }
    window.removeEventListener('pointerup', onWindowPointerEnd);
    window.removeEventListener('pointercancel', onWindowPointerCancel);
    rendererRef = null;
    controlsRef = null;
  };
}

// Patch in promotion handling. When a pawn reaches the last rank we
// request a promotion piece before applying the move with rulesApi.move().
export function mountInputWrapper(opts) {
  const { onMove: origOnMove, rulesApi } = opts;
  return _mountInput({
    ...opts,
    onMove: async ({ from, to }) => {
      let promotion;
      const legal = rulesApi?.getLegalMoves?.(from) || [];
      const move = legal.find((m) => m.to === to);
      if (move?.promotion){
        const { openPromotion } = await import('./ui/promotionModal.js');
        promotion = await openPromotion(rulesApi?.turn?.());
      }
      const res = rulesApi.move({ from, to, promotion });
      if (res?.ok && origOnMove) await origOnMove({ from, to, promotion });
    }
  });
}

export { _mountInput };

