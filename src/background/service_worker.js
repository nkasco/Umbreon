import { MessageType } from "../shared/messaging.js";
import { getPageKey, getOrigin, ruleMatchesUrl } from "../shared/url_match.js";
import {
  getSettings,
  setSettings,
  getTabOverrides,
  setTabOverride,
  clearTabOverride
} from "../shared/storage.js";

async function hasAllSitesPermission() {
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}

function isRestrictedUrl(rawUrl) {
  if (!rawUrl) return true;
  return (
    rawUrl.startsWith("chrome://") ||
    rawUrl.startsWith("edge://") ||
    rawUrl.startsWith("about:") ||
    rawUrl.startsWith("chrome-extension://") ||
    rawUrl.startsWith("https://chrome.google.com/webstore")
  );
}

async function computeEffectiveState(tabId, url) {
  const settings = await getSettings();
  const origin = getOrigin(url);
  const pageKey = getPageKey(url);
  const tabOverrides = await getTabOverrides();
  const override = tabOverrides?.[String(tabId)]?.enabled;

  const disabledByOrigin = origin ? settings.disableOrigins.includes(origin) : false;
  const disabledByPage = pageKey ? settings.disablePages.includes(pageKey) : false;

  const autoActivateMatch = settings.autoActivateRules.some((rule) => ruleMatchesUrl(rule, url));

  // If the user explicitly toggled this tab, that wins (unless the URL is restricted).
  if (typeof override === "boolean") {
    return {
      enabled: override && !disabledByOrigin && !disabledByPage,
      disabledByOrigin,
      disabledByPage,
      autoActivateMatch,
      themeId: settings.themeId,
      nightlightEnabled: settings.nightlightEnabled,
      intenseMode: settings.intenseMode
    };
  }

  const canAuto = await hasAllSitesPermission();

  const enabled =
    !disabledByOrigin &&
    !disabledByPage &&
    ((settings.nightlightEnabled && canAuto) || (autoActivateMatch && canAuto));

  return {
    enabled,
    disabledByOrigin,
    disabledByPage,
    autoActivateMatch,
    themeId: settings.themeId,
    nightlightEnabled: settings.nightlightEnabled,
    intenseMode: settings.intenseMode
  };
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["src/content/content.js"]
  });
}

