const SETTINGS_KEY = "umbreon.settings.v1";

export function defaultSettings() {
  return {
    version: 1,
    nightlightEnabled: false,
    intenseMode: false,
    themeId: "classic",
    autoActivateRules: [],
    disableOrigins: [],
    disablePages: []
  };
}

export async function getSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = result?.[SETTINGS_KEY];

  if (!stored || typeof stored !== "object") {
    const defaults = defaultSettings();
    await chrome.storage.sync.set({ [SETTINGS_KEY]: defaults });
    return defaults;
  }

  return { ...defaultSettings(), ...stored };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, version: 1 };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getTabOverrides() {
  const result = await chrome.storage.session.get("umbreon.tabOverrides");
  return result?.["umbreon.tabOverrides"] ?? {};
}

export async function setTabOverride(tabId, enabled) {
  const overrides = await getTabOverrides();
  overrides[String(tabId)] = { enabled: !!enabled, updatedAt: Date.now() };
  await chrome.storage.session.set({ "umbreon.tabOverrides": overrides });
}

export async function clearTabOverride(tabId) {
  const overrides = await getTabOverrides();
  delete overrides[String(tabId)];
  await chrome.storage.session.set({ "umbreon.tabOverrides": overrides });
}
