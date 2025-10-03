# 🎮 Gurjot's Games

[![Build Status](https://github.com/koonergurjot/Gurjots-Games/actions/workflows/ci.yml/badge.svg)](https://github.com/koonergurjot/Gurjots-Games/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/koonergurjot/Gurjots-Games)](https://codecov.io/gh/koonergurjot/Gurjots-Games)
[![License](https://img.shields.io/badge/license-not--specified-lightgrey)](#-license)

**Gurjot's Games** is a web‑based gaming hub featuring a curated collection of accessible HTML5 games you can play right in your browser. Designed for desktop and mobile, the project powers a responsive site supporting offline play, diagnostics, and developer contributions.

---

## Table of Contents

- [🎯 Project Goal](#-project-goal)
- [✨ Features](#-features)
- [🕹️ Available Games](#-available-games)
- [📸 Screenshots](#-screenshots)
- [🔧 Technologies Used](#-technologies-used)
- [📶 Offline Support](#-offline-support)
- [🚀 Getting Started](#-getting-started)
- [🧪 Testing](#-testing)
- [🧹 Debloat](#-debloat)
- [➕ Adding a New Game](#-adding-a-new-game)
- [♿ Accessibility](#-accessibility)
- [❓ FAQ](#-faq)
- [🤝 Contributing](#-contributing)
- [🙌 Credits](#-credits)
- [🔒 Security](#-security)
- [📄 License](#-license)

---

## 🎯 Project Goal

Build a friendly, open playground for accessible HTML5 games. We provide reusable tools and a welcoming space to spark creativity and help developers share their work with the world.

---

## ✨ Features

- **Curated Game Library:** Browse and launch games from a unified interface.
- **Recently Played Shortcuts:** Quickly access your favorites from stored history.
- **Game Loader with Diagnostics:** Boots each game and surfaces clear error messages.
- **Service Worker Caching:** Enables offline support for assets and shell pages.
- **Accessible Design:** Semantic HTML, ARIA labels, and responsive layouts.
- **Easy Contribution:** Add your own games with minimal setup and clear guidelines.

---

## 🕹️ Available Games

| Name             | Genre     | Status    | Link                        | Preview          |
|------------------|-----------|-----------|-----------------------------|------------------|
| Platformer Demo  | Platform  | Complete  | [Play](./games/platformer)  | ![Platformer demo](https://via.placeholder.com/120x60?text=Platformer) |
| Puzzle Demo      | Puzzle    | Beta      | [Play](./games/puzzle-demo) | ![Puzzle demo](https://via.placeholder.com/120x60?text=Puzzle)         |

*Replace links and images with real games as available.*

---

## 📸 Screenshots

Add actual gameplay screenshots here for a visual overview.

![Platformer demo](https://via.placeholder.com/400x200?text=Platformer+Demo)
![Puzzle demo](https://via.placeholder.com/400x200?text=Puzzle+Demo)

---

## 🔧 Technologies Used

- **HTML5 / CSS3 / JS (ES6+)**
- **Service Worker API**
- **Node.js & npm**
- **Vitest** (Testing)
- **JSDOM** (Game simulation in tests)
- **Accessibility:** ARIA labels, semantic markup

---

## 📶 Offline Support

Service workers cache core shell pages, styles, helper scripts, and game assets for offline browsing. Network failures fall back to cached responses, so games previously played can launch even while offline. Predictive warmup pre-caches likely-next games as you explore the catalog for faster loading.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 16 or later
- npm 8 or later

### Installation

```bash
git clone https://github.com/koonergurjot/Gurjots-Games.git
cd Gurjots-Games
npm install
```

### Running Locally

```bash
npx serve .
```
Open `http://localhost:3000` in your browser.

---

## 🧪 Testing

Run health checks and unit tests:

```bash
npm test
```

*Resources:*
- [Node.js Docs](https://nodejs.org/en/docs/)
- [MDN Web Docs](https://developer.mozilla.org/)

---

## 🧹 Debloat

Helper scripts refresh `debloat-report.json` and surface files that are safe to prune. By default, scripts run in dry-run mode.

- **Bash**
  ```bash
  bash tools/apply-debloat.sh
  ```
- **PowerShell**
  ```powershell
  .\tools\apply-debloat.ps1
  ```

To actually remove files listed, pass the apply flag:

- **Bash**
  ```bash
  bash tools/apply-debloat.sh --apply
  ```
- **PowerShell**
  ```powershell
  .\tools\apply-debloat.ps1 -Apply
  ```

---

## ➕ Adding a New Game

1. Fork this repository.
2. Add your game's source under `games/{your-game}`.
3. Register your game in the site catalog (see the contributing guide).
4. Ensure your game supports the diagnostics overlay (see [games/common/diagnostics/README.md](games/common/diagnostics/README.md)).
5. Submit a pull request, following the [CONTRIBUTING.md](CONTRIBUTING.md) guidelines.

---

## ♿ Accessibility

We are committed to making Gurjot's Games inclusive for everyone. The site uses semantic HTML, ARIA roles, and color-contrast-compliant themes. Keyboard navigation and screen reader support are prioritized.

---

## ❓ FAQ

**Q:** Why isn’t my game loading?
**A:** Ensure your assets are registered in the precache manifest and your game follows the loader contract.

**Q:** How do I contribute a new game?
**A:** See [Adding a New Game](#-adding-a-new-game) above and [CONTRIBUTING.md](CONTRIBUTING.md).

**Q:** How do I report bugs?
**A:** Open an issue or contact the project maintainer.

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and adhere to the [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## 🙌 Credits

- Thanks to contributors, testers, and the open source community.
- Inspired by projects such as [itch.io](https://itch.io/) and [js13kGames](https://js13kgames.com/).

---

## 🔒 Security

If you discover a vulnerability, please follow the instructions in [SECURITY.md](SECURITY.md).

---

## 📄 License

This repository does not currently specify a license. Contact the project maintainer for usage permissions. For open source licensing, consider adding an OSI-approved license (MIT, Apache 2.0, etc.) to allow community use and contributions.

---