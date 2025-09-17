import { loadStyle } from '../utils.js';

export default function(outlet){
  loadStyle('styles/pages/leaderboards.css');
  outlet.innerHTML = '<h2>Leaderboards</h2><p>Coming soon...</p>';
}
