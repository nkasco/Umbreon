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
  const INTENSE_ATTR = "data-umbreon-intense";
  const STYLE_ID = "umbreon-style";
  const THEME_ID = "umbreon-theme";
  const SHADOW_STYLE_ID = "umbreon-shadow-style";

  let mutationObserver = null;
  let fixScheduled = false;
  let intenseMode = false;

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
    // Aggressive dark mode: force dark background/text across most elements.
    // This is intentionally heavy-handed to make "all dark mode" work on more sites.
    const host = String(globalThis.location?.hostname || "");
    const invertCanvas = /(^|\.)docs\.google\.com$/i.test(host) || /(^|\.)sheets\.google\.com$/i.test(host);
    return `
:root[${UMB_ATTR}="on"] {
  color-scheme: dark;
}

:root[${UMB_ATTR}="on"],
:root[${UMB_ATTR}="on"] body {
  background: var(--umb-bg) !important;
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
}


:root[${UMB_ATTR}="on"] [${FIX_ATTR_FG}] {
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
}

:root[${UMB_ATTR}="on"] [${FIX_ATTR_LINK}] {
  color: var(--umb-link) !important;
  -webkit-text-fill-color: var(--umb-link) !important;
}

:root[${UMB_ATTR}="on"] [${FIX_ATTR_BG}="1"] {
  background: var(--umb-bg) !important;
}

:root[${UMB_ATTR}="on"] [${FIX_ATTR_BG}="2"] {
  background: var(--umb-bg2) !important;
}

:root[${UMB_ATTR}="on"] a {
  color: var(--umb-link) !important;
  -webkit-text-fill-color: var(--umb-link) !important;
}

:root[${UMB_ATTR}="on"] pre,
:root[${UMB_ATTR}="on"] code {
  background: var(--umb-bg2) !important;
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
}

:root[${UMB_ATTR}="on"] input,
:root[${UMB_ATTR}="on"] textarea,
:root[${UMB_ATTR}="on"] select,
:root[${UMB_ATTR}="on"] button {
  background: var(--umb-bg2) !important;
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
  caret-color: var(--umb-text) !important;
  border-color: var(--umb-border) !important;
}

:root[${UMB_ATTR}="on"] input:-webkit-autofill,
:root[${UMB_ATTR}="on"] textarea:-webkit-autofill,
:root[${UMB_ATTR}="on"] select:-webkit-autofill {
  -webkit-text-fill-color: var(--umb-text) !important;
  caret-color: var(--umb-text) !important;
  box-shadow: 0 0 0 1000px var(--umb-bg2) inset !important;
  transition: background-color 999999s ease-out 0s !important;
}

:root[${UMB_ATTR}="on"] input:-webkit-autofill,
:root[${UMB_ATTR}="on"] textarea:-webkit-autofill,
:root[${UMB_ATTR}="on"] select:-webkit-autofill {
  -webkit-text-fill-color: var(--umb-text) !important;
  caret-color: var(--umb-text) !important;
  box-shadow: 0 0 0 1000px var(--umb-bg2) inset !important;
  transition: background-color 999999s ease-out 0s !important;
}

:root[${UMB_ATTR}="on"] input::placeholder,
:root[${UMB_ATTR}="on"] textarea::placeholder {
  color: var(--umb-muted) !important;
  -webkit-text-fill-color: var(--umb-muted) !important;
  opacity: 1 !important;
}

:root[${UMB_ATTR}="on"] * {
  border-color: var(--umb-border) !important;
}

:root[${UMB_ATTR}="on"] ::selection {
  background: rgba(138, 180, 248, 0.35) !important;
}

:root[${UMB_ATTR}="on"] img,
:root[${UMB_ATTR}="on"] video,
:root[${UMB_ATTR}="on"] canvas,
:root[${UMB_ATTR}="on"] svg {
  filter: none !important;
}
${invertCanvas ? `
:root[${UMB_ATTR}="on"] canvas {
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

:host-context(${on}) :host {
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
}

:host-context(${on}) * {
  border-color: var(--umb-border) !important;
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

:host-context(${on}) a {
  color: var(--umb-link) !important;
  -webkit-text-fill-color: var(--umb-link) !important;
}

:host-context(${on}) pre,
:host-context(${on}) code {
  background: var(--umb-bg2) !important;
}

:host-context(${on}) input,
:host-context(${on}) textarea,
:host-context(${on}) select,
:host-context(${on}) button {
  background: var(--umb-bg2) !important;
  color: var(--umb-text) !important;
  -webkit-text-fill-color: var(--umb-text) !important;
  caret-color: var(--umb-text) !important;
  border-color: var(--umb-border) !important;
}

:host-context(${on}) input::placeholder,
:host-context(${on}) textarea::placeholder {
  color: var(--umb-muted) !important;
  -webkit-text-fill-color: var(--umb-muted) !important;
  opacity: 1 !important;
}

:host-context(${on}) input:-webkit-autofill,
:host-context(${on}) textarea:-webkit-autofill,
:host-context(${on}) select:-webkit-autofill {
  -webkit-text-fill-color: var(--umb-text) !important;
  caret-color: var(--umb-text) !important;
  box-shadow: 0 0 0 1000px var(--umb-bg2) inset !important;
  transition: background-color 999999s ease-out 0s !important;
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
    return relativeLuminance(bgRgb) > 0.62;
  }

  function isSurfaceLike(el, computed) {
    const cs = computed || getComputedStyle(el);
    const br = parseFloat(cs.borderRadius) || 0;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const shadow = String(cs.boxShadow || "").trim();
    return br > 0 || bw > 0 || (shadow && shadow !== "none");
  }

  function fixContrastInRoot(rootNode, intense) {
    const scope = rootNode instanceof ShadowRoot ? rootNode : rootNode?.documentElement ?? rootNode;
    if (!scope) return;

    const win = (rootNode instanceof ShadowRoot ? rootNode.host?.ownerDocument?.defaultView : rootNode?.defaultView) ?? window;
    const elementsToCheck = new Set();

    const walker = (rootNode instanceof ShadowRoot ? rootNode.ownerDocument : document).createTreeWalker(
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

    for (const el of elementsToCheck) {
      if (shouldSkipTextElement(el)) continue;

      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      if (!el.getClientRects || el.getClientRects().length === 0) continue;

      const fg = parseCssColor(cs.color);
      if (!fg) continue;

      const bg = getEffectiveBackgroundRgb(el, cs);
      if (!intense) {
        const ratio = contrastRatio({ r: fg.r, g: fg.g, b: fg.b }, bg);
        // Only intervene when contrast is poor.
        if (ratio >= 4.0) continue;
      }

      const isLink = el.tagName === "A" || el.closest?.("a");
      if (isLink) {
        el.setAttribute(FIX_ATTR_LINK, "1");
      } else {
        el.setAttribute(FIX_ATTR_FG, "1");
      }
    }

    // Background pass: only darken elements that actually paint light backgrounds.
    const maxElements = intense ? 4000 : 2500;
    let seen = 0;
    const ew = (rootNode instanceof ShadowRoot ? rootNode : document).createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let el = ew.currentNode; el; el = ew.nextNode()) {
      if (++seen > maxElements) break;
      if (shouldSkipTextElement(el)) continue;

      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;

      const bg = parseCssColor(cs.backgroundColor);
      if (!bg || bg.a <= 0.01) continue;

      const bgRgb = { r: bg.r, g: bg.g, b: bg.b };
      if (!intense && !isLightBackground(bgRgb)) continue;

      // Prefer bg2 for card-like surfaces, bg for flat containers.
      const surface = isSurfaceLike(el, cs) || elementHasText(el) || el.matches?.("button, input, textarea, select");
      el.setAttribute(FIX_ATTR_BG, surface ? "2" : "1");
    }
  }

  function scheduleFixAllText() {
    if (fixScheduled) return;
    fixScheduled = true;
    setTimeout(() => {
      fixScheduled = false;
      if (document.documentElement.getAttribute(UMB_ATTR) !== "on") return;
      try {
        fixContrastInRoot(document, intenseMode);
        // Also fix any existing open shadow roots.
        const nodes = document.querySelectorAll("*");
        for (const el of nodes) {
          if (el.shadowRoot) fixContrastInRoot(el.shadowRoot, intenseMode);
        }
      } catch {
        // ignore
      }
    }, 50);
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
        fixContrastInRoot(node, intenseMode);
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
        fixContrastInRoot(root, intenseMode);
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

  function apply(enabled, themeId, nextIntenseMode) {
    const root = document.documentElement;
    intenseMode = !!nextIntenseMode;

    if (!enabled) {
      root.removeAttribute(UMB_ATTR);
      root.removeAttribute(INTENSE_ATTR);
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
    if (intenseMode) root.setAttribute(INTENSE_ATTR, "on");
    else root.removeAttribute(INTENSE_ATTR);

    // Reset previous fix passes so toggling Intense Mode can take effect.
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

    // Fix low-contrast text while preserving intentional colors.
    scheduleFixAllText();
    startMutationObserver();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MessageType.APPLY) return;
    apply(!!msg.enabled, msg.themeId || "classic", !!msg.intenseMode);
    sendResponse?.({ ok: true });
    return true;
  });
})();
