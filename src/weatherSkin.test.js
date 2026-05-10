import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWeatherCategory,
  resolveWeatherSkinState,
  getWeatherPresentation,
  shouldRenderWeatherClouds,
} from "./weatherSkin.js";

test("normalizeWeatherCategory maps backend categories into demo visual buckets", () => {
  assert.equal(normalizeWeatherCategory("rain"), "lightRain");
  assert.equal(normalizeWeatherCategory("heavyRain"), "heavyRain");
  assert.equal(normalizeWeatherCategory("cloudy"), "cloudy");
  assert.equal(normalizeWeatherCategory("snow"), "snow");
  assert.equal(normalizeWeatherCategory("unknown"), "sunny");
});

test("resolveWeatherSkinState prefers preview weather and preview time over real weather", () => {
  const state = resolveWeatherSkinState({
    weatherEnabled: true,
    realWeatherCategory: "cloudy",
    previewWeatherCategory: "heavyRain",
    clockTime: 9.5,
    previewTime: 22.2,
  });

  assert.equal(state.category, "heavyRain");
  assert.equal(state.time, 22.2);
  assert.equal(state.source, "preview");
  assert.equal(state.isNight, true);
});

test("resolveWeatherSkinState falls back to neutral disabled state when weather is off", () => {
  const state = resolveWeatherSkinState({
    weatherEnabled: false,
    realWeatherCategory: "heavyRain",
    previewWeatherCategory: "snow",
    clockTime: 11,
    previewTime: 20,
  });

  assert.equal(state.category, "disabled");
  assert.equal(state.source, "disabled");
  assert.equal(state.isNight, false);
});

test("shouldRenderWeatherClouds hides decorative clouds during rainy weather", () => {
  assert.equal(shouldRenderWeatherClouds("cloudy"), true);
  assert.equal(shouldRenderWeatherClouds("lightRain"), false);
  assert.equal(shouldRenderWeatherClouds("heavyRain"), false);
  assert.equal(shouldRenderWeatherClouds("rain"), false);
  assert.equal(shouldRenderWeatherClouds("sunny"), false);
  assert.equal(shouldRenderWeatherClouds("snow"), false);
  assert.equal(shouldRenderWeatherClouds("disabled"), false);
});

test("getWeatherPresentation keeps weather visuals independent from UI theme", () => {
  const azure = getWeatherPresentation("azure", {
    category: "heavyRain",
    time: 19,
    isNight: true,
    source: "real",
  });
  const violet = getWeatherPresentation("violet", {
    category: "heavyRain",
    time: 19,
    isNight: true,
    source: "real",
  });

  assert.deepEqual(azure.skyClassNames, violet.skyClassNames);
  assert.equal(azure.surfaceTone, "storm");
  assert.equal(violet.surfaceTone, "storm");
  assert.notEqual(azure.accentColor, violet.accentColor);
  assert.equal(azure.textTone, "light");
});

test("getWeatherPresentation strengthens rainy daytime surfaces across panel modules", () => {
  const rain = getWeatherPresentation("azure", {
    category: "lightRain",
    time: 14,
    isNight: false,
    source: "real",
  }, 0.15);

  assert.equal(rain.timePhase, "day");
  assert.equal(
    rain.surfaceVars["--demo-shell-bg"],
    "rgba(214, 232, 248, calc(0.54 * var(--panel-opacity)))",
  );
  assert.equal(
    rain.surfaceVars["--demo-header-bg"],
    "rgba(214, 232, 248, calc(0.78 * var(--panel-opacity)))",
  );
  assert.equal(
    rain.surfaceVars["--demo-results-bg-end"],
    "rgba(214, 232, 248, calc(0.66 * var(--panel-opacity)))",
  );
  assert.equal(
    rain.surfaceVars["--demo-card-bg"],
    "rgba(242, 248, 255, calc(0.82 * var(--panel-opacity)))",
  );
  assert.equal(
    rain.surfaceVars["--demo-summary-text"],
    "rgba(248, 252, 255, 0.92)",
  );
  assert.equal(
    rain.surfaceVars["--demo-summary-shadow"],
    "0 1px 2px rgba(2, 8, 23, 0.48)",
  );
  assert.equal(
    rain.surfaceVars["--weather-sky-base"],
    "linear-gradient(135deg, #2e5f7d, #7ea6b7)",
  );
  assert.equal(
    rain.surfaceVars["--weather-scrim-bg"],
    "linear-gradient(180deg, rgba(18, 53, 73, 0.28), rgba(18, 53, 73, 0.18))",
  );
  assert.equal(
    rain.surfaceVars["--weather-cloud-opacity"],
    "0.58",
  );
});

