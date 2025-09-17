import { loadStyle } from '../utils.js';

export default function(outlet){
  loadStyle('styles/pages/about.css');
  outlet.innerHTML = '<h2>About</h2><p>Learn more about the project on <a href="README.md">GitHub</a>.</p>';
}
