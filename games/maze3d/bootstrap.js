import '/js/three-global-shim.js';

function isWebGLAvailable() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      (window.WebGL2RenderingContext && canvas.getContext('webgl2')) ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch (err) {
    console.warn('maze3d: webgl availability check failed', err);
    return false;
  }
}

async function startFallback(reason) {
  const module = await import('./topdown.js');
  await module.startTopDownFallback({ reason });
}

(async function bootstrap() {
  if (isWebGLAvailable()) {
    try {
      await import('./main-3d.js');
      return;
    } catch (err) {
      console.error('maze3d: failed to start 3D renderer, falling back to canvas', err);
      await startFallback(err);
      return;
    }
  }
  await startFallback(new Error('WebGL not available'));
})();