test("getWeatherPresentation coordinates night weather with dark readable surfaces", () => {
  const rainNight = getWeatherPresentation("azure", {
    category: "lightRain",
    time: 22,
    isNight: true,
    source: "real",
  }, 0.72);

  assert.equal(rainNight.timePhase, "night");
  assert.equal(rainNight.textTone, "light");
  assert.equal(
    rainNight.surfaceVars["--demo-shell-bg"],
    "rgba(20, 37, 58, calc(0.64 * var(--panel-opacity)))",
  );
  assert.equal(
    rainNight.surfaceVars["--demo-sidebar-bg"],
    "rgba(20, 37, 58, calc(0.80 * var(--panel-opacity)))",
  );
  assert.equal(
    rainNight.surfaceVars["--demo-card-bg"],
    "rgba(24, 43, 66, calc(0.76 * var(--panel-opacity)))",
  );
  assert.equal(
    rainNight.surfaceVars["--demo-summary-text"],
    "rgba(248, 252, 255, 0.92)",
  );
  assert.equal(
    rainNight.surfaceVars["--demo-summary-shadow"],
    "0 1px 2px rgba(2, 8, 23, 0.48)",
  );
  assert.equal(
    rainNight.surfaceVars["--weather-sky-base"],
    "linear-gradient(135deg, #10263d, #1e3b55)",
  );
  assert.equal(
    rainNight.surfaceVars["--weather-scrim-bg"],
    "linear-gradient(180deg, rgba(2, 8, 23, 0.20), rgba(2, 8, 23, 0.10))",
  );
  assert.equal(
    rainNight.surfaceVars["--weather-cloud-opacity"],
    "0.46",
  );
});

test("getWeatherPresentation shifts cloudy surfaces by time phase", () => {
  const cloudyDay = getWeatherPresentation("azure", {
    category: "cloudy",
    time: 12,
    isNight: false,
    source: "real",
  }, 0.15);
  const cloudyDusk = getWeatherPresentation("azure", {
    category: "cloudy",
    time: 17.5,
    isNight: false,
    source: "real",
  }, 0.35);

  assert.equal(cloudyDay.timePhase, "day");
  assert.equal(cloudyDusk.timePhase, "dusk");
  assert.notEqual(
    cloudyDay.surfaceVars["--demo-header-bg"],
    cloudyDusk.surfaceVars["--demo-header-bg"],
  );
  assert.equal(
    cloudyDusk.surfaceVars["--demo-header-bg"],
    "rgba(218, 226, 240, calc(0.74 * var(--panel-opacity)))",
  );
});

test("getWeatherPresentation uses sky-overlay summary text for cloudy weather", () => {
  const cloudyDay = getWeatherPresentation("azure", {
    category: "cloudy",
    time: 12,
    isNight: false,
    source: "real",
  }, 0.15);
  const sunnyDay = getWeatherPresentation("azure", {
    category: "sunny",
    time: 12,
    isNight: false,
    source: "real",
  }, 0);

  assert.equal(
    cloudyDay.surfaceVars["--demo-summary-text"],
    "rgba(248, 252, 255, 0.92)",
  );
  assert.equal(
    cloudyDay.surfaceVars["--demo-summary-shadow"],
    "0 1px 2px rgba(2, 8, 23, 0.48)",
  );
  assert.equal(
    sunnyDay.surfaceVars["--demo-summary-text"],
    "rgba(16, 35, 58, 0.76)",
  );
  assert.equal(
    sunnyDay.surfaceVars["--demo-summary-shadow"],
    "0 1px 2px rgba(255, 255, 255, 0.42)",
  );
});
