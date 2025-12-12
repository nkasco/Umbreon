const THEME_VARS = Object.freeze({
  classic: {
    "--umb-bg": "#0f1115",
    "--umb-bg2": "#141821",
    "--umb-text": "#e6eaf2",
    "--umb-muted": "#aeb8cc",
    "--umb-link": "#8ab4f8",
    "--umb-border": "#2a3140"
  },
  amoled: {
    "--umb-bg": "#000000",
    "--umb-bg2": "#090909",
    "--umb-text": "#f2f2f2",
    "--umb-muted": "#bdbdbd",
    "--umb-link": "#9ad0ff",
    "--umb-border": "#1d1d1d"
  },
  dim: {
    "--umb-bg": "#0b1220",
    "--umb-bg2": "#101a2e",
    "--umb-text": "#e9eefc",
    "--umb-muted": "#b7c2dd",
    "--umb-link": "#7dd3fc",
    "--umb-border": "#1f2a44"
  },
  sepia: {
    "--umb-bg": "#14110d",
    "--umb-bg2": "#1b160f",
    "--umb-text": "#f0e6d6",
    "--umb-muted": "#d0c1aa",
    "--umb-link": "#f6c177",
    "--umb-border": "#2a2318"
  }
});

export function applyUiTheme(themeId) {
  const vars = THEME_VARS[String(themeId)] ?? THEME_VARS.classic;
  const root = document.documentElement;
  root.setAttribute("data-umbreon-theme", String(themeId || "classic"));
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
