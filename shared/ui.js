export function injectBackButton(relativePathToHub = '../../') {
  let link = document.querySelector('.back-to-hub');

  if (!link) {
    link = document.createElement('a');
    link.className = 'back-to-hub';
    link.textContent = '← Back to Hub';
    document.body.appendChild(link);
  }

  link.href = relativePathToHub;

  // Inject styles once
  if (!document.head.querySelector('style[data-back-to-hub]')) {
    const style = document.createElement('style');
    style.dataset.backToHub = 'true';
    style.textContent = `
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
    document.head.appendChild(style);
  }
}
