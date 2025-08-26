export function initMediaPreviews(selector = '[data-preview]') {
  const els = document.querySelectorAll(selector);
  if (!els.length) return;

  const setup = el => {
    let vid;
    el.addEventListener('mouseenter', () => {
      if (vid || !el.dataset.preview) return;
      vid = document.createElement('video');
      vid.src = el.dataset.preview;
      vid.preload = 'metadata';
      vid.muted = true;
      vid.playsInline = true;
      vid.autoplay = true;
      vid.loop = true;
      const img = el.querySelector('img');
      if (img) img.hidden = true;
      el.appendChild(vid);
    });
    el.addEventListener('mouseleave', () => {
      if (!vid) return;
      vid.remove();
      const img = el.querySelector('img');
      if (img) img.hidden = false;
      vid = null;
    });
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setup(entry.target);
          io.unobserve(entry.target);
        }
      }
    });
    els.forEach(el => io.observe(el));
  } else {
    els.forEach(setup);
  }
}
