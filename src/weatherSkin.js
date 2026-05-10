const WEATHER_CATEGORY_MAP = {
  sunny: "sunny",
  clear: "sunny",
  cloud: "cloudy",
  cloudy: "cloudy",
  overcast: "cloudy",
  rain: "lightRain",
  lightrain: "lightRain",
  drizzle: "lightRain",
  heavyrain: "heavyRain",
  storm: "heavyRain",
  thunderstorm: "heavyRain",
  snow: "snow",
  sleet: "snow",
};

const UI_THEME_ACCENTS = {
  azure: "#0284c7",
  midnight: "#475569",
  emerald: "#059669",
  violet: "#7c3aed",
  typewrite_dark: "#d8a657",
  typewrite_light: "#b77939",
};

const DARK_THEMES = new Set(["midnight", "typewrite_dark"]);

const WEATHER_SURFACE_PRESETS = {
  disabled: { surfaceTone: "neutral", textTone: "dark", glassMix: "var(--glass-neutral)" },
  sunny: { surfaceTone: "sunny", textTone: "dark", glassMix: "var(--weather-sunny-glass)" },
  cloudy: { surfaceTone: "cloudy", textTone: "dark", glassMix: "var(--weather-cloudy-glass)" },
  lightRain: { surfaceTone: "rain", textTone: "dark", glassMix: "var(--weather-rain-glass)" },
  heavyRain: { surfaceTone: "storm", textTone: "light", glassMix: "var(--weather-storm-glass)" },
  snow: { surfaceTone: "snow", textTone: "dark", glassMix: "var(--weather-snow-glass)" },
};

const BASE_LIGHT_ALPHA = {
  shell: 0.42,
  shellBorder: 0.60,
  header: 0.66,
  sidebar: 0.60,
  sidebarEnd: 0.52,
  results: 0.58,
  resultsEnd: 0.50,
  toolbar: 0.56,
  tabstrip: 0.52,
  footer: 0.62,
  input: 0.78,
  inputBorder: 0.66,
  card: 0.76,
  cardHover: 0.84,
  cardBorder: 0.62,
  shellShadow: 0.34,
  cardShadow: 0.12,
};

const BASE_DARK_ALPHA = {
  shell: 0.64,
  shellBorder: 0.22,
  header: 0.82,
  sidebar: 0.80,
  sidebarEnd: 0.72,
  results: 0.76,
  resultsEnd: 0.68,
  toolbar: 0.72,
  tabstrip: 0.68,
  footer: 0.80,
  input: 0.78,
  inputBorder: 0.34,
  card: 0.76,
  cardHover: 0.84,
  cardBorder: 0.24,
  shellShadow: 0.44,
  cardShadow: 0.22,
};

