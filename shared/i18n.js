const dictionaries = {
  en: {
    siteTitle: 'Arcade Hub',
    navStats: '📈 Stats',
    navQuests: '🗺️ Quests',
    navCabinet: '🕹️ Cabinet',
    recentlyPlayed: 'Recently Played',
    allGames: 'All Games',
    searchPlaceholder: 'Search games...',
    emptyState: "Couldn't load games.json or it's empty.",
    footerIndex: 'Hub • Data from games.json • Offline via sw.js',
    back: '← Back',
    description: 'Description',
    instructions: 'Instructions',
    controls: 'Controls',
    localLeaderboard: 'Local Leaderboard',
    relatedGames: 'Related Games',
    footerGame: 'Game details • Data from games.json',
    missingSlug: 'Missing slug.',
    gameNotFound: 'Game not found.',
    noDetailedInstructions: 'No detailed instructions.',
    unknown: 'Unknown',
    noScoresYet: 'No scores yet.',
    best: 'Best:',
    bestScore: 'Best score:',
    play: '▶️ Play',
    new: 'NEW',
    unlockByPlayingMore: 'Unlock by playing more',
    lockedPlayMore: 'Locked. Play more games to unlock!',
    paused: 'Paused',
    resume: 'Resume',
    restart: 'Restart',
    backToHub: '← Back to Hub',
    achievementsTitle: 'Achievements',
    questsTitle: 'Quests',
    cabinetTitle: "Cabinet Mode",
    statsTitle: '📈 Stats Dashboard',
    dailyQuests: 'Daily Quests',
    weeklyQuests: 'Weekly Quests',
    totalXP: 'Total XP:',
    cabinetMode: 'Cabinet Mode',
    fullscreen: '⛶ Fullscreen',
    start: '▶️ Start',
    stop: '⏸️ Stop',
    timeByGame: 'Time Played by Game',
    playsByDay: 'Plays per Day (last 14)',
    totalPlays: 'Total Plays',
    minutes: 'Minutes',
    plays: 'Plays',
    themeNeon: 'Neon',
    themeRetro: 'Retro',
    themeMinimal: 'Minimal',
    genericGame: 'Game',
    xp: 'XP'
  },
  es: {
    siteTitle: 'Centro Arcade',
    navStats: '📈 Estadísticas',
    navQuests: '🗺️ Misiones',
    navCabinet: '🕹️ Gabinete',
    recentlyPlayed: 'Jugado Recientemente',
    allGames: 'Todos los Juegos',
    searchPlaceholder: 'Buscar juegos...',
    emptyState: 'No se pudo cargar games.json o está vacío.',
    footerIndex: 'Centro • Datos de games.json • Offline via sw.js',
    back: '← Volver',
    description: 'Descripción',
    instructions: 'Instrucciones',
    controls: 'Controles',
    localLeaderboard: 'Tabla Local',
    relatedGames: 'Juegos Relacionados',
    footerGame: 'Detalles del juego • Datos de games.json',
    missingSlug: 'Falta slug.',
    gameNotFound: 'Juego no encontrado.',
    noDetailedInstructions: 'No hay instrucciones detalladas.',
    unknown: 'Desconocido',
    noScoresYet: 'Sin puntuaciones.',
    best: 'Mejor:',
    bestScore: 'Mejor puntuación:',
    play: '▶️ Jugar',
    new: 'NUEVO',
    unlockByPlayingMore: 'Desbloquea jugando más',
    lockedPlayMore: 'Bloqueado. ¡Juega más para desbloquear!',
    paused: 'Pausado',
    resume: 'Continuar',
    restart: 'Reiniciar',
    backToHub: '← Volver al Hub',
    achievementsTitle: 'Logros',
    questsTitle: 'Misiones',
    cabinetTitle: 'Modo Gabinete',
    statsTitle: '📈 Panel de Estadísticas',
    dailyQuests: 'Misiones Diarias',
    weeklyQuests: 'Misiones Semanales',
    totalXP: 'XP Total:',
    cabinetMode: 'Modo Gabinete',
    fullscreen: '⛶ Pantalla completa',
    start: '▶️ Iniciar',
    stop: '⏸️ Detener',
    timeByGame: 'Tiempo Jugado por Juego',
    playsByDay: 'Partidas por Día (últimos 14)',
    totalPlays: 'Partidas Totales',
    minutes: 'Minutos',
    plays: 'Partidas',
    themeNeon: 'Neón',
    themeRetro: 'Retro',
    themeMinimal: 'Minimal',
    genericGame: 'Juego',
    xp: 'XP'
  }
};

const defaultLang = 'en';

export function getLang() {
  try {
    return localStorage.getItem('lang') || defaultLang;
  } catch {
    return defaultLang;
  }
}

export function t(key) {
  const lang = getLang();
  return dictionaries[lang]?.[key] ?? dictionaries[defaultLang]?.[key] ?? key;
}

export function translatePage(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    const val = t(key);
    if (attr) el.setAttribute(attr, val);
    else el.textContent = val;
  });
}

export function initI18n() {
  translatePage();
  document.documentElement.lang = getLang();
  let sel = document.getElementById('langSelect');
  if (!sel) {
    sel = document.createElement('select');
    sel.id = 'langSelect';
    sel.innerHTML = `<option value="en">EN</option><option value="es">ES</option>`;
    sel.style.position = 'fixed';
    sel.style.top = '10px';
    sel.style.right = '10px';
    document.body.appendChild(sel);
  }
  sel.value = getLang();
  sel.addEventListener('change', () => {
    try { localStorage.setItem('lang', sel.value); } catch {}
    document.documentElement.lang = getLang();
    translatePage();
  });
}

export { dictionaries };
