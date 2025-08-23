export function injectBackButton(relativePathToHub = '../../') {
  const head = document.head;
  let link = head.querySelector('.back-to-hub');
  const style = head.querySelector('style[data-back-to-hub]');

  if (!link) {
    link = document.body.querySelector('.back-to-hub');
  }

  if (link && style) {
    link.href = relativePathToHub;
    return;
  }

  if (!link) {
    link = document.createElement('a');
    link.className = 'back-to-hub';
    link.textContent = '← Back to Hub';
    document.body.appendChild(link);
  }

  link.href = relativePathToHub;

  if (!style) {
    const styleEl = document.createElement('style');
    styleEl.dataset.backToHub = 'true';
    styleEl.textContent = `
      .back-to-hub {
        position: fixed;
        left: 12px;
        bottom: 12px;
        color: #cfe6ff;
        background: #0e1422;
        border: 1px solid #27314b;
        padding: 8px 10px;
        border-radius: 10px;
        font-weight: 700;
        text-decoration: none;
      }
    `;
    head.appendChild(styleEl);
  }
}
