<p align="center">
  <img src="https://github.com/koonergurjot/Gurjots-Games/raw/main/assets/gurjots-games-banner.png" alt="Gurjot's Games Banner" width="900" height="200">
</p>

<h1 align="center">🎉 Gurjot's Games 🎮</h1>

<p align="center">
  <i>The most fun, accessible, and creative gaming hub on GitHub!</i>
</p>

<p align="center">
  <img src="https://img.shields.io/github/languages/top/koonergurjot/Gurjots-Games?style=for-the-badge&color=brightgreen" alt="Top Language">
  <img src="https://img.shields.io/github/languages/count/koonergurjot/Gurjots-Games?style=for-the-badge&color=blue" alt="Languages Count">
  <img src="https://img.shields.io/github/contributors/koonergurjot/Gurjots-Games?style=for-the-badge&color=orange" alt="Contributors">
  <img src="https://img.shields.io/github/commit-activity/m/koonergurjot/Gurjots-Games?style=for-the-badge&color=yellow" alt="Commit Activity">
  <img src="https://img.shields.io/github/repo-size/koonergurjot/Gurjots-Games?style=for-the-badge&color=purple" alt="Repo Size">
  <img src="https://img.shields.io/github/issues/koonergurjot/Gurjots-Games?style=for-the-badge&color=pink" alt="Issues">
  <img src="https://img.shields.io/github/license/koonergurjot/Gurjots-Games?style=for-the-badge&color=red" alt="License">
</p>

---

> ✨ **Welcome!**  
> Whether you're a gamer, developer, or just curious, Gurjot's Games is your playground. Discover, play, and contribute to a growing library of HTML5 games built for fun and creativity!  
> *Be part of the community—help create, test, and share games with everyone!*

---

## 📊 Language Usage

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-80%25-yellow?style=flat-square">
  <img src="https://img.shields.io/badge/HTML-15%25-orange?style=flat-square">
  <img src="https://img.shields.io/badge/CSS-5%25-blue?style=flat-square">
  <br>
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=koonergurjot&repo=Gurjots-Games&layout=compact&theme=tokyonight" alt="Language Graph"/>
</p>

---

## 🚦 Repo Activity & Traffic

<p align="center">
  <img src="https://github-readme-activity-graph.vercel.app/graph?username=koonergurjot&repo=Gurjots-Games&theme=react-dark" alt="Contribution Graph"/>
</p>

---

## 🧑‍💻 Contributors

<p align="center">
  <a href="https://github.com/koonergurjot/Gurjots-Games/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=koonergurjot/Gurjots-Games" alt="Contributors"/>
  </a>
</p>

---

## 🕹️ Featured Games

<table>
  <tr>
    <td align="center">
      <img src="https://via.placeholder.com/120x60?text=Platformer" alt="Platformer Demo"/><br>
      <b>Platformer Demo</b>
    </td>
    <td align="center">
      <img src="https://via.placeholder.com/120x60?text=Puzzle" alt="Puzzle Demo"/><br>
      <b>Puzzle Demo</b>
    </td>
    <td align="center">
      <img src="https://via.placeholder.com/120x60?text=Shooter" alt="Shooter Demo"/><br>
      <b>Shooter Demo</b>
    </td>
  </tr>
</table>

---

## 📸 Screenshots & GIFs

<p align="center">
  <img src="https://via.placeholder.com/400x200?text=Platformer+Demo" alt="Platformer Screenshot"/>
  <img src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2k0ODRsaGQ1cGd0YjM4bTZudGZ4a3FqMnkxM2Ftdzg2eWZyM2x2eSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/giphy.gif" alt="Gameplay GIF" width="400"/>
</p>

---

## 🌈 Key Features

- 🎨 **Colourful, Responsive UI** — Looks great on desktop and mobile!
- 🕹️ **Curated Game Library** — Play dozens of HTML5 games.
- 🛠️ **Developer Friendly** — Easy to add your own games.
- 🏆 **Achievements & Leaderboards** — Compete for high scores!
- 🔒 **Safe and Secure** — Privacy-focused, no tracking.
- 🌐 **Offline Support** — Play games even without internet!
- ♿ **Accessibility First** — Keyboard navigation, screen reader support.

---

## 🚀 Get Started

```bash
git clone https://github.com/koonergurjot/Gurjots-Games.git
dcd Gurjots-Games
npm install
npx serve .
```
Visit [localhost:3000](http://localhost:3000) to play!

---

## 💡 How to Add Your Game

1. Fork this repo.
2. Add your game to the `/games` folder.
3. Update the game catalog.
4. Submit a pull request!
5. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## 🏆 Community Highlights

> **"The best gaming hub for learning and fun!"**  
> *– Happy Contributor*

> **"Adding my own game was super easy!"**  
> *– New Developer*

---

## 📖 Documentation & Help

- [Getting Started Guide](#-get-started)
- [Game Loader Diagnostics](games/common/diagnostics/README.md)
- [Contributing Guide](CONTRIBUTING.md)
- [FAQ](#-faq)

### 🩺 Game Doctor Manifest

The automated health check looks for extra assets defined in
`tools/reporters/game-doctor-manifest.json`. Each game slug can list
required files (via the `paths` array) and file patterns (via the `globs`
array). All values are resolved relative to the folder that contains the
playable shell (`index.html`).

```json
{
  "requirements": {
    "pong": {
      "paths": ["manifest.json", "pong.css"],
      "globs": ["*.js"]
    }
  }
}
```

To add new asset requirements:

1. Identify the slug and shell folder for the game you are updating.
2. Add (or update) the corresponding entry in the manifest with the files
   or glob patterns that must exist beside the shell.
3. Keep requirements in arrays of strings—invalid entries will be treated
   as manifest errors during the health check.
4. Run `node tools/game-doctor.mjs` (or `npm run doctor`) to confirm the
   manifest changes pass.

---

## ❓ FAQ

**Q:** How do I play games offline?  
**A:** Visit once online to cache core assets, then you’re set!

**Q:** How do I submit a game?  
**A:** Fork, add your game, and submit a PR (see above).

**Q:** Who can contribute?  
**A:** Anyone!

**Q:** What if I find a bug?  
**A:** File an issue or email me!

---

## 🛡️ Security

If you discover a vulnerability, please see [SECURITY.md](SECURITY.md).

---

## 📄 License

This project is [MIT licensed](LICENSE), open for all!

---

<p align="center">
  <img src="https://img.shields.io/github/stars/koonergurjot/Gurjots-Games?style=social" alt="GitHub Stars"/> &nbsp;
  <img src="https://img.shields.io/github/watchers/koonergurjot/Gurjots-Games?style=social" alt="GitHub Watchers"/>
</p>

---

<p align="center">
  <b>🌟 Star this repo and join the fun! 🌟</b>
</p>
