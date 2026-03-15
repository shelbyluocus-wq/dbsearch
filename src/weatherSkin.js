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

export function normalizeWeatherCategory(category) {
  const key = String(category || "").trim().toLowerCase();
  return WEATHER_CATEGORY_MAP[key] || "sunny";
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
    skyClassNames: ["weather-sky", `weather-sky--${state.category}`, state.isNight ? "is-night" : "is-day"],
  };
}
