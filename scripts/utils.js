export function loadStyle(href){
  if(!document.querySelector(`link[href="${href}"]`)){
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
}
