import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWeatherCategory,
  resolveWeatherSkinState,
  getWeatherPresentation,
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
