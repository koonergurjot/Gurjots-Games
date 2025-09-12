# Gurjot's Games

Gurjot's Games is a fun, web‑based gaming hub that lets you discover and play a growing collection of HTML5 games right in your browser. The project powers a responsive website with a curated library of titles, a custom loader, and offline‑friendly caching to keep play sessions smooth and up to date.

## Features

- **Curated game library** – browse and launch games from a unified interface that works on desktop and mobile.
- **Game loader with diagnostics** – `js/game-loader.js` boots each game and surfaces clear error messages when something goes wrong.
- **Service Worker caching** – a network‑first strategy keeps JavaScript fresh while enabling offline support for assets.
- **Accessible design** – semantic HTML, ARIA labels and responsive layouts provide an inclusive experience.

## Getting Started

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

### Testing

Run health checks and unit tests:

```bash
npm test
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and adhere to the [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

## Security

If you discover a vulnerability, please follow the instructions in [SECURITY.md](SECURITY.md).

## License

This repository does not currently specify a license. Contact the project maintainer for usage permissions.

