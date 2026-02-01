(() => {
  // This file may be injected multiple times into the same tab/frame.
  // Avoid "Identifier has already been declared" by:
  // 1) not leaking top-level const/let into the extension isolated world, and
  // 2) using a guard so we don't add duplicate listeners.
  const GUARD_KEY = "__umbreon_content_script_ran__";
  if (globalThis[GUARD_KEY]) return;
  globalThis[GUARD_KEY] = true;

  // NOTE: Content scripts injected via chrome.scripting.executeScript run as classic scripts.
  // They cannot use ESM imports, so we inline the message type we need.
  const MessageType = Object.freeze({
    APPLY: "UMB_APPLY"
  });

  const UMB_ATTR = "data-umbreon";
  const STYLE_ID = "umbreon-style";
  const THEME_ID = "umbreon-theme";
  const SHADOW_STYLE_ID = "umbreon-shadow-style";

  let mutationObserver = null;
  let fixScheduled = false;

  const FIX_ATTR_FG = "data-umb-fg";
  const FIX_ATTR_LINK = "data-umb-link";
  const FIX_ATTR_BG = "data-umb-bg";

  function ensureStyleEl(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      el.type = "text/css";
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function ensureStyleElInRoot(rootNode, id) {
    if (!rootNode) return null;
    let el = rootNode.getElementById?.(id) ?? rootNode.querySelector?.(`#${CSS.escape(id)}`);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      el.type = "text/css";
      rootNode.appendChild(el);
    }
    return el;
  }

  function baseCss() {
    // Phase 4: Simplified CSS strategy
    // - No aggressive background overrides on :root/body (causes issues on dark sites)
    // - Rely on the contrast fixer to handle text/backgrounds surgically
    // - Keep CSS variables, link styling, and contrast fix attribute rules
    const host = String(globalThis.location?.hostname || "");
    const invertCanvas = /(^|\.)docs\.google\.com$/i.test(host) || /(^|\.)sheets\.google\.com$/i.test(host);

    const on = `:root[${UMB_ATTR}="on"]`;

    return `
${on} {
  color-scheme: dark;
}

/* Contrast fix attributes - applied by JavaScript to elements that need fixing */
${on} [${FIX_ATTR_FG}] {
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
}

${on} [${FIX_ATTR_LINK}] {
  color: var(--umb-link) !important;
  -webkit-text-fill-color: var(--umb-link) !important;
}

${on} [${FIX_ATTR_BG}="1"] {
  background: var(--umb-bg) !important;
}

${on} [${FIX_ATTR_BG}="2"] {
  background: var(--umb-bg2) !important;
}

/* Selection styling */
${on} ::selection {
  background: rgba(138, 180, 248, 0.35) !important;
}

/* Prevent filter interference with media */
${on} img,
${on} video,
${on} canvas,
${on} svg {
  filter: none !important;
}
${invertCanvas ? `
${on} canvas {
  filter: invert(1) hue-rotate(180deg) !important;
}
` : ""}
`;
  }

  function shadowCss() {
    // Shadow DOM needs its own rules because document-level selectors like
    // :root[data-umbreon="on"] don't match inside shadow trees.
    // Variables (e.g. --umb-text) still inherit across the boundary.
    const on = `html[${UMB_ATTR}="on"]`;
    return `
:host-context(${on}) {
  color-scheme: dark;
}

:host-context(${on}) [${FIX_ATTR_FG}] {
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
}

:host-context(${on}) [${FIX_ATTR_LINK}] {
  color: var(--umb-link) !important;
  -webkit-text-fill-color: var(--umb-link) !important;
}

:host-context(${on}) [${FIX_ATTR_BG}="1"] {
  background: var(--umb-bg) !important;
}

:host-context(${on}) [${FIX_ATTR_BG}="2"] {
  background: var(--umb-bg2) !important;
}
`;
  }

  function parseCssColor(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const m = v.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const parts = m[1]
      .split(",")
      .map((p) => p.trim())
      .map((p) => (p.endsWith("%") ? (parseFloat(p) * 2.55) : parseFloat(p)));
    if (parts.length < 3) return null;
    const [r, g, b, a = 1] = parts;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return {
      r: Math.max(0, Math.min(255, r)),
      g: Math.max(0, Math.min(255, g)),
      b: Math.max(0, Math.min(255, b)),
      a: Math.max(0, Math.min(1, a))
    };
  }

  function srgbToLinear(c) {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }

  function relativeLuminance(rgb) {
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(fgRgb, bgRgb) {
    const L1 = relativeLuminance(fgRgb);
    const L2 = relativeLuminance(bgRgb);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function getEffectiveBackgroundRgb(el, computed) {
    // Walk up until we find a non-transparent background.
    let cur = el;
    while (cur) {
      const cs = cur === el ? computed : cur.ownerDocument.defaultView.getComputedStyle(cur);
      const bg = parseCssColor(cs.backgroundColor);
      if (bg && bg.a > 0.01) return { r: bg.r, g: bg.g, b: bg.b };
      cur = cur.parentElement;
    }

    // Fallback to --umb-bg by sampling root computed background.
    const root = el?.ownerDocument?.documentElement;
    if (root) {
      const cs = el.ownerDocument.defaultView.getComputedStyle(root);
      const bg = parseCssColor(cs.backgroundColor);
      if (bg) return { r: bg.r, g: bg.g, b: bg.b };
    }
    return { r: 0, g: 0, b: 0 };
  }

  function elementHasText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && String(node.nodeValue || "").trim()) return true;
    }
    return false;
  }

  function shouldSkipTextElement(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName;
    if (!tag) return true;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return true;
    if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "SVG" || tag === "PATH") return true;
    if (el.closest?.("svg")) return true;
    return false;
  }

  function isLightBackground(bgRgb) {
    // Phase 4 v2: Threshold 0.45 balances coverage and precision
    // Pure white is 1.0, light gray is ~0.7, medium is ~0.4, dark gray is ~0.2
    // This catches white and light backgrounds while avoiding medium grays
    return relativeLuminance(bgRgb) > 0.45;
  }

  function isSurfaceLike(el, computed) {
    const cs = computed || getComputedStyle(el);

    // Check surface characteristics: rounded corners, borders, shadows
    const br = parseFloat(cs.borderRadius) || 0;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const shadow = String(cs.boxShadow || "").trim();
    if (br > 0 || bw > 0 || (shadow && shadow !== "none")) return true;

    // Check for common card/panel class names and data attributes
    const classList = String(el.className || "");
    const tag = el.tagName?.toLowerCase() || "";

    // Expanded pattern to catch more modern component classes
    if (/\b(card|panel|widget|box|surface|tile|chip|alert|badge|callout|container|dropdown|menu|cscore|score|module|item|entry|post|article|section|wrapper|block)\b/i.test(classList)) {
      return true;
    }

    // Check for semantic article/section tags with backgrounds
    if ((tag === "article" || tag === "section" || tag === "aside" || tag === "nav") && el.childElementCount > 0) {
      return true;
    }

    // Check for padding that suggests a contained surface (more lenient threshold)
    const pd = parseFloat(cs.paddingTop) || parseFloat(cs.paddingBottom) || parseFloat(cs.paddingLeft) || parseFloat(cs.paddingRight) || 0;
    if (pd > 8) return true;

    // Check for elements with explicit dimensions (likely intentional surfaces)
    const width = parseFloat(cs.width) || 0;
    const height = parseFloat(cs.height) || 0;
    if (width > 100 && height > 50) return true;

    return false;
  }

  function hasParentWithDarkBackground(el, win) {
    // Check if any ancestor has a dark background
    // If so, this light background element should be darkened to maintain contrast
    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      const cs = win.getComputedStyle(parent);
      const bg = parseCssColor(cs.backgroundColor);
      if (bg && bg.a > 0.5) {
        const lum = relativeLuminance(bg);
        if (lum < 0.3) return true; // Parent is dark
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function hasExplicitLightBackground(el) {
    // Check if element has an explicit white/light background set via inline style
    const inlineStyle = el.style?.backgroundColor;
    if (!inlineStyle) return false;

    const lower = inlineStyle.toLowerCase().replace(/\s/g, "");

    // Check for named colors
    if (lower === "white" || lower === "whitesmoke" || lower === "snow" || lower === "ivory") return true;

    // Check for hex values (white and near-white)
    if (lower === "#fff" || lower === "#ffffff" || lower === "#fefefe" || lower === "#fafafa" || lower === "#f5f5f5") return true;

    // Check for rgb/rgba white and near-white
    if (lower.startsWith("rgb(255,255,255") || lower.startsWith("rgb(254,254,254") || lower.startsWith("rgb(250,250,250")) return true;
    if (lower.startsWith("rgba(255,255,255") || lower.startsWith("rgba(254,254,254") || lower.startsWith("rgba(250,250,250")) return true;

    return false;
  }

  function fixNestedLightBackgrounds(el, win, cs) {
    // Recursively check children for light backgrounds that should also be darkened
    const children = el.children;
    if (!children || children.length === 0) return;

    for (const child of children) {
      if (shouldSkipTextElement(child)) continue;

      const childCs = win.getComputedStyle(child);
      const childBg = parseCssColor(childCs.backgroundColor);

      if (childBg && childBg.a > 0.01) {
        const childBgRgb = { r: childBg.r, g: childBg.g, b: childBg.b };
        const childLum = relativeLuminance(childBgRgb);
        const isPureWhite = childLum > 0.9;
        const isLight = isLightBackground(childBgRgb);

        // Fix nested light backgrounds (be aggressive for nested content)
        if (isPureWhite || isLight) {
          const surface = isSurfaceLike(child, childCs) || elementHasText(child) || child.matches?.("button, input, textarea, select");
          child.setAttribute(FIX_ATTR_BG, surface ? "2" : "1");
          // Recurse into this child
          fixNestedLightBackgrounds(child, win, childCs);
        }
      }
    }
  }

  function fixContrastInRoot(rootNode) {
    const scope = rootNode instanceof ShadowRoot ? rootNode : rootNode?.documentElement ?? rootNode;
    if (!scope) return;

    const win = (rootNode instanceof ShadowRoot ? rootNode.host?.ownerDocument?.defaultView : rootNode?.defaultView) ?? window;
    const elementsToCheck = new Set();

    const doc = rootNode instanceof ShadowRoot ? rootNode.ownerDocument || document : (rootNode?.ownerDocument || document);
    const walker = doc.createTreeWalker(
      scope,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return String(node.nodeValue || "").trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (p) elementsToCheck.add(p);
    }

    // Phase 4: Lower contrast threshold from 4.0 to 3.0 for more aggressive fixes
    const CONTRAST_THRESHOLD = 3.0;

    for (const el of elementsToCheck) {
      if (shouldSkipTextElement(el)) continue;

      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      if (!el.getClientRects || el.getClientRects().length === 0) continue;

      const fg = parseCssColor(cs.color);
      if (!fg) continue;

      const bg = getEffectiveBackgroundRgb(el, cs);
      const ratio = contrastRatio({ r: fg.r, g: fg.g, b: fg.b }, bg);

      // Only intervene when contrast is poor.
      if (ratio >= CONTRAST_THRESHOLD) continue;

      const isLink = el.tagName === "A" || el.closest?.("a");
      if (isLink) {
        el.setAttribute(FIX_ATTR_LINK, "1");
      } else {
        el.setAttribute(FIX_ATTR_FG, "1");
      }
    }

    // Background pass: darken elements that have light backgrounds.
    // Phase 4 v2: No element limit - scan all elements for comprehensive coverage
    let seen = 0;
    let fixed = 0;
    let skipped = 0;
    const ew = doc.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let el = ew.currentNode; el; el = ew.nextNode()) {
      seen++;
      if (shouldSkipTextElement(el)) continue;

      const cs = win.getComputedStyle(el);
      // Skip truly hidden elements but allow display:none elements that might become visible
      if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;

      const bg = parseCssColor(cs.backgroundColor);
      if (!bg || bg.a <= 0.01) continue;

      const bgRgb = { r: bg.r, g: bg.g, b: bg.b };
      const lum = relativeLuminance(bgRgb);
      const hasExplicitWhite = hasExplicitLightBackground(el);
      const isPureWhite = lum > 0.9; // Pure white or near-white
      const isLight = isLightBackground(bgRgb); // Uses 0.45 threshold
      const surface = isSurfaceLike(el, cs);

      // Phase 4 v2: More aggressive fixing strategy
      if (hasExplicitWhite || isPureWhite || isLight) {
        // Always fix if:
        // 1. Pure white (>0.9 luminance) - these are always intentional light backgrounds
        // 2. Explicit white via inline styles
        // 3. Surface-like (cards, panels, etc) with any light background
        // 4. Has text content and is light
        const shouldAlwaysFix = isPureWhite || hasExplicitWhite || surface || elementHasText(el);

        // Only skip if it's a light (but not pure white) non-surface element with dark parent
        // This preserves intentional light accents on dark backgrounds
        if (!shouldAlwaysFix && hasParentWithDarkBackground(el, win)) {
          skipped++;
          continue;
        }

        // Prefer bg2 for card-like surfaces and interactive elements, bg for flat containers
        const useBg2 = surface || elementHasText(el) || el.matches?.("button, input, textarea, select");
        el.setAttribute(FIX_ATTR_BG, useBg2 ? "2" : "1");
        fixed++;

        // Phase 4 v2: Recursively fix nested light backgrounds
        fixNestedLightBackgrounds(el, win, cs);
      }
    }

    // Debug logging (Phase 4 v2) - temporary for testing
    if (fixed > 0 || skipped > 0) {
      console.log(`[Umbreon] Background pass: ${fixed} fixed, ${skipped} skipped, ${seen} scanned`);
    }
  }

  function scheduleFixAllText() {
    if (fixScheduled) return;
    fixScheduled = true;
    setTimeout(() => {
      fixScheduled = false;
      if (document.documentElement.getAttribute(UMB_ATTR) !== "on") return;
      try {
        fixContrastInRoot(document);
        // Also fix any existing open shadow roots.
        const nodes = document.querySelectorAll("*");
        for (const el of nodes) {
          if (el.shadowRoot) fixContrastInRoot(el.shadowRoot);
        }
      } catch {
        // ignore
      }
    }, 50);
  }

  // Phase 4: Multiple contrast fix passes for late-loading content
  let fixPassTimeouts = [];

  function scheduleMultipleFixPasses() {
    // Clear any pending passes
    for (const t of fixPassTimeouts) {
      clearTimeout(t);
    }
    fixPassTimeouts = [];

    // Schedule multiple passes: immediate, 500ms, 1000ms, 2000ms
    const delays = [0, 500, 1000, 2000];
    for (const delay of delays) {
      const t = setTimeout(() => {
        if (document.documentElement.getAttribute(UMB_ATTR) !== "on") return;
        try {
          fixContrastInRoot(document);
          const nodes = document.querySelectorAll("*");
          for (const el of nodes) {
            if (el.shadowRoot) fixContrastInRoot(el.shadowRoot);
          }
        } catch {
          // ignore
        }
      }, delay);
      fixPassTimeouts.push(t);
    }
  }

  function injectShadowStyles(startNode) {
    const pending = [startNode || document.documentElement];
    while (pending.length) {
      const node = pending.pop();
      if (!node) continue;

      // If this is a shadow root, ensure our style exists.
      if (node instanceof ShadowRoot) {
        const styleEl = ensureStyleElInRoot(node, SHADOW_STYLE_ID);
        if (styleEl) styleEl.textContent = shadowCss();
        fixContrastInRoot(node);
      }

      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.currentNode; el; el = walker.nextNode()) {
        if (el.shadowRoot) pending.push(el.shadowRoot);
      }
    }
  }

  function ensureAttachShadowPatched() {
    const PATCH_KEY = "__umbreon_attachShadow_patched__";
    if (globalThis[PATCH_KEY]) return;
    globalThis[PATCH_KEY] = true;

    const original = Element.prototype.attachShadow;
    if (typeof original !== "function") return;

    Element.prototype.attachShadow = function (...args) {
      const root = original.apply(this, args);
      try {
        injectShadowStyles(root);
        fixContrastInRoot(root);
      } catch {
        // ignore
      }
      return root;
    };
  }

  function clearFixAttributesInRoot(rootNode) {
    const scope = rootNode instanceof ShadowRoot ? rootNode : rootNode?.documentElement ?? rootNode;
    if (!scope) return;
    try {
      const sel = `[${FIX_ATTR_FG}], [${FIX_ATTR_LINK}], [${FIX_ATTR_BG}]`;
      const nodes = scope.querySelectorAll?.(sel) ?? [];
      for (const el of nodes) {
        el.removeAttribute(FIX_ATTR_FG);
        el.removeAttribute(FIX_ATTR_LINK);
        el.removeAttribute(FIX_ATTR_BG);
      }
    } catch {
      // ignore
    }
  }

  function startMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver(() => {
      scheduleFixAllText();
    });
    mutationObserver.observe(document.documentElement, { subtree: true, childList: true });
  }

  function stopMutationObserver() {
    try {
      mutationObserver?.disconnect?.();
    } catch {
      // ignore
    }
    mutationObserver = null;
  }

  function themeCss(themeId) {
    // These are duplicated from theme files so we can run without fetch.
    // (MV3 content scripts can't reliably fetch extension resources on every site.)
    switch (themeId) {
      case "amoled":
        return `:root[${UMB_ATTR}="on"]{--umb-bg:#000;--umb-bg2:#090909;--umb-text:#f2f2f2;--umb-muted:#bdbdbd;--umb-link:#9ad0ff;--umb-border:#1d1d1d;--umb-shadow:rgba(0,0,0,.55);}`;
      case "dim":
        return `:root[${UMB_ATTR}="on"]{--umb-bg:#0b1220;--umb-bg2:#101a2e;--umb-text:#e9eefc;--umb-muted:#b7c2dd;--umb-link:#7dd3fc;--umb-border:#1f2a44;--umb-shadow:rgba(0,0,0,.4);}`;
      case "sepia":
        return `:root[${UMB_ATTR}="on"]{--umb-bg:#14110d;--umb-bg2:#1b160f;--umb-text:#f0e6d6;--umb-muted:#d0c1aa;--umb-link:#f6c177;--umb-border:#2a2318;--umb-shadow:rgba(0,0,0,.35);}`;
      case "classic":
      default:
        return `:root[${UMB_ATTR}="on"]{--umb-bg:#0f1115;--umb-bg2:#141821;--umb-text:#e6eaf2;--umb-muted:#aeb8cc;--umb-link:#8ab4f8;--umb-border:#2a3140;--umb-shadow:rgba(0,0,0,.35);}`;
    }
  }

  function apply(enabled, themeId) {
    const root = document.documentElement;

    // Clear any pending fix passes
    for (const t of fixPassTimeouts) {
      clearTimeout(t);
    }
    fixPassTimeouts = [];

    if (!enabled) {
      root.removeAttribute(UMB_ATTR);
      const base = document.getElementById(STYLE_ID);
      const theme = document.getElementById(THEME_ID);
      if (base) base.remove();
      if (theme) theme.remove();

      stopMutationObserver();

      // Remove any targeted fix attributes we added.
      clearFixAttributesInRoot(document);

      // Best-effort: remove any shadow-root injected styles.
      try {
        const nodes = document.querySelectorAll("*");
        for (const el of nodes) {
          const sr = el.shadowRoot;
          sr?.querySelector?.(`#${CSS.escape(SHADOW_STYLE_ID)}`)?.remove?.();
          if (sr) clearFixAttributesInRoot(sr);
        }
      } catch {
        // ignore
      }
      return;
    }

    root.setAttribute(UMB_ATTR, "on");

    // Reset previous fix passes so re-application works correctly.
    clearFixAttributesInRoot(document);
    try {
      const nodes = document.querySelectorAll("*");
      for (const el of nodes) {
        if (el.shadowRoot) clearFixAttributesInRoot(el.shadowRoot);
      }
    } catch {
      // ignore
    }

    const baseEl = ensureStyleEl(STYLE_ID);
    baseEl.textContent = baseCss();

    const themeEl = ensureStyleEl(THEME_ID);
    themeEl.textContent = themeCss(themeId);

    // Fix text colors inside open Shadow DOM trees.
    ensureAttachShadowPatched();
    injectShadowStyles(document.documentElement);

    // Phase 4: Schedule multiple fix passes for late-loading content
    scheduleMultipleFixPasses();
    startMutationObserver();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MessageType.APPLY) return;
    apply(!!msg.enabled, msg.themeId || "classic");
    sendResponse?.({ ok: true });
    return true;
  });
})();
