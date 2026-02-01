# Umbreon Dark Mode Extension - Specification

## Implementation Status

**Current Version:** 0.5.0 (Phase 8 complete)

See [implementation_plan.md](implementation_plan.md) for detailed phase-by-phase progress tracking.

**Completed Phases:**
- ✅ Phase 1: Domain-level URL matching
- ✅ Phase 2: Quick auto-enable button in popup
- ✅ Phase 4: Reliable contrast-based dark mode (replaced detection approach)
- ✅ Phase 5: Simplified enable/disable model
- ✅ Phase 6: Visual theme picker with 8 themes
- ✅ Phase 7: UX improvements (Gruvbox/Tokyo Night themes, visual nightlight toggle, GitHub link)
- ✅ Phase 8: Visual refinement & documentation

**Next:** Phase 9 - Per-website theme settings

---

## Project Overview

Umbreon is a Chrome dark mode extension (MV3) that applies dark themes to any website using a surgical contrast-fixing approach rather than aggressive blanket overrides.

---

## Requirements Status

### R1: Smart Dark Site Detection → **ABANDONED** (See R4)

**Status:** ❌ ABANDONED - Replaced by contrast-based approach (R4)

**Original Requirement:** Detect if a website is already dark and adjust behavior accordingly.

**Why Abandoned:** Runtime detection has fundamental timing issues. By the time backgrounds can be reliably sampled, the page has already rendered with incorrect styles, causing visible flashing. Multiple mitigation attempts (re-detection passes, MutationObserver, RAF callbacks) failed to eliminate the flash.

**Replacement:** R4 - Contrast-based dark mode eliminates the need for detection entirely.

### R2: Quick Auto-Enable Button in Popup - ✅ COMPLETE

**Requirement:** Add a button to the popup that allows users to add/remove the current site from the auto-enable list with one click.

**Status:** ✅ Implemented in Phase 2

**Completion:**
- ✅ Button visible in popup
- ✅ Text changes based on state ("Always enable" / "Remove from auto-enable")
- ✅ Requests `<all_urls>` permission when adding
- ✅ Adds/removes site origin from `autoActivateRules`
- ✅ UI updates immediately

### R3: Domain-Level URL Matching - ✅ COMPLETE

**Requirement:** Auto-activate rules should support matching against base domains including all subdomains.

**Status:** ✅ Implemented in Phase 1

**Implementation:** Added `domainMatches()` helper function to `url_match.js` that checks if a URL's hostname ends with the rule domain.

**Completion:**
- ✅ Rule `espn.com` matches `https://espn.com/*` and all subdomains
- ✅ Prevents false matches like `evil-espn.com`
- ✅ Preserves existing exact-match and prefix-match behavior

### R4: Contrast-Based Dark Mode - ✅ COMPLETE

**Requirement:** Instead of detecting dark sites at runtime (which causes flashing), rely entirely on the contrast fixer to surgically apply dark mode only where needed.

**Status:** ✅ Implemented in Phase 4

**Rationale:** Runtime detection has fundamental timing issues. The contrast fixer approach works because:
1. It runs after content loads and re-runs on mutations
2. It only modifies elements with poor contrast (surgical precision)
3. Dark sites already have good contrast, so the fixer naturally does nothing
4. No flashing because we never remove/re-add attributes

**Implementation:**
- ✅ Removed aggressive `!important` background overrides on `:root` and `body`
- ✅ Kept CSS variable definitions for theming
- ✅ Contrast fixer runs on page load with multiple passes (0ms, 500ms, 1s, 2s)
- ✅ MutationObserver re-runs fixer on DOM changes
- ✅ Removed "Intense Mode" feature
- ✅ Enhanced in Phase 4 v2 with better light background detection (0.45 luminance threshold)
- ✅ Added nested light background fixing
- ✅ Comprehensive element scanning with no artificial limits

**Verified:** ESPN.com (1,076 fixes), Yahoo.com (331 fixes), Reddit.com working correctly.

### R5: Simplified Enable/Disable Model - ✅ COMPLETE

**Requirement:** Remove confusing "Disable on this site" and "Disable on this page" options. Simplify to: auto-enable list OR manual toggle.

**Status:** ✅ Implemented in Phase 5

**New Model:**
1. **Nightlight ON** → Dark mode on all sites (except restricted URLs)
2. **Nightlight OFF** → Dark mode only on auto-enable sites OR manually toggled tabs
3. **Tab toggle** → Temporary override for current session

**Implementation:**
- ✅ Removed "Disable on this site" and "Disable on this page" checkboxes
- ✅ Removed `disableOrigins` and `disablePages` from storage
- ✅ Removed `SET_DISABLE_RULE` message type
- ✅ Popup shows only: toggle, auto-enable button, theme picker, status indicator
- ✅ Status shows "(Auto)", "(Nightlight)", or "(Manual)" for clarity

**Verified:** Google.com, ESPN.com, Yahoo.com all working correctly with simplified model.

### R6: Visual Theme Picker - ✅ COMPLETE

**Requirement:** Replace dropdown theme selector with visual preview squares showing each theme's colors.

