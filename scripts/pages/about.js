import { loadStyle } from '../utils.js';

export default function(outlet){
  loadStyle('styles/pages/about.css');
  outlet.innerHTML = '<h2>About</h2><p>Learn more about the project on <a href="https://github.com/koonergurjot/Gurjots-Games/blob/main/README.md" target="_blank" rel="noopener noreferrer">GitHub</a>.</p>';
}
