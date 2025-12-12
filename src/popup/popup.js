import { MessageType } from "../shared/messaging.js";
import { getOrigin } from "../shared/url_match.js";
import { applyUiTheme } from "../shared/ui_theme.js";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setDisabled(disabled) {
  document.getElementById("toggleBtn").disabled = disabled;
  document.getElementById("disableSite").disabled = disabled;
  document.getElementById("disablePage").disabled = disabled;
  document.getElementById("themeSelect").disabled = disabled;
  document.getElementById("intenseMode").disabled = disabled;
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
  document.getElementById("disableSite").checked = !!state.disabledByOrigin;
  document.getElementById("disablePage").checked = !!state.disabledByPage;
  document.getElementById("intenseMode").checked = !!state.intenseMode;

  document.getElementById("statusHint").textContent = state.enabled ? "Enabled" : "Disabled";
  document.getElementById("toggleBtn").textContent = state.enabled ? "Turn off" : "Turn on";

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

document.getElementById("disableSite").addEventListener("change", async (e) => {
  const tab = await getActiveTab();
  if (!tab?.url) return;

  await chrome.runtime.sendMessage({
    type: MessageType.SET_DISABLE_RULE,
    scope: "origin",
    url: tab.url,
    disabled: e.target.checked
  });

  await refresh();
});

document.getElementById("disablePage").addEventListener("change", async (e) => {
  const tab = await getActiveTab();
  if (!tab?.url) return;

  await chrome.runtime.sendMessage({
    type: MessageType.SET_DISABLE_RULE,
    scope: "page",
    url: tab.url,
    disabled: e.target.checked
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

document.getElementById("intenseMode").addEventListener("change", async (e) => {
  const tab = await getActiveTab();
  await chrome.runtime.sendMessage({
    type: MessageType.SET_INTENSE_MODE,
    intenseMode: e.target.checked,
    tabId: tab?.id,
    url: tab?.url
  });

  await refresh();
});

document.getElementById("openOptions").addEventListener("click", async () => {
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  }
});

refresh();
