import { loadStyle } from '../utils.js';

export default function(outlet){
  loadStyle('styles/pages/not-found.css');
  outlet.innerHTML = '<h2>404</h2><p>Page not found.</p>';
}