const WEATHER_SURFACE_PROFILES = {
  disabled: {
    skyBase: {
      dawn: "linear-gradient(135deg, #dbeafe, #f8fafc)",
      day: "linear-gradient(135deg, #dbeafe, #f8fafc)",
      dusk: "linear-gradient(135deg, #cbd5e1, #f8fafc)",
      night: "linear-gradient(135deg, #1e293b, #334155)",
    },
    scrim: {
      dawn: "linear-gradient(180deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.06))",
      day: "linear-gradient(180deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.06))",
      dusk: "linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.04))",
      night: "linear-gradient(180deg, rgba(2, 6, 23, 0.14), rgba(2, 6, 23, 0.08))",
    },
    cloudOpacity: {
      dawn: 0.62,
      day: 0.58,
      dusk: 0.54,
      night: 0.42,
    },
    lightRgb: {
      dawn: "255, 255, 255",
      day: "255, 255, 255",
      dusk: "255, 255, 255",
      night: "255, 255, 255",
    },
    darkRgb: {
      dawn: "30, 41, 59",
      day: "30, 41, 59",
      dusk: "30, 41, 59",
      night: "30, 41, 59",
    },
    lightCardRgb: "255, 255, 255",
    darkCardRgb: "30, 41, 59",
    lightAlpha: BASE_LIGHT_ALPHA,
    darkAlpha: BASE_DARK_ALPHA,
  },
  sunny: {
    skyBase: {
      dawn: "linear-gradient(135deg, #38bdf8, #fdba74)",
      day: "linear-gradient(135deg, #38bdf8, #bae6fd)",
      dusk: "linear-gradient(135deg, #4338ca, #fb923c)",
      night: "linear-gradient(135deg, #0f172a, #1e293b)",
    },
    scrim: {
      dawn: "linear-gradient(180deg, rgba(255, 250, 235, 0.12), rgba(255, 250, 235, 0.06))",
      day: "linear-gradient(180deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.04))",
      dusk: "linear-gradient(180deg, rgba(80, 32, 8, 0.14), rgba(80, 32, 8, 0.08))",
      night: "linear-gradient(180deg, rgba(2, 6, 23, 0.18), rgba(2, 6, 23, 0.08))",
    },
    cloudOpacity: {
      dawn: 0.54,
      day: 0.48,
      dusk: 0.44,
      night: 0.34,
    },
    lightRgb: {
      dawn: "255, 241, 226",
      day: "255, 250, 232",
      dusk: "255, 232, 214",
      night: "232, 239, 248",
    },
    darkRgb: {
      dawn: "42, 50, 69",
      day: "42, 50, 69",
      dusk: "36, 43, 63",
      night: "24, 34, 52",
    },
    lightCardRgb: "255, 255, 255",
    darkCardRgb: "30, 43, 64",
    lightAlpha: BASE_LIGHT_ALPHA,
    darkAlpha: BASE_DARK_ALPHA,
  },
  cloudy: {
    skyBase: {
      dawn: "linear-gradient(135deg, #7ba8bf, #c5d6e4)",
      day: "linear-gradient(135deg, #789cb1, #c2d3df)",
      dusk: "linear-gradient(135deg, #526b88, #a6b7ca)",
      night: "linear-gradient(135deg, #17283e, #34475e)",
    },
    scrim: {
      dawn: "linear-gradient(180deg, rgba(22, 51, 69, 0.20), rgba(22, 51, 69, 0.12))",
      day: "linear-gradient(180deg, rgba(22, 51, 69, 0.22), rgba(22, 51, 69, 0.14))",
      dusk: "linear-gradient(180deg, rgba(15, 23, 42, 0.20), rgba(15, 23, 42, 0.12))",
      night: "linear-gradient(180deg, rgba(2, 8, 23, 0.20), rgba(2, 8, 23, 0.10))",
    },
    cloudOpacity: {
      dawn: 0.58,
      day: 0.54,
      dusk: 0.48,
      night: 0.40,
    },
    lightRgb: {
      dawn: "232, 240, 246",
      day: "226, 236, 246",
      dusk: "218, 226, 240",
      night: "220, 231, 243",
    },
    darkRgb: {
      dawn: "30, 42, 59",
      day: "30, 42, 59",
      dusk: "27, 38, 56",
      night: "22, 32, 48",
    },
    lightCardRgb: "246, 250, 255",
    darkCardRgb: "28, 44, 66",
    lightAlpha: {
      ...BASE_LIGHT_ALPHA,
      shell: 0.50,
      header: 0.74,
      sidebar: 0.72,
      sidebarEnd: 0.64,
      results: 0.68,
      resultsEnd: 0.60,
      footer: 0.70,
      card: 0.80,
      cardHover: 0.88,
      cardShadow: 0.14,
    },
    darkAlpha: BASE_DARK_ALPHA,
  },
  lightRain: {
    skyBase: {
      dawn: "linear-gradient(135deg, #386987, #89afc0)",
      day: "linear-gradient(135deg, #2e5f7d, #7ea6b7)",
      dusk: "linear-gradient(135deg, #234864, #637f97)",
      night: "linear-gradient(135deg, #10263d, #1e3b55)",
    },
    scrim: {
      dawn: "linear-gradient(180deg, rgba(18, 53, 73, 0.24), rgba(18, 53, 73, 0.16))",
      day: "linear-gradient(180deg, rgba(18, 53, 73, 0.28), rgba(18, 53, 73, 0.18))",
      dusk: "linear-gradient(180deg, rgba(8, 25, 45, 0.26), rgba(8, 25, 45, 0.16))",
      night: "linear-gradient(180deg, rgba(2, 8, 23, 0.20), rgba(2, 8, 23, 0.10))",
    },
    cloudOpacity: {
      dawn: 0.62,
      day: 0.58,
      dusk: 0.52,
      night: 0.46,
    },
    lightRgb: {
      dawn: "220, 235, 248",
      day: "214, 232, 248",
      dusk: "205, 222, 240",
      night: "202, 221, 242",
    },
    darkRgb: {
      dawn: "24, 42, 64",
      day: "24, 42, 64",
      dusk: "22, 39, 61",
      night: "20, 37, 58",
    },
    lightCardRgb: "242, 248, 255",
    darkCardRgb: "24, 43, 66",
    lightAlpha: {
      ...BASE_LIGHT_ALPHA,
      shell: 0.54,
      shellBorder: 0.66,
      header: 0.78,
      sidebar: 0.76,
      sidebarEnd: 0.68,
      results: 0.72,
      resultsEnd: 0.66,
      toolbar: 0.68,
      tabstrip: 0.64,
      footer: 0.74,
      input: 0.84,
      card: 0.82,
      cardHover: 0.90,
      cardShadow: 0.16,
    },
    darkAlpha: BASE_DARK_ALPHA,
  },
  heavyRain: {
    skyBase: {
      dawn: "linear-gradient(135deg, #223c5f, #506a8f)",
      day: "linear-gradient(135deg, #1d3658, #4a6389)",
      dusk: "linear-gradient(135deg, #142745, #364f73)",
      night: "linear-gradient(135deg, #07162b, #1f3556)",
    },
    scrim: {
      dawn: "linear-gradient(180deg, rgba(2, 8, 23, 0.24), rgba(2, 8, 23, 0.14))",
      day: "linear-gradient(180deg, rgba(2, 8, 23, 0.28), rgba(2, 8, 23, 0.16))",
      dusk: "linear-gradient(180deg, rgba(2, 8, 23, 0.28), rgba(2, 8, 23, 0.18))",
      night: "linear-gradient(180deg, rgba(2, 8, 23, 0.24), rgba(2, 8, 23, 0.14))",
    },
    cloudOpacity: {
      dawn: 0.50,
      day: 0.48,
      dusk: 0.44,
      night: 0.38,
    },
    lightRgb: {
      dawn: "58, 78, 105",
      day: "58, 78, 105",
      dusk: "48, 66, 94",
      night: "42, 58, 84",
    },
    darkRgb: {
      dawn: "18, 34, 56",
      day: "18, 34, 56",
      dusk: "15, 29, 50",
      night: "13, 25, 44",
    },
    lightCardRgb: "77, 98, 127",
    darkCardRgb: "20, 36, 59",
    lightAlpha: {
      ...BASE_LIGHT_ALPHA,
      shell: 0.58,
      header: 0.76,
      sidebar: 0.74,
      sidebarEnd: 0.66,
      results: 0.70,
      resultsEnd: 0.62,
      card: 0.72,
      cardHover: 0.80,
    },
    darkAlpha: {
      ...BASE_DARK_ALPHA,
      shell: 0.66,
      header: 0.84,
      sidebar: 0.82,
      sidebarEnd: 0.74,
      results: 0.78,
      resultsEnd: 0.70,
      footer: 0.82,
      card: 0.78,
      cardHover: 0.86,
      shellShadow: 0.50,
      cardShadow: 0.26,
    },
  },
  snow: {
    skyBase: {
      dawn: "linear-gradient(135deg, #d8eefb, #ffffff)",
      day: "linear-gradient(135deg, #cfe5f5, #ffffff)",
      dusk: "linear-gradient(135deg, #9fb7d4, #edf4ff)",
      night: "linear-gradient(135deg, #1e3148, #52667f)",
    },
    scrim: {
      dawn: "linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.10))",
      day: "linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.10))",
      dusk: "linear-gradient(180deg, rgba(30, 41, 59, 0.12), rgba(30, 41, 59, 0.06))",
      night: "linear-gradient(180deg, rgba(2, 8, 23, 0.16), rgba(2, 8, 23, 0.08))",
    },
    cloudOpacity: {
      dawn: 0.58,
      day: 0.54,
      dusk: 0.48,
      night: 0.38,
    },
    lightRgb: {
      dawn: "248, 251, 255",
      day: "248, 251, 255",
      dusk: "238, 244, 255",
      night: "232, 241, 255",
    },
    darkRgb: {
      dawn: "38, 49, 66",
      day: "38, 49, 66",
      dusk: "34, 45, 62",
      night: "30, 40, 56",
    },
    lightCardRgb: "255, 255, 255",
    darkCardRgb: "38, 52, 70",
    lightAlpha: {
      ...BASE_LIGHT_ALPHA,
      shell: 0.48,
      header: 0.72,
      sidebar: 0.68,
      sidebarEnd: 0.60,
      results: 0.64,
      resultsEnd: 0.56,
      footer: 0.68,
      card: 0.82,
      cardHover: 0.90,
    },
    darkAlpha: BASE_DARK_ALPHA,
  },
};

