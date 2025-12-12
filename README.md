# Umbreon
Open Source Chrome Dark Mode Extension - Make any website dark mode

Creator: Nathan Kasco

## Features
- Popup toggle to enable/disable dark mode on the current tab
- Disable Umbreon on the current site or on the current page
- Nightlight setting to attempt enabling Umbreon on any website (requires optional permission)
- Auto-activate list for URLs/origins to turn on automatically (requires optional permission)
- Multiple themes (Classic, AMOLED, Dim, Sepia)

## Load Unpacked (Chrome)
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder (the one containing `manifest.json`)

## Permissions model
- Umbreon starts with minimal permissions (`activeTab`, `scripting`, `storage`) so it can work when you click the extension.
- Enabling **Nightlight** (or adding to Auto-Activate) will request optional permission to run on all sites (`<all_urls>`). If you deny it, Nightlight/Auto-Activate won’t run automatically.

## Project layout
- `manifest.json`: MV3 manifest
- `src/background/service_worker.js`: rule engine + injection
- `src/content/content.js`: page theming engine
- `src/popup/*`: popup UI
- `src/options/*`: settings UI
- `src/shared/*`: storage, URL helpers, messaging
