// shared/game-boot.js
// Usage in a game page: <script type="module" src="../../shared/game-boot.js" data-slug="runner"></script>
import { injectBackButton, recordLastPlayed } from './ui.js';
import { beginPlaySession, endPlaySession } from './xp.js';

const currentScript = document.currentScript;
const slug = currentScript?.dataset?.slug || (new URL(location.href)).pathname.split('/').filter(Boolean).slice(-1)[0] || 'unknown';

injectBackButton('/');
recordLastPlayed(slug);
beginPlaySession(slug);
window.addEventListener('beforeunload', () => endPlaySession(slug));