**Status:** ✅ Implemented in Phase 6, expanded in Phase 7

**Implementation:**
- ✅ Popup: Horizontal row of 24x24px theme swatches with tooltips
- ✅ Options: Grid layout with 140px theme cards, 60px preview squares, theme names
- ✅ Selected theme shows blue border with shadow
- ✅ Hover effects with border and scale
- ✅ Click immediately applies theme
- ✅ Phase 6: Added Nord, Dracula, Solarized, Monokai (8 total themes)
- ✅ Phase 7: Added Gruvbox, Tokyo Night (10 total themes)

**Current Theme Palette (10 themes):**
| Theme | Background | Description |
|-------|------------|-------------|
| Classic | `#0f1115` | Default dark gray |
| AMOLED | `#000000` | Pure black for OLED screens |
| Dim | `#0b1220` | Navy blue tint |
| Sepia | `#14110d` | Warm brown tint |
| Nord | `#2e3440` | Nordic blue-gray |
| Dracula | `#282a36` | Purple-tinted dark |
| Solarized | `#002b36` | Teal-tinted dark |
| Monokai | `#272822` | Warm olive dark |
| Gruvbox | `#1d2021` | Retro warm dark |
| Tokyo Night | `#1a1b26` | Modern dark blue |

**Verified:** All 10 themes display correctly in both popup and options page. Theme changes apply immediately and persist.

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
| `src/popup/popup.html` | Modify | Simplify UI, add theme picker, remove disable checkboxes |
| `src/popup/popup.js` | Modify | Add auto-enable button, theme picker, remove disable logic |
| `src/popup/popup.css` | Modify | Add theme picker styles |
| `src/content/content.js` | Major rewrite | Remove aggressive CSS, remove detection, enhance contrast fixer, add themes |
| `src/options/options.html` | Modify | Remove intense mode, add theme picker |
| `src/options/options.js` | Modify | Remove intense mode, disable rules; add theme picker |
| `src/background/service_worker.js` | Modify | Remove intense mode, simplify state computation |
| `src/shared/storage.js` | Modify | Remove `disableRules`, `intenseMode` from schema |
| `src/shared/messaging.js` | Modify | Remove disable-related message types |

---

## Out of Scope

- Custom user-configurable contrast thresholds
- Per-site theme customization
- Whitelist/blacklist of specific elements
- Automatic theme detection based on system preference
- Import/export of settings

---

### R7: Additional Themes - ✅ COMPLETE

**Requirement:** Add Gruvbox and Tokyo Night themes for more variety.

**Status:** ✅ Implemented in Phase 7

**Implementation:**
- ✅ Gruvbox: Retro warm dark (#1d2021) with earthy tones
- ✅ Tokyo Night: Modern dark blue (#1a1b26) with clean accents
- ✅ Both themes added to popup swatches and options grid
- ✅ Theme definitions include all CSS variables (bg, bg2, bg3, text, muted, link, border, shadow)

**Verified:** Both themes tested on Wikipedia.org and other sites. Visual appearance matches intended aesthetic.

### R8: Visual Refinement - ✅ COMPLETE

**Requirement:** Improve color depth variation with three-level background system.

**Status:** ✅ Implemented in Phase 8

**Implementation:**
- ✅ Added `--umb-bg3` variable to all 10 themes for elevated/nested surfaces
- ✅ Hash-based distribution for guaranteed visual diversity
- ✅ Even distribution: ~31% bg1 (darkest), ~31% bg2 (medium), ~38% bg3 (lightest)
- ✅ Hash formula: `floor(rect.top) + floor(rect.left) + classList.length`
- ✅ Surface-like elements get +100 hash bonus for consistent grouping
- ✅ Deterministic assignment - same elements get same backgrounds on reload
- ✅ Fixed auto-enable removal bug (now disables immediately without refresh)
- ✅ Created .gitignore with .claude/ entry
- ✅ Updated documentation (spec.md, implementation_plan.md)

**Verified:** ESPN.com shows clear visual hierarchy with balanced distribution (31% bg1, 31% bg2, 38% bg3). No flat/monotonous appearance - proper color variation achieved.

---

## Success Metrics

**Achieved:**
1. ✅ **Dark site compatibility:** ESPN.com (1,076 fixes) and Yahoo.com (331 fixes) work correctly - no double-darkening or flashing
2. ✅ **User workflow:** Adding a site to auto-enable takes 1 click
3. ✅ **Rule simplicity:** One rule (e.g., `espn.com`) covers all subdomains
4. ✅ **UI clarity:** Simplified model with clear status indicators "(Auto)", "(Nightlight)", "(Manual)"
5. ✅ **Visual appeal:** 10 themes displayed as visual swatches, intuitive selection
6. ✅ **Comprehensive coverage:** No element limits, nested background fixing, multiple fix passes
7. ✅ **Visual hierarchy:** Three-level background system (bg, bg2, bg3) with hash-based distribution creating balanced visual diversity (~31% bg1, ~31% bg2, ~38% bg3) - no flat/monotonous appearance
