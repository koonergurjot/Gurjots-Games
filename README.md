# 🎮 Gurjot's Games

[![Build Status](https://github.com/USER/Game/actions/workflows/ci.yml/badge.svg)](https://github.com/USER/Game/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/USER/Game)](https://codecov.io/gh/USER/Game)
[![License](https://img.shields.io/badge/license-not--specified-lightgrey)](#-license)

Gurjot's Games is a fun, web‑based gaming hub that lets you discover and play a growing collection of HTML5 games right in your browser. The project powers a responsive website with a curated library of titles, a custom loader, and offline‑friendly caching to keep play sessions smooth and up to date.

## Table of Contents
- [🎯 Project Goal](#-project-goal)
- [✨ Features](#-features)
- [📶 Offline support](#-offline-support)
- [🚀 Getting Started](#-getting-started)
- [🎮 Examples](#-examples)
- [🤝 Contributing](#-contributing)
- [🔒 Security](#-security)
- [📄 License](#-license)

## 🎯 Project Goal

Our mission is to build a friendly, open playground for accessible HTML5 games. By providing reusable tools and a welcoming space, we aim to spark creativity and help developers share their work with players everywhere. Explore the codebase to learn and contribute: [scripts/](scripts/), [shared/](shared/), [tests/](tests/).

## ✨ Features

- **Curated game library** – browse and launch games from a unified interface that works on desktop and mobile.
- **Recently played shortcuts** – the landing page highlights your stored history for quick access to favorite titles.
- **Game loader with diagnostics** – `js/game-loader.js` boots each game and surfaces clear error messages when something goes wrong.
- **Service Worker caching** – a network‑first strategy keeps JavaScript fresh while enabling offline support for assets.
- **Accessible design** – semantic HTML, ARIA labels and responsive layouts provide an inclusive experience.

## 📶 Offline support

The service worker keeps core shell pages, styles and helper scripts ready for offline browsing. During installation it caches
`index.html`, `game.html`, navigation assets, and every entry in the precache manifest so returning visitors can reopen the site
without a connection. When gameplay triggers `cacheGameAssets(slug)`, the worker fetches each file with credentials removed,
deduplicates requests, and stores successful responses for future sessions. Network failures automatically fall back to the
cached response (including the main shell), so both navigating the catalog and launching previously saved games work even while
offline.

## 🚀 Getting Started

### Prerequisites

- Node.js 16 or later
- npm 8 or later

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/USER/Game.git
cd Game
npm install
```

### Running locally

Serve the site with any static server:

```bash
npx serve .
```

Then open `http://localhost:3000` in your browser.

### 🧪 Testing

Run health checks and unit tests:

```bash
npm test
```

Helpful resources: [Node.js Docs](https://nodejs.org/en/docs/), [MDN Web Docs](https://developer.mozilla.org/).

## 🧹 Debloat

The repository includes helper scripts that refresh `debloat-report.json` and surface any files that are safe to prune. Every run regenerates the report before taking action, and the tools default to a dry-run summary so you can review proposed deletions first.

Run the dry-run (default safeguard) mode:

- **Bash**

  ```bash
  bash tools/apply-debloat.sh
  ```

- **PowerShell**

  ```powershell
  .\tools\apply-debloat.ps1
  ```

To actually remove the files listed in the refreshed report, pass the apply flag:

- **Bash**

  ```bash
  bash tools/apply-debloat.sh --apply
  ```

- **PowerShell**

  ```powershell
  .\tools\apply-debloat.ps1 -Apply
  ```

Add `--dry-run` or `-DryRun` if you want to explicitly request the non-destructive mode.

## 🎮 Examples

Showcase games with screenshots or GIFs:

![Platformer demo](https://via.placeholder.com/400x200?text=Platformer+Demo)
![Puzzle demo](https://via.placeholder.com/400x200?text=Puzzle+Demo)

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and adhere to the [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

## 🔒 Security

If you discover a vulnerability, please follow the instructions in [SECURITY.md](SECURITY.md).

## 📄 License

This repository does not currently specify a license. Contact the project maintainer for usage permissions.