async function applyToTab(tabId, enabled, themeId, intenseMode) {
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: MessageType.APPLY,
    enabled,
    themeId,
    intenseMode
  });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabOverride(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab?.url || isRestrictedUrl(tab.url)) return;

  const state = await computeEffectiveState(tabId, tab.url);
  if (!state.enabled) return;

  // Auto-apply only if we have permission; computeEffectiveState already checks.
  try {
    await applyToTab(tabId, true, state.themeId, state.intenseMode);
  } catch {
    // ignore: permission not granted or injection blocked
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === MessageType.GET_STATE) {
      const tabId = msg.tabId ?? sender?.tab?.id;
      const url = msg.url ?? sender?.tab?.url;
      if (!tabId || !url || isRestrictedUrl(url)) {
        sendResponse({
          ok: true,
          supported: false,
          enabled: false,
          themeId: (await getSettings()).themeId
        });
        return;
      }
      const state = await computeEffectiveState(tabId, url);
      sendResponse({ ok: true, supported: true, ...state, hasAllSites: await hasAllSitesPermission() });
      return;
    }

    if (msg.type === MessageType.SET_TAB_OVERRIDE) {
      const tabId = msg.tabId ?? sender?.tab?.id;
      const url = msg.url ?? sender?.tab?.url;
      if (!tabId || !url || isRestrictedUrl(url)) {
        sendResponse({ ok: false, error: "unsupported" });
        return;
      }

      await setTabOverride(tabId, !!msg.enabled);
      const state = await computeEffectiveState(tabId, url);
      await applyToTab(tabId, state.enabled, state.themeId, state.intenseMode);
      sendResponse({ ok: true, ...state });
      return;
    }

    if (msg.type === MessageType.SET_DISABLE_RULE) {
      const settings = await getSettings();
      const url = msg.url ?? sender?.tab?.url;
      if (!url) {
        sendResponse({ ok: false, error: "missing_url" });
        return;
      }

      const origin = getOrigin(url);
      const pageKey = getPageKey(url);

      if (msg.scope === "origin" && origin) {
        const next = new Set(settings.disableOrigins);
        msg.disabled ? next.add(origin) : next.delete(origin);
        await setSettings({ disableOrigins: [...next] });
      }

      if (msg.scope === "page" && pageKey) {
        const next = new Set(settings.disablePages);
        msg.disabled ? next.add(pageKey) : next.delete(pageKey);
        await setSettings({ disablePages: [...next] });
      }

      // Clear any tab override so the disable takes effect.
      if (sender?.tab?.id) await clearTabOverride(sender.tab.id);

      sendResponse({ ok: true, settings: await getSettings() });
      return;
    }

    if (msg.type === MessageType.SET_THEME) {
      const themeId = String(msg.themeId || "classic");
      await setSettings({ themeId });

      const settings = await getSettings();

      // If invoked from popup, re-apply to current tab.
      const tabId = sender?.tab?.id ?? msg.tabId;
      const url = sender?.tab?.url ?? msg.url;
      if (tabId && url && !isRestrictedUrl(url)) {
        const state = await computeEffectiveState(tabId, url);
        if (state.enabled) {
          try {
            await applyToTab(tabId, true, themeId, settings.intenseMode);
          } catch {
            // ignore
          }
        }
      }

      sendResponse({ ok: true, themeId });
      return;
    }

    if (msg.type === MessageType.SET_INTENSE_MODE) {
      const intenseMode = !!msg.intenseMode;
      await setSettings({ intenseMode });

      // If invoked from the popup, re-apply to current tab.
      const tabId = sender?.tab?.id ?? msg.tabId;
      const url = sender?.tab?.url ?? msg.url;
      if (tabId && url && !isRestrictedUrl(url)) {
        const state = await computeEffectiveState(tabId, url);
        if (state.enabled) {
          try {
            await applyToTab(tabId, true, state.themeId, intenseMode);
          } catch {
            // ignore
          }
        }
      }

      sendResponse({ ok: true, intenseMode });
      return;
    }

    if (msg.type === MessageType.SET_NIGHTLIGHT) {
      const nightlightEnabled = !!msg.nightlightEnabled;
      await setSettings({ nightlightEnabled });
      sendResponse({ ok: true, nightlightEnabled, hasAllSites: await hasAllSitesPermission() });
      return;
    }

    if (msg.type === MessageType.ADD_AUTOACTIVATE) {
      const settings = await getSettings();
      const rule = String(msg.rule || "").trim();
      if (!rule) {
        sendResponse({ ok: false, error: "empty_rule" });
        return;
      }
      const next = Array.from(new Set([...settings.autoActivateRules, rule]));
      await setSettings({ autoActivateRules: next });
      sendResponse({ ok: true, autoActivateRules: next });
      return;
    }

    if (msg.type === MessageType.REMOVE_AUTOACTIVATE) {
      const settings = await getSettings();
      const rule = String(msg.rule || "").trim();
      const next = settings.autoActivateRules.filter((r) => r !== rule);
      await setSettings({ autoActivateRules: next });
      sendResponse({ ok: true, autoActivateRules: next });
      return;
    }

    if (msg.type === MessageType.OPTIONS_GET_SETTINGS) {
      sendResponse({ ok: true, settings: await getSettings(), hasAllSites: await hasAllSitesPermission() });
      return;
    }

    if (msg.type === MessageType.OPTIONS_SET_SETTINGS) {
      const patch = msg.patch && typeof msg.patch === "object" ? msg.patch : {};
      const next = await setSettings(patch);
      sendResponse({ ok: true, settings: next, hasAllSites: await hasAllSitesPermission() });
      return;
    }
  })()
    .catch((err) => {
      sendResponse?.({ ok: false, error: String(err?.message || err) });
    });

  return true;
});