function normalizeHour(time) {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return 12;
  return ((numeric % 24) + 24) % 24;
}

export function resolveWeatherTimePhase(time) {
  const hour = normalizeHour(time);
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 16 && hour < 19.5) return "dusk";
  if (hour >= 19.5 || hour < 5) return "night";
  return "day";
}

function formatAlpha(value) {
  return Number(value).toFixed(2);
}

function cssPanelRgba(rgb, alpha) {
  return `rgba(${rgb}, calc(${formatAlpha(alpha)} * var(--panel-opacity)))`;
}

function cssShadowRgba(rgb, alpha) {
  return `rgba(${rgb}, ${formatAlpha(alpha)})`;
}

function shouldUseLightSummaryText(category, timePhase, textTone) {
  if (textTone === "light") return true;
  if (timePhase === "night" || timePhase === "dusk") return category !== "disabled";
  return category === "cloudy" || category === "lightRain" || category === "heavyRain";
}

function buildWeatherSurfaceVars(category, timePhase, textTone) {
  const profile = WEATHER_SURFACE_PROFILES[category] || WEATHER_SURFACE_PROFILES.sunny;
  const toneKey = textTone === "light" ? "dark" : "light";
  const rgb = profile[`${toneKey}Rgb`]?.[timePhase] || profile[`${toneKey}Rgb`]?.day || profile.lightRgb.day;
  const cardRgb = profile[`${toneKey}CardRgb`] || rgb;
  const alpha = profile[`${toneKey}Alpha`] || BASE_LIGHT_ALPHA;
  const skyBase = profile.skyBase?.[timePhase] || profile.skyBase?.day || "linear-gradient(135deg, #38bdf8, #bae6fd)";
  const scrim = profile.scrim?.[timePhase] || profile.scrim?.day || "transparent";
  const cloudOpacity = profile.cloudOpacity?.[timePhase] ?? profile.cloudOpacity?.day ?? 0.5;
  const borderRgb = "255, 255, 255";
  const shadowRgb = textTone === "light" ? "2, 6, 23" : "15, 23, 42";
  const lightSummaryText = shouldUseLightSummaryText(category, timePhase, textTone);
  const summaryText = lightSummaryText ? "rgba(248, 252, 255, 0.92)" : "rgba(16, 35, 58, 0.76)";
  const summaryShadow = lightSummaryText
    ? "0 1px 2px rgba(2, 8, 23, 0.48)"
    : "0 1px 2px rgba(255, 255, 255, 0.42)";

  return {
    "--weather-sky-base": skyBase,
    "--weather-scrim-bg": scrim,
    "--weather-cloud-opacity": formatAlpha(cloudOpacity),
    "--demo-shell-bg": cssPanelRgba(rgb, alpha.shell),
    "--demo-shell-border": cssPanelRgba(borderRgb, alpha.shellBorder),
    "--demo-shell-shadow": `0 30px 60px -15px ${cssShadowRgba(shadowRgb, alpha.shellShadow)}`,
    "--demo-header-bg": cssPanelRgba(rgb, alpha.header),
    "--demo-sidebar-bg": cssPanelRgba(rgb, alpha.sidebar),
    "--demo-sidebar-bg-end": cssPanelRgba(rgb, alpha.sidebarEnd),
    "--demo-results-bg": cssPanelRgba(rgb, alpha.results),
    "--demo-results-bg-end": cssPanelRgba(rgb, alpha.resultsEnd),
    "--demo-toolbar-bg": cssPanelRgba(rgb, alpha.toolbar),
    "--demo-tabstrip-bg": cssPanelRgba(rgb, alpha.tabstrip),
    "--demo-footer-bg": cssPanelRgba(rgb, alpha.footer),
    "--demo-input-bg": cssPanelRgba(cardRgb, alpha.input),
    "--demo-input-border": cssPanelRgba(borderRgb, alpha.inputBorder),
    "--demo-card-bg": cssPanelRgba(cardRgb, alpha.card),
    "--demo-card-hover": cssPanelRgba(cardRgb, alpha.cardHover),
    "--demo-card-border": cssPanelRgba(borderRgb, alpha.cardBorder),
    "--demo-card-shadow": `0 18px 40px ${cssShadowRgba(shadowRgb, alpha.cardShadow)}`,
    "--demo-summary-text": summaryText,
    "--demo-summary-shadow": summaryShadow,
  };
}

