export function injectBackButton(relativePathToHub = '../../') {
  const link = document.querySelector('.back-to-hub');
  const style = document.head.querySelector('style[data-back-to-hub]');

  if (link && style) {
    link.href = relativePathToHub;
    return;
  }

  let backLink = link;
  if (!backLink) {
    backLink = document.createElement('a');
    backLink.className = 'back-to-hub';
    backLink.textContent = '← Back to Hub';
    document.body.appendChild(backLink);
  }

  backLink.href = relativePathToHub;

  if (!style) {
    const styleTag = document.createElement('style');
    styleTag.dataset.backToHub = 'true';
    styleTag.textContent = `
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
    document.head.appendChild(styleTag);
  }
}
