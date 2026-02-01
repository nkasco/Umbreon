import { MessageType } from "../shared/messaging.js";
import { getOrigin } from "../shared/url_match.js";
import { applyUiTheme } from "../shared/ui_theme.js";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setDisabled(disabled) {
  document.getElementById("toggleBtn").disabled = disabled;
  document.getElementById("themeSelect").disabled = disabled;
  document.getElementById("autoEnableSite").disabled = disabled;
}

async function refresh() {
  const tab = await getActiveTab();
  const supported = tab?.id && tab?.url;

  if (!supported) {
    setDisabled(true);
    return;
  }

  const siteLabel = document.getElementById("siteLabel");
  siteLabel.textContent = getOrigin(tab.url) || tab.url;

  const state = await chrome.runtime.sendMessage({
    type: MessageType.GET_STATE,
    tabId: tab.id,
    url: tab.url
  });

  applyUiTheme(state?.themeId || "classic");

  if (!state?.supported) {
    setDisabled(true);
    document.getElementById("statusHint").textContent = "Not supported on this page.";
    return;
  }

  setDisabled(false);

  document.getElementById("themeSelect").value = state.themeId || "classic";

  // Update status hint to show if it's auto-enabled or manual
  let statusText = state.enabled ? "Enabled" : "Disabled";
  if (state.enabled) {
    if (state.autoActivateMatch) {
      statusText += " (Auto)";
    } else if (state.nightlightEnabled && state.hasAllSites) {
      statusText += " (Nightlight)";
    } else {
      statusText += " (Manual)";
    }
  }
  document.getElementById("statusHint").textContent = statusText;
  document.getElementById("toggleBtn").textContent = state.enabled ? "Turn off" : "Turn on";

  // Auto-enable button state
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

  const permHint = document.getElementById("permHint");
  if (state.nightlightEnabled && !state.hasAllSites) {
    permHint.textContent = "Nightlight is on, but Umbreon needs permission to run on all sites.";
  } else {
    permHint.textContent = "";
  }
}

document.getElementById("toggleBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id || !tab?.url) return;

  const state = await chrome.runtime.sendMessage({ type: MessageType.GET_STATE, tabId: tab.id, url: tab.url });
  const nextEnabled = !state.enabled;

  await chrome.runtime.sendMessage({
    type: MessageType.SET_TAB_OVERRIDE,
    tabId: tab.id,
    url: tab.url,
    enabled: nextEnabled
  });

  await refresh();
});

document.getElementById("themeSelect").addEventListener("change", async (e) => {
  const tab = await getActiveTab();
  await chrome.runtime.sendMessage({
    type: MessageType.SET_THEME,
    themeId: e.target.value,
    tabId: tab?.id,
    url: tab?.url
  });

  applyUiTheme(e.target.value);

  await refresh();
});

document.getElementById("openOptions").addEventListener("click", async () => {
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  }
});

document.getElementById("autoEnableSite").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id || !tab?.url) return;

  const origin = getOrigin(tab.url);
  if (!origin) return;

  const btn = document.getElementById("autoEnableSite");

  if (btn.dataset.action === "add") {
    // Request <all_urls> permission if not already granted
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) return;

    await chrome.runtime.sendMessage({
      type: MessageType.ADD_AUTOACTIVATE,
      rule: origin
    });

    // Also enable dark mode on the current tab immediately
    await chrome.runtime.sendMessage({
      type: MessageType.SET_TAB_OVERRIDE,
      tabId: tab.id,
      url: tab.url,
      enabled: true
    });
  } else {
    await chrome.runtime.sendMessage({
      type: MessageType.REMOVE_AUTOACTIVATE,
      rule: origin
    });
  }

  await refresh();
});

refresh();