export function normalizeWeatherCategory(category) {
  const key = String(category || "").trim().toLowerCase();
  return WEATHER_CATEGORY_MAP[key] || "sunny";
}

export function shouldRenderWeatherClouds(category) {
  const key = String(category || "").trim().toLowerCase();
  if (!key || key === "disabled") return false;
  return normalizeWeatherCategory(key) === "cloudy";
}

export function resolveWeatherSkinState({
  weatherEnabled = true,
  realWeatherCategory = "sunny",
  previewWeatherCategory = "",
  clockTime = 12,
  previewTime = null,
} = {}) {
  if (!weatherEnabled) {
    return {
      category: "disabled",
      time: Number.isFinite(clockTime) ? clockTime : 12,
      source: "disabled",
      isNight: false,
    };
  }

  const hasPreviewWeather = !!String(previewWeatherCategory || "").trim();
  const hasPreviewTime = Number.isFinite(previewTime);
  const category = normalizeWeatherCategory(hasPreviewWeather ? previewWeatherCategory : realWeatherCategory);
  const time = hasPreviewTime ? previewTime : (Number.isFinite(clockTime) ? clockTime : 12);

  return {
    category,
    time,
    source: hasPreviewWeather || hasPreviewTime ? "preview" : "real",
    isNight: time < 6 || time > 18,
  };
}

