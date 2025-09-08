export function initLastMove(scene, helpers, THREE) {
  const group = new THREE.Group();
  scene.add(group);
  let arrow = null;

  function clear() {
    if (arrow) {
      group.remove(arrow);
      arrow = null;
    }
  }

  function show(from, to) {
    clear();
    if (!from || !to) return;
    const fromPos = helpers.squareToPosition(from);
    const toPos = helpers.squareToPosition(to);
    if (!fromPos || !toPos) return;
    const start = new THREE.Vector3(fromPos.x, 0.05, fromPos.z);
    const end = new THREE.Vector3(toPos.x, 0.05, toPos.z);
    const dir = end.clone().sub(start);
    const len = dir.length();
    arrow = new THREE.ArrowHelper(dir.clone().normalize(), start, len, 0xffff00);
    arrow.line.material.transparent = true;
    arrow.line.material.opacity = 0.5;
    arrow.cone.material.transparent = true;
    arrow.cone.material.opacity = 0.5;
    group.add(arrow);
  }

  return { show, clear };
}
