# Umbreon Dark Mode Extension - Enhancement Specification

## Project Overview

Umbreon is a Chrome dark mode extension (MV3) that applies dark themes to any website. This specification covers enhancements to improve compatibility with already-dark sites, add quick auto-enable functionality, and support domain-level URL matching.

---

## Current Issues

### Issue 1: Dark Mode Fails on Already-Dark Sites

**Problem:** The extension forces dark backgrounds and colors on ALL sites, including those that already have dark themes (e.g., ESPN, YouTube dark mode, GitHub dark mode). This causes visual artifacts like double-darkening, lost contrast, and broken layouts.

**Root Cause:** The `baseCss()` function in `content.js` applies aggressive `!important` CSS rules unconditionally:
```css
:root[data-umbreon="on"] body {
  background: var(--umb-bg) !important;
  color: var(--umb-text) !important;
}
```

**User Impact:** Sites that are already dark become unreadable or visually broken.

### Issue 2: No Quick Auto-Enable Option

**Problem:** Users cannot quickly add the current site to auto-enable from the popup. They must navigate to the options page, type the URL, and manually add it.

**User Impact:** Friction in workflow when users find a site they always want dark mode enabled on.

### Issue 3: Auto-Activate Doesn't Support Base URLs

**Problem:** The URL matching system only supports exact origin matching or prefix matching. It doesn't support domain-level matching with subdomains.

**Example:**
- Rule `espn.com` does NOT match `www.espn.com` or `m.espn.com`
- Users must add multiple rules for the same site

**User Impact:** Tedious to manage auto-activate rules for sites with multiple subdomains.

---

## Requirements

### R1: Smart Dark Site Detection

**Requirement:** The extension must detect if a website is already using a dark color scheme and adjust its behavior accordingly.

**Acceptance Criteria:**
- [ ] Detect site darkness by sampling background colors from key elements (body, html, main, header)
- [ ] If 60%+ of sampled backgrounds have luminance < 0.15, classify site as "already dark"
- [ ] For already-dark sites, apply minimal adjustments (link colors, contrast fixes only)
- [ ] For light sites, apply full aggressive dark mode as before
- [ ] Detection must run BEFORE applying CSS to prevent flash of incorrect styling

**Test Cases:**
| Site | Expected Detection | Expected Behavior |
|------|-------------------|-------------------|
| ESPN.com | Already dark | Minimal adjustments |
| Google.com | Light | Full dark mode |
| GitHub.com (dark mode) | Already dark | Minimal adjustments |
| Wikipedia.org | Light | Full dark mode |
| YouTube (dark mode) | Already dark | Minimal adjustments |

### R2: Quick Auto-Enable Button in Popup

**Requirement:** Add a button to the popup that allows users to add/remove the current site from the auto-enable list with one click.

**Acceptance Criteria:**
- [ ] Button visible in popup below the "Disable on this page" checkbox
- [ ] Button text shows "Always enable on this site" when not in list
- [ ] Button text shows "Remove from auto-enable" when site is in list
- [ ] Clicking requests `<all_urls>` permission if not already granted
- [ ] Adds/removes the site origin to/from `autoActivateRules` array
- [ ] UI updates immediately after action

**UI Mockup:**
```
[Dark Mode] [Turn on]
Disabled
─────────────────────
☐ Disable on this site
☐ Disable on this page
─────────────────────
[Always enable on this site]  <-- NEW
─────────────────────
Theme: [Classic ▼]
```

### R3: Domain-Level URL Matching

**Requirement:** Auto-activate rules should support matching against base domains including all subdomains.

**Acceptance Criteria:**
- [ ] Rule `espn.com` matches `https://espn.com/*`
- [ ] Rule `espn.com` matches `https://www.espn.com/*`
- [ ] Rule `espn.com` matches `https://m.espn.com/*`
- [ ] Rule `espn.com` matches `https://sports.espn.com/*`
- [ ] Rule `espn.com` does NOT match `https://evil-espn.com/*`
- [ ] Rule `espn.com` does NOT match `https://notespn.com/*`
- [ ] Existing exact-match and prefix-match behavior preserved

**Matching Logic:**
```
Input URL: https://www.espn.com/nfl/scores
Rule: espn.com

1. Extract hostname from URL: www.espn.com
2. Check if hostname === rule: NO (www.espn.com !== espn.com)
3. Check if hostname ends with "." + rule: YES (www.espn.com ends with .espn.com)
4. Result: MATCH
```

---

## Technical Design

### Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   popup.html    │───▶│   popup.js      │───▶│ service_worker  │
│   (UI button)   │    │ (click handler) │    │ (message hub)   │
└─────────────────┘    └─────────────────┘    └────────┬────────┘
                                                       │
                       ┌─────────────────┐             │
                       │  url_match.js   │◀────────────┤
                       │ (domain match)  │             │
                       └─────────────────┘             │
                                                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  content.js     │◀───│    storage.js   │
                       │ (dark detect)   │    │ (persist rules) │
                       └─────────────────┘    └─────────────────┘
```

### Data Flow

1. **Auto-Enable Click:**
   ```
   User clicks button → popup.js sends ADD_AUTOACTIVATE →
   service_worker adds to storage → popup.js refreshes UI
   ```

2. **Dark Site Detection:**
   ```
   Content script loads → detectSiteDarkness() samples backgrounds →
   Sets data-umbreon-dark-site attribute → baseCss() checks attribute →
   Applies appropriate CSS rules
   ```

3. **URL Matching:**
   ```
   Service worker gets tab URL → ruleMatchesUrl() called →
   Checks exact match → Checks prefix match → Checks domain match →
   Returns true/false
   ```

---

## Files Affected

| File | Change Type | Description |
|------|-------------|-------------|
| `src/shared/url_match.js` | Modify | Add `domainMatches()` helper, update `ruleMatchesUrl()` |
| `src/popup/popup.html` | Modify | Add auto-enable button and hint element |
| `src/popup/popup.js` | Modify | Add button handler, update `refresh()` for state |
| `src/content/content.js` | Modify | Add dark site detection, conditional CSS application |

---

## Out of Scope

- Custom user-configurable luminance thresholds
- Per-site theme customization
- Whitelist/blacklist of elements to skip
- Visual indicator in popup showing detection result
- Migration of existing rules to new format

---

## Success Metrics

1. **Dark site compatibility:** ESPN.com and similar dark sites should be readable with extension enabled
2. **User workflow:** Adding a site to auto-enable takes 1 click instead of 4+ clicks
3. **Rule simplicity:** One rule covers all subdomains of a site
