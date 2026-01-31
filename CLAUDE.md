# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Umbreon is a Chrome dark mode extension (MV3) that applies dark themes to any website. No build step required - uses vanilla JavaScript with ES modules.

## Development

Load as unpacked extension:
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select this project folder

Reload the extension after code changes via the refresh icon on the extensions page.

## Architecture

### Message Flow

All communication uses `chrome.runtime.sendMessage` with message types defined in `src/shared/messaging.js`. The service worker acts as a central hub, handling messages from popup, options, and content scripts.

### Key Components

**Service Worker** (`src/background/service_worker.js`)
- Computes effective state per tab by combining: nightlight setting, auto-activate rules, disable lists, and tab overrides
- Tab overrides (user toggles) are stored in session storage and cleared on tab close
- Injects content script on demand via `chrome.scripting.executeScript`

**Content Script** (`src/content/content.js`)
- MUST remain as classic (non-module) script because `chrome.scripting.executeScript` injects as classic
- Uses IIFE with guard key to prevent duplicate execution when re-injected
- Inlines `MessageType.APPLY` constant since ESM imports aren't available
- Themes are hardcoded CSS variable definitions (not fetched) for MV3 compatibility
- Patches `Element.prototype.attachShadow` to inject styles into dynamically created shadow roots
- Uses MutationObserver to fix contrast on newly added DOM elements

**Storage Layer** (`src/shared/storage.js`)
- `chrome.storage.sync` for persistent settings (synced across devices)
- `chrome.storage.session` for ephemeral tab overrides

### State Priority

When determining if dark mode is enabled for a tab:
1. Check if URL is restricted (chrome://, edge://, about:, webstore)
2. Check tab override (explicit user toggle for this session)
3. Check disable rules (per-origin or per-page)
4. Check nightlight or auto-activate rules (requires `<all_urls>` permission)

### Permissions Model

Extension starts with minimal permissions (`activeTab`, `scripting`, `storage`). The optional `<all_urls>` permission is requested only when enabling Nightlight or adding auto-activate rules.
