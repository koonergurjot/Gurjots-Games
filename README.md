# Game Library

[![Build Status](https://github.com/<org>/<repo>/actions/workflows/badges.yml/badge.svg)](https://github.com/<org>/<repo>/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Play classic games in your browser

Explore a collection of accessible web games. This project showcases a lightweight architecture and modern JavaScript tooling.

## Features

- Responsive design that works on any device
- Progressive web app support for offline play
- Clean separation between game logic and UI components
- Automated tests with [Vitest](https://vitest.dev)

## Architecture

```mermaid
flowchart TD
    A[Player] -->|Interaction| B[Game UI]
    B --> C[Game Logic]
    C --> D[(State Store)]
    B --> E[Server APIs]
```

## Design Tokens

Shared design tokens live in `styles/tokens.css`. The file defines color palettes for light and dark themes, spacing, radii, shadows, z-index layers, and typography. All style sheets import these variables, and dark mode is activated by setting `data-theme="dark"` on the root element.

## Theme and Motion Preferences

Token variables power the design system and are reused throughout the app for color, spacing, and typography.
The interface includes a dark-mode toggle that flips the `data-theme` attribute on the root element and stores the choice in `localStorage`.
Animations honor the user's `prefers-reduced-motion` setting, reducing transitions when motion should be minimized.

## Installation

```bash
npm install
```

## Configuration

Set environment variables to customize behavior. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for details.

## Usage

```bash
npm start
```

Open `http://localhost:3000` in a browser and enjoy.

## Roadmap

- Additional classic games
- Accessibility enhancements
- Cloud deployment guide

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## FAQ

**Why use this project?**
: It offers a clean foundation for building browser games with modern tooling.

**Where can I report issues?**
: Use the [issue tracker](https://github.com/<org>/<repo>/issues).

## License

This project is available under the MIT License. See the [LICENSE](LICENSE) file for more information.

