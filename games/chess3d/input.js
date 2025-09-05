
/**
 * Basic picking + move callback. Uses rulesApi to validate legal targets.
 */
export function mountInput({ THREE, scene, camera, renderer, controls, boardHelpers, rulesApi, onMove }){
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let selectedSquare = null;

  renderer.domElement.addEventListener('pointerdown', onPointer);
  renderer.domElement.addEventListener('pointerup', onPointer);

  function onPointer(e){
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
    mouse.y = -(((e.clientY - rect.top)/rect.height)*2 - 1);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const tile = intersects.find(i => i.object.userData && i.object.userData.square);
    if (!tile) return;

    const sq = tile.object.userData.square;
    if (!selectedSquare){
      selectedSquare = sq;
      // TODO: draw highlights for legal moves (future)
    } else {
      if (selectedSquare !== sq){
        const legal = (rulesApi.getLegalMoves && rulesApi.getLegalMoves(selectedSquare)) || [];
        const ok = legal.some(m => m.to === sq);
        if (ok && onMove) onMove({from:selectedSquare, to:sq});
      }
      selectedSquare = null;
    }
  }
}
