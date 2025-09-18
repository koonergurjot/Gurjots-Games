# Gurjot's Games - Replit Project

## Overview
This is a web-based gaming hub featuring a collection of HTML5 games that run directly in the browser. The project includes classic games like Tetris, Snake, Pong, Chess, Breakout, and many more.

## Recent Changes
- **2025-09-18**: Successfully imported from GitHub and configured for Replit environment
  - Installed all dependencies using npm
  - Set up static file server on port 5000 using `npx serve`
  - Configured deployment for autoscale production
  - All 12 games passed health checks and are working properly

## Project Architecture
- **Type**: Static HTML5 games website
- **Frontend**: HTML, CSS, JavaScript with multiple game implementations
- **Server**: Static file server (npx serve) on port 5000
- **Games**: 12 different HTML5 games including:
  - Tetris, Snake, Pong, Chess (2D & 3D), Breakout
  - Asteroids, Platformer, Runner, Shooter, 2048, Maze3D
- **API**: Simple health check endpoint for monitoring
- **Original Target**: Netlify deployment (now configured for Replit)

## User Preferences
- Static site with no backend dependencies
- Games designed to work offline with service worker caching
- Responsive design for desktop and mobile
- Clean, modern UI with game browsing interface

## Development Setup
- Node.js project using ES6 modules
- Dependencies: serve, vitest, jsdom, axe-core
- Health check system to validate all games
- Test suite for game components
- Service worker for offline functionality

## Deployment Configuration
- **Target**: Autoscale (static site)
- **Command**: `npx serve . -p 5000 -s`
- **Port**: 5000 (configured for Replit proxy)

## Key Features
- Game launcher with diagnostics
- Multiplayer support for some games (WebSocket/BroadcastChannel)
- Replay system for Tetris
- Chess AI integration
- Achievement and quest systems
- Responsive game grid interface