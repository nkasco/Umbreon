import { MessageType } from "../shared/messaging.js";
import { normalizeRuleInput } from "../shared/url_match.js";
import { applyUiTheme } from "../shared/ui_theme.js";

async function load() {
  const res = await chrome.runtime.sendMessage({ type: MessageType.OPTIONS_GET_SETTINGS });
  if (!res?.ok) return;

  const { settings, hasAllSites } = res;
  applyUiTheme(settings.themeId || "classic");
  document.getElementById("nightlight").checked = !!settings.nightlightEnabled;
  document.getElementById("theme").value = settings.themeId || "classic";
  document.getElementById("intenseMode").checked = !!settings.intenseMode;

  renderRules(settings.autoActivateRules || []);
  renderNightlightHint(!!settings.nightlightEnabled, !!hasAllSites);
}

function renderNightlightHint(nightlightEnabled, hasAllSites) {
  const hint = document.getElementById("nightlightHint");
  if (!nightlightEnabled) {
    hint.textContent = "";
    return;
  }
  if (hasAllSites) {
    hint.textContent = "Umbreon has permission to run on all sites.";
    return;
  }
  hint.textContent = "Nightlight requires permission to run on all sites. You will be prompted when enabling.";
}

function renderRules(rules) {
  const list = document.getElementById("rulesList");
  list.innerHTML = "";

  for (const rule of rules) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.className = "code";
    span.textContent = rule;

    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: MessageType.REMOVE_AUTOACTIVATE, rule });
      await refresh();
    });

    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function refresh() {
  await load();
}

document.getElementById("nightlight").addEventListener("change", async (e) => {
  const enabled = e.target.checked;

  if (enabled) {
    // Request optional host permission for Nightlight.
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) {
      e.target.checked = false;
      await chrome.runtime.sendMessage({ type: MessageType.SET_NIGHTLIGHT, nightlightEnabled: false });
      await refresh();
      return;
    }
  }

  await chrome.runtime.sendMessage({ type: MessageType.SET_NIGHTLIGHT, nightlightEnabled: enabled });
  await refresh();
});

document.getElementById("theme").addEventListener("change", async (e) => {
  const themeId = e.target.value;
  await chrome.runtime.sendMessage({ type: MessageType.SET_THEME, themeId });
  applyUiTheme(themeId);
});

document.getElementById("intenseMode").addEventListener("change", async (e) => {
  await chrome.runtime.sendMessage({
    type: MessageType.SET_INTENSE_MODE,
    intenseMode: e.target.checked
  });
  await refresh();
});

document.getElementById("addRule").addEventListener("click", async () => {
  const input = document.getElementById("ruleInput");
  const normalized = normalizeRuleInput(input.value);
  if (!normalized) return;

  // Auto-activation needs permission to run on pages without user click.
  const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
  if (!granted) return;

  await chrome.runtime.sendMessage({ type: MessageType.ADD_AUTOACTIVATE, rule: normalized });
  input.value = "";
  await refresh();
});

load();
