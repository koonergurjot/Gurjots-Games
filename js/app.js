// ====== Gurjot's Games — app.js ======
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

const defaultGames = [
  {
    id: "pong",
    title: "Pong Classic",
    path: "games/pong/index.html",
    desc: "A snappy canvas remake of the arcade legend.",
    tags: ["classic","2D"],
    new: false,
    emoji: "🏓",
    addedAt: "2025-08-20"
  },
  {
    id: "snake",
    title: "Snake",
    path: "games/snake/index.html",
    desc: "Eat, grow, don't bonk into yourself.",
    tags: ["classic","2D"],
    new: true,
    emoji: "🐍",
    addedAt: "2025-08-25"
  },
  {
    id: "box3d",
    title: "3D Box Playground",
    path: "games/box-playground/index.html",
    desc: "A tiny Three.js scene—rotate and vibe.",
    tags: ["3D","demo"],
    new: false,
    emoji: "🧊",
    addedAt: "2025-08-15"
  }
];


// ===== Enhancements: particle bg, modal player, XP/badges, share =====
function particleBG() {
  const cvs = document.createElement('canvas');
  cvs.id = 'bgParticles';
  Object.assign(cvs.style, {
    position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none'
  });
  document.body.prepend(cvs);
  const ctx = cvs.getContext('2d');
  let w, h, dpr;
  let dots = [];

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = cvs.width = innerWidth * dpr;
    h = cvs.height = innerHeight * dpr;
    cvs.style.width = innerWidth + 'px';
    cvs.style.height = innerHeight + 'px';
    dots = new Array(80).fill(0).map(()=> ({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-.5)*0.4*dpr, vy: (Math.random()-.5)*0.4*dpr,
      r: (0.6 + Math.random()*1.6) * dpr
    }));
  }
  resize(); addEventListener('resize', resize);

  function draw() {
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    dots.forEach(p=>{
      p.x += p.vx; p.y += p.vy;
      if (p.x<0||p.x>w) p.vx*=-1;
      if (p.y<0||p.y>h) p.vy*=-1;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// Simple XP system
const xpKey = "gg:xp";
function addXP(amount=5) {
  const data = JSON.parse(localStorage.getItem(xpKey) || '{"xp":0,"plays":0}');
  data.xp += amount;
  data.plays += 1;
  localStorage.setItem(xpKey, JSON.stringify(data));
}
function getXP() {
  return JSON.parse(localStorage.getItem(xpKey) || '{"xp":0,"plays":0}');
}
function xpBadge() {
  const {xp, plays} = getXP();
  const b = document.createElement('div');
  b.className = 'status info';
  b.style.margin = '6px 0 0';
  b.textContent = `Your XP: ${xp} • Plays: ${plays}`;
  return b;
}

// Modal player to validate game path before loading
function ensureModal() {
  if ($('#playerModal')) return $('#playerModal');
  const wrap = document.createElement('div');
  wrap.id = 'playerModal';
  Object.assign(wrap.style, {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    display: 'none', alignItems: 'center', justifyContent: 'center', zIndex: 100
  });
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: 'min(1000px, 94vw)', height: 'min(720px, 84vh)',
    borderRadius: '16px', overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'var(--bg-soft)', position: 'relative', boxShadow: 'var(--shadow)'
  });
  const close = document.createElement('button');
  close.textContent = '✕';
  Object.assign(close.style, {
    position: 'absolute', top: '8px', right: '8px', zIndex: 2,
    background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--card-border)',
    borderRadius: '10px', padding: '6px 10px', cursor: 'pointer'
  });
  const frame = document.createElement('iframe');
  Object.assign(frame, { id: 'playerFrame' });
  Object.assign(frame.style, { width: '100%', height: '100%', border: '0' });
  close.onclick = () => { wrap.style.display = 'none'; frame.src = 'about:blank'; }
  inner.appendChild(close); inner.appendChild(frame);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);
  return wrap;
}

async function playInModal(url, gameId) {
  const modal = ensureModal();
  const frame = $('#playerFrame', modal);
  // Validate the file exists
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error('Missing');
    modal.style.display = 'flex';
    frame.src = url;
    addXP(5);
  } catch {
    alert('Game not found. It may be missing or the path is wrong.');
  }
}

// Share helper
async function shareGame(game) {
  const url = new URL(location.href);
  url.hash = game.id;
  const shareData = { title: game.title, text: `Play ${game.title} on Gurjot's Games`, url: url.toString() };
  try {
    if (navigator.share) { await navigator.share(shareData); }
    else { await navigator.clipboard.writeText(shareData.url); alert('Link copied to clipboard!'); }
  } catch {}
}

const state = {
  games: [],
  tags: new Set(),
  activeTag: null,
  search: "",
  sort: "az"
};

