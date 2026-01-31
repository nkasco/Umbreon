# Umbreon Enhancement - Implementation Plan

## Overview

This document tracks the implementation progress for three enhancements:
1. Domain-level URL matching for auto-activate rules
2. Quick "Always Auto-Enable" button in popup
3. Smart dark site detection

---

## Phase 1: Domain-Level URL Matching

**File:** `src/shared/url_match.js`

### Tasks

- [x] Add `domainMatches(ruleDomain, urlDomain)` helper function
  - Normalize both domains to lowercase
  - Check exact match first
  - Check if URL domain ends with "." + rule domain
  - Return boolean

- [x] Update `ruleMatchesUrl(ruleValue, rawUrl)` function
  - Keep existing exact origin match check
  - Keep existing prefix match check
  - Add domain matching as fallback:
    - Parse rule as URL to extract hostname
    - Call `domainMatches()` with rule hostname and URL hostname
    - Return true if domain matches

- [x] Add unit test cases (manual testing)
  - `espn.com` matches `https://www.espn.com/nfl`
  - `espn.com` matches `https://m.espn.com/`
  - `espn.com` does NOT match `https://notespn.com/`
  - `google.com` does NOT match `https://evil-google.com/`
  - Existing prefix rules still work

### Code Changes

```javascript
// New function (~10 lines)
function domainMatches(ruleDomain, urlDomain) {
  const rule = ruleDomain.toLowerCase();
  const target = urlDomain.toLowerCase();
  if (rule === target) return true;
  return target.endsWith('.' + rule);
}

// Modified ruleMatchesUrl (~8 additional lines)
export function ruleMatchesUrl(ruleValue, rawUrl) {
  // ... existing checks ...

  // NEW: Domain matching
  const ruleUrl = safeParseUrl(ruleValue);
  if (ruleUrl && domainMatches(ruleUrl.hostname, url.hostname)) {
    return true;
  }
  return false;
}
```

---

## Phase 2: Popup Auto-Enable Button

**Files:** `src/popup/popup.html`, `src/popup/popup.js`

### Tasks

#### HTML Changes (`popup.html`)

- [x] Add separator after "Disable on this page" checkbox (line 38)
- [x] Add button element with id `autoEnableSite`
- [x] Add hint paragraph with id `autoEnableHint`

```html
<div class="sep"></div>

<button id="autoEnableSite" class="btn" type="button" style="width: 100%">
  Always enable on this site
</button>
<p class="hint" id="autoEnableHint"></p>
```

#### JavaScript Changes (`popup.js`)

- [x] Update `refresh()` function to handle auto-enable state
  - Get button and hint elements
  - Check `state.autoActivateMatch` from response
  - Update button text based on state
  - Set `data-action` attribute ("add" or "remove")
  - Update hint text

- [x] Add click event listener for `autoEnableSite` button
  - Get active tab
  - Get origin from tab URL
  - Check button's `data-action` attribute
  - If "add": Request `<all_urls>` permission, send `ADD_AUTOACTIVATE`
  - If "remove": Send `REMOVE_AUTOACTIVATE`
  - Call `refresh()` to update UI

- [x] Import `MessageType.ADD_AUTOACTIVATE` and `REMOVE_AUTOACTIVATE` (already available)

### Code Changes

```javascript
// In refresh() function, add after line 59:
const autoEnableBtn = document.getElementById("autoEnableSite");
const autoEnableHint = document.getElementById("autoEnableHint");

if (state.autoActivateMatch) {
  autoEnableBtn.textContent = "Remove from auto-enable";
  autoEnableBtn.dataset.action = "remove";
  autoEnableHint.textContent = "This site will auto-enable dark mode.";
} else {
  autoEnableBtn.textContent = "Always enable on this site";
  autoEnableBtn.dataset.action = "add";
  autoEnableHint.textContent = "";
}

// New event listener (add after line 131):
document.getElementById("autoEnableSite").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.url) return;

  const origin = getOrigin(tab.url);
  if (!origin) return;

  const btn = document.getElementById("autoEnableSite");

  if (btn.dataset.action === "add") {
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) return;

    await chrome.runtime.sendMessage({
      type: MessageType.ADD_AUTOACTIVATE,
      rule: origin
    });
  } else {
    await chrome.runtime.sendMessage({
      type: MessageType.REMOVE_AUTOACTIVATE,
      rule: origin
    });
  }

  await refresh();
});
```

---

## Phase 3: Smart Dark Site Detection

**File:** `src/content/content.js`

### Tasks

#### Constants

- [ ] Add `DARK_SITE_ATTR` constant after line 17
  ```javascript
  const DARK_SITE_ATTR = "data-umbreon-dark-site";
  ```

#### Dark Site Detection Function