export function getWeatherPresentation(uiThemeId, weatherSkinState, skyDarkness = 0) {
  const state = weatherSkinState || resolveWeatherSkinState();
  const preset = WEATHER_SURFACE_PRESETS[state.category] || WEATHER_SURFACE_PRESETS.sunny;
  const timePhase = resolveWeatherTimePhase(state.time);

  // Switch to light text when sky is dark enough (threshold 0.5 ≈ 20:00)
  // or when using a dark theme without weather mode
  let textTone;
  if (preset.textTone === "light") {
    textTone = "light";                              // heavy rain always light
  } else if (state.category === "disabled" && DARK_THEMES.has(uiThemeId)) {
    textTone = "light";                              // dark theme without weather → light
  } else {
    textTone = skyDarkness > 0.5 ? "light" : "dark"; // weather mode → driven by sky
  }

  return {
    accentColor: UI_THEME_ACCENTS[uiThemeId] || UI_THEME_ACCENTS.azure,
    surfaceTone: preset.surfaceTone,
    textTone,
    glassMix: preset.glassMix,
    timePhase,
    surfaceVars: buildWeatherSurfaceVars(state.category, timePhase, textTone),
    skyClassNames: ["weather-sky", `weather-sky--${state.category}`, state.isNight ? "is-night" : "is-day"],
  };
}