function setTheme(name) {
  document.body.classList.remove("theme-retro","theme-neon","theme-minimal");
  if (name === "retro") document.body.classList.add("theme-retro");
  if (name === "neon") document.body.classList.add("theme-neon");
  if (name === "minimal") document.body.classList.add("theme-minimal");
  localStorage.setItem("gg:theme", name);
}

function hydrateUI() {
  $("#year").textContent = new Date().getFullYear();
  const saved = localStorage.getItem("gg:theme") || "default";
  $("#theme").value = saved;
  setTheme(saved);

  $("#theme").addEventListener("change", e => setTheme(e.target.value));
  $("#search").addEventListener("input", e => {
    state.search = e.target.value.toLowerCase().trim();
    render();
  });
  $("#sort").addEventListener("change", e => {
    state.sort = e.target.value;
    render();
  });
}

function buildTagChips() {
  const wrap = $("#tagChips");
  wrap.innerHTML = "";
  const all = document.createElement("button");
  all.className = "chip" + (state.activeTag ? "" : " active");
  all.textContent = "All";
  all.onclick = () => { state.activeTag = null; render(); };
  wrap.appendChild(all);

  [...state.tags].sort().forEach(tag => {
    const b = document.createElement("button");
    b.className = "chip" + (state.activeTag === tag ? " active" : "");
    b.textContent = tag;
    b.onclick = () => { state.activeTag = (state.activeTag === tag ? null : tag); render(); };
    wrap.appendChild(b);
  });
}

function skeletonCards(n=6) {
  const grid = $("#gamesGrid");
  grid.innerHTML = "";
  for (let i=0;i<n;i++) {
    const card = document.createElement("article");
    card.className = "card";
    const thumb = document.createElement("div");
    thumb.className = "thumb skeleton";
    card.appendChild(thumb);
    const title = document.createElement("div");
    title.className = "skeleton";
    title.style.cssText = "height:18px;width:60%;margin:10px 0 8px;border-radius:6px;";
    card.appendChild(title);
    const line = document.createElement("div");
    line.className = "skeleton";
    line.style.cssText = "height:14px;width:90%;border-radius:6px;";
    card.appendChild(line);
    grid.appendChild(card);
  }
}

function render() {
  const grid = $("#gamesGrid");
  const status = $("#status");

  let list = [...state.games];

  // Filters
  if (state.activeTag) {
    list = list.filter(g => g.tags.includes(state.activeTag));
  }
  if (state.search) {
    list = list.filter(g => (g.title.toLowerCase().includes(state.search) || g.desc.toLowerCase().includes(state.search)));
  }

  // Sort
  if (state.sort === "az") list.sort((a,b)=>a.title.localeCompare(b.title));
  if (state.sort === "za") list.sort((a,b)=>b.title.localeCompare(a.title));
  if (state.sort === "new") list.sort((a,b)=> new Date(b.addedAt) - new Date(a.addedAt));

  status.textContent = list.length ? `${list.length} game${list.length>1?"s":""} ready to play` : "No matches. Try a different search or tag.";
  grid.innerHTML = "";

  list.forEach(game => {
    const card = document.createElement("article");
    card.className = "card";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = game.new ? "NEW" : "PLAY";
    card.appendChild(badge);

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.textContent = game.emoji || "🎮";
    card.appendChild(thumb);

    const h3 = document.createElement("h3");
    h3.textContent = game.title;
    card.appendChild(h3);

    const p = document.createElement("p");
    p.textContent = game.desc;
    card.appendChild(p);

    const actions = document.createElement("div");
    actions.className = "actions";

    const play = document.createElement("button");
    play.className = "btn primary";
    play.textContent = "Play";
    play.onclick = () => playInModal(game.path, game.id);
    actions.appendChild(play);

    const share = document.createElement("button");
    share.className = "btn";
    share.textContent = "Share";
    share.onclick = () => shareGame(game);
    actions.appendChild(share);

    const open = document.createElement("a");
    open.href = game.path;
    open.className = "btn";
    open.textContent = "Open Tab";
    open.target = "_blank";
    open.setAttribute("rel","noopener");
    actions.appendChild(open);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

async function loadGames() {
  skeletonCards();
  try {
    const res = await fetch("./games.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch games.json");
    const data = await res.json();
    // Validate minimal shape
    if (!Array.isArray(data) || !data.length) throw new Error("Empty games.json");
    state.games = data;
  } catch (err) {
    console.warn("[games] Falling back to default list:", err.message);
    $("#status").classList.add("info");
    state.games = defaultGames;
  }
  // collect tags
  state.tags = new Set(state.games.flatMap(g => g.tags || []));
  buildTagChips();
  render();
}

hydrateUI();
loadGames();

// Boot extras
document.addEventListener('DOMContentLoaded', ()=>{
  particleBG();
  const status = document.getElementById('status');
  status.parentElement.insertBefore(xpBadge(), status.nextSibling);
});
