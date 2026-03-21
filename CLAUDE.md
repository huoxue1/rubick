# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rubick is a plugin-based desktop productivity tool built with Electron and Vue 3. It provides a searchable launcher for apps, files, and plugins.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Ant Design Vue 3
- **Desktop**: Electron 26 + vue-cli-plugin-electron-builder
- **Database**: PouchDB (local storage with WebDAV sync)
- **Build Tool**: Vue CLI 4.5
- **Package Manager**: npm/yarn (volta-managed Node 16.20.2)

## Commands

```bash
# Install dependencies
yarn install

# Run in development mode (web)
yarn serve

# Run Electron development mode
yarn electron:serve

# Build for production
yarn build

# Build Electron app
yarn electron:build

# Lint
yarn lint

# Run feature submodule dev server
yarn feature:dev
```

## Architecture

### Directory Structure

- `src/main/` - Electron main process (window management, IPC, system tray, hotkeys)
- `src/renderer/` - Vue 3 renderer process (UI components)
- `src/core/` - Core modules:
  - `plugin-handler/` - Plugin installation/management via npm
  - `db/` - PouchDB wrapper with WebDAV sync
  - `app-search/` - System app search functionality
  - `screen-capture/` - Screenshot capture
- `feature/` - Separate Vue app for plugin UI rendering
- `guide/` - Separate Vue app for onboarding/tutorials
- `build/` - Build output directory
- `release/` - Release configuration (notes, entitlements)

### Plugin System

Plugins are npm packages installed via a custom `AdapterHandler` class (`src/core/plugin-handler/index.ts`). Each plugin has a `plugin.json` manifest. Two plugin types exist:
- **UI plugins**: Render Vue components in the feature app
- **System plugins**: Run in the main process with full Electron API access

### Data Flow

1. Main process (`src/main/index.ts`) initializes Electron, creates windows, registers hotkeys
2. Renderer (`src/renderer/main.ts`) provides the search UI
3. IPC communication between renderer and main process
4. Plugin data stored in PouchDB (`src/core/db/`), syncs via WebDAV

### Key Configuration

- `vue.config.js`: Electron build config, bundling options
- `tsconfig.json`: TypeScript config with path alias `@/*` → `src/*`
- `.eslintrc.js`: ESLint + Prettier rules (single quotes)
- `package.json`: Volta pins Node 16.20.2

## Development Notes

- Use `yarn` over `npm` for consistency with volta
- Electron dev mode watches `src/main` for changes
- The `feature` and `guide` subdirectories are separate Vue apps with their own `package.json`
- For plugin development, see the `rubick-plugin-cli` repository
