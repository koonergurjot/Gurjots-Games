export function injectBackButton(relativePathToHub = '../../') {
  const style = document.createElement('style');
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

  const link = document.createElement('a');
  link.href = relativePathToHub;
  link.className = 'back-to-hub';
  link.textContent = '← Back to Hub';
  document.body.appendChild(link);
}