- [ ] Add `detectSiteDarkness()` function after `isLightBackground()` (line 315)
  - Sample key elements: body, html, main, header, [role="main"]
  - Filter to elements that exist
  - For each element with background alpha > 0.5:
    - Calculate luminance
    - Count as "dark" if luminance < 0.15
  - Return true if 60%+ of samples are dark

```javascript
function detectSiteDarkness() {
  const samples = [
    document.body,
    document.documentElement,
    document.querySelector('main'),
    document.querySelector('header'),
    document.querySelector('[role="main"]'),
    document.querySelector('article'),
    document.querySelector('.container'),
    document.querySelector('#content')
  ].filter(Boolean);

  let darkCount = 0;
  let totalCount = 0;

  for (const el of samples) {
    const cs = getComputedStyle(el);
    const bg = parseCssColor(cs.backgroundColor);
    if (bg && bg.a > 0.5) {
      totalCount++;
      const lum = relativeLuminance(bg);
      if (lum < 0.15) darkCount++;
    }
  }

  return totalCount > 0 && (darkCount / totalCount) >= 0.6;
}
```

#### Modified CSS Rules

- [ ] Update `baseCss()` to add conditional selectors for dark sites
  - Root/body rules should NOT apply when `DARK_SITE_ATTR` is set
  - Use `:not([${DARK_SITE_ATTR}])` selector for aggressive rules

```javascript
// Change line 63-68 from:
:root[${UMB_ATTR}="on"],
:root[${UMB_ATTR}="on"] body {
  background: var(--umb-bg) !important;
  ...
}

// To:
:root[${UMB_ATTR}="on"]:not([${DARK_SITE_ATTR}]),
:root[${UMB_ATTR}="on"]:not([${DARK_SITE_ATTR}]) body {
  background: var(--umb-bg) !important;
  ...
}
```

- [ ] Apply same pattern to other aggressive selectors:
  - Form elements (lines 101-110)
  - Global border color (line 137-139)
  - Pre/code elements (lines 94-99)

#### Modified `apply()` Function

- [ ] Update `apply()` function (line 503) to detect darkness before applying
  - Call `detectSiteDarkness()` BEFORE setting `UMB_ATTR`
  - Set or remove `DARK_SITE_ATTR` based on result

```javascript
function apply(enabled, themeId, nextIntenseMode) {
  const root = document.documentElement;
  intenseMode = !!nextIntenseMode;

  if (!enabled) {
    root.removeAttribute(UMB_ATTR);
    root.removeAttribute(DARK_SITE_ATTR);  // NEW
    root.removeAttribute(INTENSE_ATTR);
    // ... rest of disable logic
  }

  // NEW: Detect if site is already dark before applying
  const isAlreadyDark = detectSiteDarkness();
  if (isAlreadyDark) {
    root.setAttribute(DARK_SITE_ATTR, "on");
  } else {
    root.removeAttribute(DARK_SITE_ATTR);
  }

  root.setAttribute(UMB_ATTR, "on");
  // ... rest of enable logic
}
```

#### Threshold Adjustment

- [ ] Consider lowering `isLightBackground()` threshold from 0.62 to 0.4
  - This makes the contrast fixer more aggressive on medium-dark backgrounds
  - Test on ESPN to verify improvement

---

## Testing Checklist

### Domain Matching Tests

- [ ] Add rule `espn.com` → Visit `www.espn.com` → Verify auto-enabled
- [ ] Add rule `espn.com` → Visit `m.espn.com` → Verify auto-enabled
- [ ] Add rule `google.com` → Visit `evil-google.com` → Verify NOT auto-enabled
- [ ] Add rule `https://example.com/path` → Verify prefix matching still works

### Popup Button Tests

- [ ] Visit site not in auto-enable list → Button shows "Always enable on this site"
- [ ] Click button → Permission requested → Rule added → Button changes text
- [ ] Visit site in auto-enable list → Button shows "Remove from auto-enable"
- [ ] Click remove → Rule removed → Button changes text
- [ ] Refresh popup → State persists correctly

### Dark Site Detection Tests

- [ ] ESPN.com → Should detect as dark → Minimal style application
- [ ] Google.com → Should detect as light → Full dark mode
- [ ] GitHub.com (dark mode) → Should detect as dark → Minimal adjustments
- [ ] Wikipedia.org → Should detect as light → Full dark mode
- [ ] CNN.com → Should detect as light → Full dark mode

---

## Rollback Plan

If issues arise, changes can be reverted file by file:

1. **url_match.js**: Remove `domainMatches()` and new check in `ruleMatchesUrl()`
2. **popup.html/js**: Remove button element and event listener
3. **content.js**: Remove `DARK_SITE_ATTR` constant, `detectSiteDarkness()`, and conditional selectors

---

## Estimated Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `src/shared/url_match.js` | ~15 | ~5 |
| `src/popup/popup.html` | ~6 | 0 |
| `src/popup/popup.js` | ~35 | ~5 |
| `src/content/content.js` | ~30 | ~20 |
| **Total** | **~86** | **~30** |
