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

    const play = document.createElement("a");
    play.href = game.path;
    play.className = "btn primary";
    play.textContent = "Play";
    play.setAttribute("rel","noopener");
    actions.appendChild(play);

    const open = document.createElement("a");
    open.href = game.path;
    open.className = "btn";
    open.textContent = "Open in Tab";
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
