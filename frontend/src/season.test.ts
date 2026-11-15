import { Color, MeshStandardMaterial, ShaderLib, Vector3 } from "three";
import { expect, test } from "vitest";

import {
  applyCloudShader,
  applyFoliageShader,
  applyGroundShader,
  applyRootShader,
  applySoilShader,
  buildAnemometerRotorGeometry,
  buildBareBranchGeometry,
  buildBroadleafCrownGeometry,
  buildCumulusCloudGeometry,
  buildCutawayStreakGeometry,
  buildFarmsteadParts,
  buildHorizonRidgeGeometry,
  buildRainStreaksGeometry,
  buildRainStreaksMaterial,
  buildSedimentFanGeometry,
  buildShrubGeometry,
  buildSkyDomeMaterial,
  buildTopsoilGeometry,
  buildWeatherStationBodyGeometry,
  buildWindbreakConiferGeometry,
  clampLabelBottomY,
  getCropGeometry,
  getCrownGeometry,
  getRootGeometry,
  getRootVariantGeometry,
  lerpCameraPose,
  PlantCanopyPhysics,
  plantsPerCell,
  PrecipitationPhysics,
  resolveLabelScreenPositions,
  stepSpringScalar,
  TERRAIN_EXTENT,
  TERRAIN_FOG_FAR,
  TERRAIN_FOG_NEAR,
  terrainHillY,
} from "./FieldScene";
import {
  compareTally,
  computeFittedCamera,
  computeZoomBounds,
  cycleYears,
  describe,
  keyMoments,
  plotFrame,
  plotWetness,
  rootProfile,
  ROOTS_SOIL_EXAGGERATION,
  shortStateLabel,
  SOIL_DEPTH,
  SOIL_TOP,
  soilExaggeration,
  sunElevationDeg,
  tally,
  waterBalance,
  weatherFrame,
  yearCropLabel,
} from "./season";
import { RESPONSE } from "./testData";

const [baseline, option] = RESPONSE.strategies;
const conditions = RESPONSE.conditions;

test("cycle covers all rotations when short, else the longest one", () => {
  expect(cycleYears(2, 3)).toBe(6);
  expect(cycleYears(2, 2)).toBe(2);
  expect(cycleYears(4, 5)).toBe(5);
  expect(cycleYears(2, 2, 3)).toBe(6);
  expect(cycleYears(2, 3, 4)).toBe(4);
});

test("plot frame follows the calendar and wraps the rotation", () => {
  expect(plotFrame(baseline, 6)).toMatchObject({ crop: "corn", state: "crop", rotationYear: 1 });
  expect(plotFrame(baseline, 12 + 6)).toMatchObject({ crop: "soybean", rotationYear: 2 });
  expect(plotFrame(baseline, 24 + 6)).toMatchObject({ crop: "corn", rotationYear: 1 });
});

test("a full crop is ripe in its last month before harvest", () => {
  expect(plotFrame(baseline, 8).ripe).toBe(true); // corn in September, bare in October
  expect(plotFrame(baseline, 7).ripe).toBe(false);
});

test("weather frame reads the month's data", () => {
  expect(weatherFrame(conditions, 12 + 5)).toMatchObject({ month: 5, rainMm: 130, frost: false });
  expect(weatherFrame(conditions, 0).frost).toBe(true);
});

test("tally counts water, bare months and bare months in heavy-rain months", () => {
  const year = tally(baseline, conditions, 11);
  // Corn: bare Jan–Apr and Oct–Dec, sown in May (counted as bare: little cover).
  expect(year.bareMonths).toBe(8);
  // Heavy-rain months in the test data: Apr, May, Oct; corn is bare or just sown in all three.
  expect(year.soilAtRisk).toBe(3);
  expect(year.waterMm).toBe(Math.round(baseline.calendar[0].reduce((sum, m) => sum + m.water_mm, 0)));
  expect(tally(option, conditions, 11).bareMonths).toBeLessThan(year.bareMonths);
});

test("describe gives plain words for each state", () => {
  const names = { corn: "Corn (grain)" };
  expect(describe(plotFrame(baseline, 0), names)).toBe("Bare soil");
  expect(describe(plotFrame(baseline, 4), names)).toBe("Corn (grain), just sown (little cover yet)");
  expect(describe(plotFrame(baseline, 8), names)).toBe("Corn (grain), ready to harvest");
  expect(describe(plotFrame(option, 0), names)).toBe("Rye cover crop, protecting the soil");
});

test("compareTally computes exact running differences relative to baseline", () => {
  const baseTally = tally(baseline, conditions, 11);
  const optTally = tally(option, conditions, 11);
  const diff = compareTally(optTally, baseTally);

  expect(diff.waterDiffMm).toBe(optTally.waterMm - baseTally.waterMm);
  expect(diff.bareMonthsDiff).toBeLessThan(0);
  expect(diff.soilAtRiskDiff).toBeLessThan(0);
});

test("shortStateLabel returns concise state strings for 3D plot tags", () => {
  const names = { corn: "Corn (grain)" };
  expect(shortStateLabel(plotFrame(baseline, 0), names)).toBe("Bare soil");
  expect(shortStateLabel(plotFrame(baseline, 4), names)).toBe("Corn (grain) · Just sown");
  expect(shortStateLabel(plotFrame(baseline, 5), names)).toBe("Corn (grain) · Growing");
  expect(shortStateLabel(plotFrame(baseline, 6), names)).toBe("Corn (grain) · Full canopy");
  expect(shortStateLabel(plotFrame(baseline, 8), names)).toBe("Corn (grain) · Ready to harvest");
  expect(shortStateLabel(plotFrame(option, 0), names)).toBe("Rye cover crop · Living cover");
});

test("rootProfile computes FAO-56 rooting depth, architecture, and nitrogen fixation from crop state", () => {
  expect(rootProfile(plotFrame(baseline, 0))).toEqual({
    maxDepthM: 0,
    activeDepthM: 0,
    nitrogenFixing: false,
    architecture: "none",
  });
  expect(rootProfile(plotFrame(baseline, 6))).toEqual({
    maxDepthM: 1.2,
    activeDepthM: 1.2,
    nitrogenFixing: false,
    architecture: "fibrous",
  });
  expect(rootProfile(plotFrame(baseline, 12 + 6))).toEqual({
    maxDepthM: 0.9,
    activeDepthM: 0.9,
    nitrogenFixing: true,
    architecture: "taproot",
  });
  expect(rootProfile(plotFrame(option, 0))).toEqual({
    maxDepthM: 1.0,
    activeDepthM: 0.35,
    nitrogenFixing: false,
    architecture: "fibrous",
  });
});

test("botanical Three.js geometry builders generate valid distinct BufferGeometries for crops, crowns, and roots", () => {
  const cropShapes = [
    "corn_stalk",
    "sorghum_stalk",
    "cereal_tillers",
    "soybean_bush",
    "pea_vine",
    "canola_stalk",
    "alfalfa_clump",
    "rye_tuft",
  ] as const;
  const cropCounts = cropShapes.map((shape) => {
    const geom = getCropGeometry(shape);
    const pos = geom.getAttribute("position");
    const norm = geom.getAttribute("normal");
    expect(pos.count).toBeGreaterThan(20);
    expect(norm.count).toBe(pos.count);
    return pos.count;
  });
  expect(new Set(cropCounts).size).toBeGreaterThanOrEqual(5);

  const crownShapes = [
    "corn_tassel_ear",
    "sorghum_panicle",
    "wheat_spike",
    "barley_awned_spike",
    "oat_open_panicle",
    "canola_raceme",
    "alfalfa_raceme",
    "legume_pods",
    "pea_blossom_pods",
  ] as const;
  const crownCounts = crownShapes.map((shape) => {
    const geom = getCrownGeometry(shape);
    const pos = geom.getAttribute("position");
    const norm = geom.getAttribute("normal");
    expect(pos.count).toBeGreaterThan(20);
    expect(norm.count).toBe(pos.count);
    return pos.count;
  });
  expect(new Set(crownCounts).size).toBeGreaterThanOrEqual(6);

  const fibrous = getRootGeometry("fibrous");
  const taproot = getRootGeometry("taproot");
  expect(fibrous.getAttribute("position").count).toBeGreaterThan(20);
  expect(taproot.getAttribute("position").count).toBeGreaterThan(20);
  expect(fibrous.getAttribute("position").count).not.toBe(taproot.getAttribute("position").count);
});

test("custom Three.js GLSL shader enhancers inject wind, SSS, soil moisture, root gradient, and cloud Fresnel chunks into ShaderLib.standard", () => {
  const foliageMat = new MeshStandardMaterial({ color: "#3b8734" });
  applyFoliageShader(foliageMat, {
    uTime: { value: 1.5 },
    uWindStrength: { value: 0.06 },
    uSubsurfaceColor: { value: new Color("#9be050") },
    uFrost: { value: 0 },
  });
  expect(foliageMat.customProgramCacheKey()).toContain("foliage");

  const foliageShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  foliageMat.onBeforeCompile(foliageShader as never, {} as never);
  expect(foliageShader.uniforms.uTime.value).toBe(1.5);
  expect(foliageShader.vertexShader).toContain("vPlantHeight");
  expect(foliageShader.vertexShader).toContain("uWindStrength");
  expect(foliageShader.fragmentShader).toContain("uSubsurfaceColor");
  expect(foliageShader.fragmentShader).toContain("backScatter");

  const soilMat = new MeshStandardMaterial({ color: "#6e4d31" });
  applySoilShader(soilMat, { uWetness: { value: 0.6 }, uHorizon: { value: 0 } });
  expect(soilMat.customProgramCacheKey()).toContain("soil");

  const soilShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  soilMat.onBeforeCompile(soilShader as never, {} as never);
  expect(soilShader.uniforms.uWetness.value).toBe(0.6);
  expect(soilShader.fragmentShader).toContain("uWetness");
  expect(soilShader.fragmentShader).toContain("fbmSoil");
  expect(soilShader.fragmentShader).toContain("roughnessFactor");

  const rootMat = new MeshStandardMaterial({ color: "#e6d6ae" });
  applyRootShader(rootMat);
  expect(rootMat.customProgramCacheKey()).toContain("root");

  const rootShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  rootMat.onBeforeCompile(rootShader as never, {} as never);
  expect(rootShader.vertexShader).toContain("vRootDepth");
  expect(rootShader.fragmentShader).toContain("vRootDepth");

  const cloudMat = new MeshStandardMaterial({ color: "#dce3ea", transparent: true });
  applyCloudShader(cloudMat, { uTime: { value: 2.0 }, uDark: { value: 1.0 } });
  expect(cloudMat.customProgramCacheKey()).toContain("cloud");

  const cloudShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  cloudMat.onBeforeCompile(cloudShader as never, {} as never);
  expect(cloudShader.uniforms.uTime.value).toBe(2.0);
  expect(cloudShader.fragmentShader).toContain("fresnelRim");
});

test("yearCropLabel formats the crop and cover status for each rotation year", () => {
  const names = { corn: "Corn (grain)", soybean: "Soybean" };
  expect(yearCropLabel(baseline, 0, names)).toBe("Corn (grain)");
  expect(yearCropLabel(baseline, 1, names)).toBe("Soybean");
  expect(yearCropLabel(option, 0, names)).toBe("Corn (grain) + rye cover");
  expect(yearCropLabel(option, 2, names)).toBe("Corn (grain) + rye cover");
});

test("cannon-es PlantCanopyPhysics and PrecipitationPhysics simulate wind forces, interactive canopy impulses, spring restoration, and ground collision bounces", () => {
  const canopy = new PlantCanopyPhysics();
  expect(canopy.bodies).toHaveLength(81);
  expect(canopy.springs).toHaveLength(81);
  expect(canopy.world.bodies).toHaveLength(162);

  canopy.applyImpulseAt(0, 0, 1.5);
  canopy.step(1 / 60, 0.5, false, "cereal_tillers");
  const centerTilt = canopy.getTilt(40);
  expect(Math.hypot(centerTilt.rotX, centerTilt.rotZ)).toBeGreaterThan(0.02);

  for (let i = 0; i < 60; i++) {
    canopy.step(1 / 60, 0.5 + i / 60, true, "corn_stalk");
  }
  const boundedTilt = canopy.getTilt(40);
  expect(Math.hypot(boundedTilt.rotX, boundedTilt.rotZ)).toBeLessThanOrEqual(0.8);

  const precip = new PrecipitationPhysics(24);
  const drop = precip.bodies[0];
  drop.position.set(0, 0.22, 0);
  drop.velocity.set(0, -4.0, 0);

  let bouncedOrSplashed = false;
  for (let i = 0; i < 20; i++) {
    precip.step(1 / 60, false);
    if (precip.getSplashPositions().length > 0 || drop.velocity.y > 0.05) {
      bouncedOrSplashed = true;
    }
  }
  expect(bouncedOrSplashed).toBe(true);

  const s = { value: 0, velocity: 0 };
  const first = stepSpringScalar(s, 1.2, 1 / 60);
  expect(first).toBeGreaterThan(0);
  for (let i = 0; i < 180; i++) {
    stepSpringScalar(s, 1.2, 1 / 60);
  }
  expect(s.value).toBeCloseTo(1.2, 2);
});

test("buildCumulusCloudGeometry builds flat-bottomed multi-puff cumulus meshes and resolveLabelScreenPositions prevents label overlap", () => {
  const c0 = buildCumulusCloudGeometry(0);
  const c1 = buildCumulusCloudGeometry(1);
  const pos = c0.getAttribute("position");
  const norm = c0.getAttribute("normal");

  expect(pos.count).toBeGreaterThan(400);
  expect(norm.count).toBe(pos.count);
  expect(pos.count).not.toBe(c1.getAttribute("position").count);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  expect(minY).toBeGreaterThanOrEqual(-0.55);
  expect(maxY).toBeGreaterThan(0.9);

  const separated = resolveLabelScreenPositions([380, 420], 210, 800);
  expect(separated[1] - separated[0]).toBeGreaterThanOrEqual(210);
  expect((separated[0] + separated[1]) / 2).toBeCloseTo(400, 1);

  expect(resolveLabelScreenPositions([200, 600], 210, 800)).toEqual([200, 600]);

  const sep3 = resolveLabelScreenPositions([360, 400, 440], 180, 800);
  expect(sep3).toHaveLength(3);
  expect(sep3[1] - sep3[0]).toBeGreaterThanOrEqual(180);
  expect(sep3[2] - sep3[1]).toBeGreaterThanOrEqual(180);
});

test("computeFittedCamera frames all plots tightly across plot counts and canvas aspect ratios", () => {
  const twoDesktop = computeFittedCamera("overview", 2, 920 / 480);
  const fourDesktop = computeFittedCamera("overview", 4, 920 / 480);
  const fourPhone = computeFittedCamera("overview", 4, 380 / 320);
  const singleDesktop = computeFittedCamera("overview", 1, 920 / 340);

  // More plots need wider distance; single replay plot zooms closer than 4-plot stage.
  expect(fourDesktop.pos[2]).toBeGreaterThan(twoDesktop.pos[2]);
  expect(singleDesktop.pos[2]).toBeLessThan(twoDesktop.pos[2]);
  // Narrow phone aspect zooms out further so outer plots stay inside the frustum.
  expect(fourPhone.pos[2]).toBeGreaterThan(fourDesktop.pos[2]);
  // Target y sits low enough that plots don't float above a 40% empty slab.
  expect(fourDesktop.target[1]).toBeLessThanOrEqual(0.2);
  // Single-plot overview camera stays low enough that the top FOV ray opens onto sky above horizon hills & trees.
  expect(singleDesktop.pos[1] / singleDesktop.pos[2]).toBeLessThanOrEqual(0.36);

  const canopy = computeFittedCamera("canopy", 4, 920 / 480);
  expect(canopy.pos[1]).toBeGreaterThan(canopy.pos[2]);
});

test("computeZoomBounds, terrain horizon extent, and label clamping handle zoom in and zoom out cleanly", () => {
  const singleZoom = computeZoomBounds("overview", 1, 920 / 340);
  const fourZoom = computeZoomBounds("overview", 4, 920 / 480);
  const rootsZoom = computeZoomBounds("roots", 4, 920 / 480);
  const canopyZoom = computeZoomBounds("canopy", 4, 920 / 480);

  expect(singleZoom.minDistance).toBeGreaterThanOrEqual(4.5);
  expect(singleZoom.maxDistance).toBeLessThan(fourZoom.maxDistance);
  expect(fourZoom.minDistance).toBeLessThan(fourZoom.fitDistance);
  expect(fourZoom.maxDistance).toBeGreaterThan(fourZoom.fitDistance);
  expect(fourZoom.maxDistance).toBeLessThanOrEqual(30);
  expect(canopyZoom.minPolarAngle).toBeLessThan(fourZoom.minPolarAngle);
  expect(rootsZoom.maxPolarAngle).toBeGreaterThan(fourZoom.maxPolarAngle);

  // Surrounding meadow must extend well past fog far + max zoom-out so ground edges never appear.
  expect(TERRAIN_FOG_NEAR).toBeGreaterThanOrEqual(30);
  expect(TERRAIN_EXTENT).toBeGreaterThanOrEqual(TERRAIN_FOG_FAR + fourZoom.maxDistance);

  // Stacked upward-translated labels must never clip above the top edge when zoomed in closely.
  expect(clampLabelBottomY(12, 56, 400)).toBeGreaterThanOrEqual(66);
  expect(clampLabelBottomY(500, 56, 400)).toBeLessThanOrEqual(390);

  // Widely spread zoomed-in plot anchors stay safely inside both horizontal edges without overlap.
  const zoomedInXs = resolveLabelScreenPositions([-250, 180, 540, 1100], 135, 700);
  expect(zoomedInXs[0]).toBeGreaterThanOrEqual(80);
  expect(zoomedInXs[3]).toBeLessThanOrEqual(620);
  expect(zoomedInXs[1] - zoomedInXs[0]).toBeGreaterThanOrEqual(135);
  expect(zoomedInXs[3] - zoomedInXs[2]).toBeGreaterThanOrEqual(135);
});

test("sculpted topsoil, erosion rills, cutaway streaks, and alluvial sediment fans have realistic carved geometry and shading", () => {
  const flatTilled = buildTopsoilGeometry(false);
  const erodedTilled = buildTopsoilGeometry(true);

  const flatPos = flatTilled.getAttribute("position");
  const flatNorm = flatTilled.getAttribute("normal");
  const flatColor = flatTilled.getAttribute("color");
  expect(flatPos.count).toBeGreaterThan(5000);
  expect(flatNorm.count).toBe(flatPos.count);
  expect(flatColor.count).toBe(flatPos.count);

  // Measure interior top-surface relief (tilled ridges vs sunken furrow troughs) and front-rim erosion notches
  let tilledTopMinY = Infinity;
  let tilledTopMaxY = -Infinity;
  let tilledMinShade = Infinity;
  let tilledMaxShade = -Infinity;
  for (let i = 0; i < flatPos.count; i++) {
    const x = flatPos.getX(i);
    const y = flatPos.getY(i);
    const z = flatPos.getZ(i);
    const ny = flatNorm.getY(i);
    if (ny > 0.5 && Math.abs(x) < 2.5 && Math.abs(z) < 2.5) {
      if (y < tilledTopMinY) tilledTopMinY = y;
      if (y > tilledTopMaxY) tilledTopMaxY = y;
      const r = flatColor.getX(i);
      if (r < tilledMinShade) tilledMinShade = r;
      if (r > tilledMaxShade) tilledMaxShade = r;
    }
  }
  expect(tilledTopMaxY - tilledTopMinY).toBeGreaterThan(0.02);
  expect(tilledTopMaxY).toBeLessThan(0.185);
  expect(tilledMaxShade - tilledMinShade).toBeGreaterThan(0.12);

  // Eroded soil carves real rill channels deeper below SOIL_TOP and notches through the front cutaway rim (z ≈ +2.85)
  const erPos = erodedTilled.getAttribute("position");
  const erNorm = erodedTilled.getAttribute("normal");
  let erTopMinY = Infinity;
  let frontRimMinY = Infinity;
  let frontRimMaxY = -Infinity;
  for (let i = 0; i < erPos.count; i++) {
    const y = erPos.getY(i);
    const z = erPos.getZ(i);
    const ny = erNorm.getY(i);
    if (ny > 0.4) {
      if (y < erTopMinY) erTopMinY = y;
      if (z > 2.8) {
        if (y < frontRimMinY) frontRimMinY = y;
        if (y > frontRimMaxY) frontRimMaxY = y;
      }
    }
  }
  expect(erTopMinY).toBeLessThan(tilledTopMinY - 0.02);
  expect(frontRimMaxY - frontRimMinY).toBeGreaterThan(0.03);

  // Cutaway wash streaks and lobate sediment fans are multi-vertex organic meshes rather than single rectangles
  for (const rillIdx of [0, 1, 2]) {
    const streak = buildCutawayStreakGeometry(rillIdx);
    const fan = buildSedimentFanGeometry(rillIdx);
    expect(streak.getAttribute("position").count).toBeGreaterThan(40);
    expect(streak.getAttribute("color").count).toBe(streak.getAttribute("position").count);
    expect(fan.getAttribute("position").count).toBeGreaterThan(60);
    expect(fan.getAttribute("color").count).toBe(fan.getAttribute("position").count);
    fan.computeBoundingBox();
    expect(fan.boundingBox?.min.z).toBeGreaterThanOrEqual(2.8);
    expect(fan.boundingBox?.max.z).toBeGreaterThan(3.2);
  }
});

test("water balance is the month's rain minus the crop's water use, in whole millimetres", () => {
  // Corn in July: 0.85 × 170 mm demand against 110 mm of rain.
  expect(waterBalance(plotFrame(baseline, 6), weatherFrame(conditions, 6))).toEqual({ rainMm: 110, useMm: 145, balanceMm: -35 });
  // Bare soil in January uses nothing.
  expect(waterBalance(plotFrame(baseline, 0), weatherFrame(conditions, 0))).toEqual({ rainMm: 20, useMm: 0, balanceMm: 20 });
});

test("drawn soil wetness follows the water balance and stays between 0 and 1", () => {
  const rainyBare = plotWetness(plotFrame(baseline, 3), weatherFrame(conditions, 3)); // April, bare, 90 mm
  const julyCorn = plotWetness(plotFrame(baseline, 6), weatherFrame(conditions, 6));
  expect(rainyBare).toBeGreaterThan(julyCorn);
  for (let s = 0; s < 24; s++) {
    const w = plotWetness(plotFrame(option, s), weatherFrame(conditions, s));
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(1);
  }
});

test("key moments point at the months where options differ most from the current rotation", () => {
  const moments = keyMoments([baseline, option], conditions, 24);
  const byKind = Object.fromEntries(moments.map((m) => [m.kind, m]));
  // April: heavy-rain month, the current rotation is bare, the rye cover option is not.
  expect(byKind.exposed).toMatchObject({ step: 3, label: "Heavy rain on bare soil" });
  expect(byKind.exposed.detail).toBe("1 of 1 options keeps the soil covered");
  // April is also where rye draws 40 mm while the bare field draws none.
  expect(byKind.water).toMatchObject({ step: 3, label: "Largest water-use gap" });
  expect(byKind.water.detail).toBe("Option uses 40 mm more than your rotation");
  // Rye roots are alive in January; the bare field has none.
  expect(byKind.roots).toMatchObject({ step: 0, label: "Living roots where yours has none" });
});

test("key moments are empty when every option matches the current rotation", () => {
  expect(keyMoments([baseline, { ...baseline, id: "same", is_baseline: false }], conditions, 24)).toEqual([]);
  expect(keyMoments([baseline], conditions, 24)).toEqual([]);
});

test("the roots view draws soil deeper than scale and keeps the whole profile in frame", () => {
  expect(soilExaggeration("overview")).toBe(1);
  expect(soilExaggeration("canopy")).toBe(1);
  expect(soilExaggeration("roots")).toBe(ROOTS_SOIL_EXAGGERATION);
  expect(ROOTS_SOIL_EXAGGERATION).toBeGreaterThan(1);

  const halfFovTan = Math.tan((45 * Math.PI) / 360);
  const profileBottom = SOIL_TOP - SOIL_DEPTH * ROOTS_SOIL_EXAGGERATION;
  for (const aspect of [1368 / 430, 920 / 480, 380 / 255]) {
    const { pos, target } = computeFittedCamera("roots", 4, aspect);
    // The camera looks level at the cut face (z = half a plot), so the frame's half
    // height there is distance × tan(fov / 2).
    const halfHeight = (pos[2] - 2.7) * halfFovTan;
    expect(Math.abs(pos[1] - target[1])).toBeLessThan(1.2);
    expect(target[1] - halfHeight).toBeLessThan(profileBottom); // soil bottom visible
    expect(target[1] + halfHeight).toBeGreaterThan(2.2); // tallest crop visible
    // The exaggerated profile takes a readable share of the frame height.
    expect((SOIL_DEPTH * ROOTS_SOIL_EXAGGERATION) / (2 * halfHeight)).toBeGreaterThan(aspect > 2 ? 0.25 : 0.1);
  }
});

test("noon sun height follows latitude and month", () => {
  // Ottawa-area field, 45.2° N: high in June, low in December.
  expect(sunElevationDeg(45.2, 5)).toBeGreaterThan(66);
  expect(sunElevationDeg(45.2, 5)).toBeLessThan(69);
  expect(sunElevationDeg(45.2, 11)).toBeGreaterThan(20);
  expect(sunElevationDeg(45.2, 11)).toBeLessThan(24);
  // Southern hemisphere: the seasons flip.
  expect(sunElevationDeg(-35, 11)).toBeGreaterThan(sunElevationDeg(-35, 5));
  // Never below the horizon, even in a polar winter.
  expect(sunElevationDeg(75, 11)).toBeGreaterThanOrEqual(4);
});

test("drilled crops are drawn denser in the row than wide-row crops, and phones keep one plant per cell", () => {
  expect(plantsPerCell("cereal_tillers", true)).toBeGreaterThan(plantsPerCell("corn_stalk", true));
  expect(plantsPerCell("rye_tuft", true)).toBe(plantsPerCell("cereal_tillers", true));
  expect(plantsPerCell("alfalfa_clump", true)).toBe(1); // the heaviest model: one clump per cell
  for (const shape of ["corn_stalk", "cereal_tillers", "soybean_bush", "alfalfa_clump"] as const) {
    expect(plantsPerCell(shape, false)).toBe(1);
  }
});

test("terrain ground shader, cutaway snow cap, rolling horizon hills, and multi-species shelterbelt geometries enhance Three.js landscape", () => {
  // 1. applySoilShader keeps optional uSnow uniform and injects world normal snow cap on upward topsoil faces
  const snowySoilMat = new MeshStandardMaterial({ color: "#6e4d31" });
  applySoilShader(snowySoilMat, { uWetness: { value: 0.4 }, uHorizon: { value: 0 }, uSnow: { value: 1.0 } });
  const snowySoilShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  snowySoilMat.onBeforeCompile(snowySoilShader as never, {} as never);
  expect(snowySoilShader.uniforms.uSnow.value).toBe(1.0);
  expect(snowySoilShader.vertexShader).toContain("vSoilWorldNormal");
  expect(snowySoilShader.fragmentShader).toContain("uSnow");

  // 2. applyGroundShader injects procedural meadow, snow drift, and trench contact AO chunks
  const groundMat = new MeshStandardMaterial({ color: "#7a9a52" });
  applyGroundShader(groundMat, {
    uSnow: { value: 0.9 },
    uDryness: { value: 0.1 },
    uTrenchHalfWidth: { value: 12 },
    uTrenchFrontZ: { value: 5.3 },
    uPlotHalfZ: { value: 2.85 },
  });
  expect(groundMat.customProgramCacheKey()).toContain("ground-terrain");
  const groundShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  groundMat.onBeforeCompile(groundShader as never, {} as never);
  expect(groundShader.uniforms.uSnow.value).toBe(0.9);
  expect(groundShader.vertexShader).toContain("vGroundWorldPos");
  expect(groundShader.fragmentShader).toContain("uTrenchHalfWidth");
  expect(groundShader.fragmentShader).toContain("parcel");

  // 3. Multi-ridge rolling horizon hills remain flat in the foreground apron and build a layered far horizon
  expect(terrainHillY(0, 0)).toBeLessThanOrEqual(0.11);
  expect(terrainHillY(12, -20)).toBeLessThanOrEqual(0.11);
  const ridge = buildHorizonRidgeGeometry();
  const ridgePos = ridge.getAttribute("position");
  const ridgeNorm = ridge.getAttribute("normal");
  expect(ridgePos.count).toBeGreaterThan(800);
  expect(ridgeNorm.count).toBe(ridgePos.count);
  let maxHillY = -Infinity;
  for (let i = 0; i < ridgePos.count; i++) {
    if (ridgePos.getY(i) > maxHillY) maxHillY = ridgePos.getY(i);
  }
  expect(maxHillY).toBeGreaterThan(3.0);

  // 4. Multi-species shelterbelt trees & hedgerow understory shrubs have rich layered silhouettes
  for (const geom of [
    buildWindbreakConiferGeometry(),
    buildBroadleafCrownGeometry(),
    buildBareBranchGeometry(),
  ]) {
    const pos = geom.getAttribute("position");
    const norm = geom.getAttribute("normal");
    const col = geom.getAttribute("color");
    expect(pos.count).toBeGreaterThan(100);
    expect(norm.count).toBe(pos.count);
    expect(col.count).toBe(pos.count);
  }
  const shrubGeom = buildShrubGeometry();
  expect(shrubGeom.getAttribute("position").count).toBeGreaterThan(40);
  expect(shrubGeom.getAttribute("normal").count).toBe(shrubGeom.getAttribute("position").count);
  expect(shrubGeom.getAttribute("color").count).toBe(shrubGeom.getAttribute("position").count);

  // 5. Atmospheric procedural sky dome synchronizes zenith/horizon sky gradients with fog
  const skyMat = buildSkyDomeMaterial();
  expect(skyMat.uniforms.uZenith.value).toBeDefined();
  expect(skyMat.uniforms.uHorizon.value).toBeDefined();
  expect(skyMat.uniforms.uSunDir.value).toBeDefined();
  expect(skyMat.fragmentShader).toContain("smoothstep");
});

test("rye_tuft fills normalized vertical canopy space, soil/ground separate uFrost from uSnow, and root builders produce multi-variant organic geometry", () => {
  const rye = getCropGeometry("rye_tuft");
  rye.computeBoundingBox();
  expect(rye.boundingBox!.max.y).toBeGreaterThanOrEqual(0.72);

  const frostSoilMat = new MeshStandardMaterial({ color: "#6e4d31" });
  applySoilShader(frostSoilMat, { uWetness: { value: 0.7 }, uHorizon: { value: 0 }, uSnow: { value: 0 }, uFrost: { value: 0.7 } });
  const frostSoilShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  frostSoilMat.onBeforeCompile(frostSoilShader as never, {} as never);
  expect(frostSoilShader.uniforms.uFrost.value).toBe(0.7);
  expect(frostSoilShader.fragmentShader).toContain("uFrost");

  const frostGroundMat = new MeshStandardMaterial({ color: "#73964b" });
  applyGroundShader(frostGroundMat, {
    uSnow: { value: 0 },
    uFrost: { value: 0.55 },
    uDryness: { value: 0.2 },
    uTrenchHalfWidth: { value: 12 },
    uTrenchFrontZ: { value: 5.3 },
    uPlotHalfZ: { value: 2.85 },
  });
  const frostGroundShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  frostGroundMat.onBeforeCompile(frostGroundShader as never, {} as never);
  expect(frostGroundShader.uniforms.uFrost.value).toBe(0.55);
  expect(frostGroundShader.fragmentShader).toContain("uFrost");

  const tapCounts = [0, 1, 2].map((v) => getRootVariantGeometry("taproot", v).getAttribute("position").count);
  const fibCounts = [0, 1, 2].map((v) => getRootVariantGeometry("fibrous", v).getAttribute("position").count);
  expect(new Set(tapCounts).size).toBeGreaterThanOrEqual(2);
  expect(new Set(fibCounts).size).toBeGreaterThanOrEqual(2);
});

test("AAA scene upgrades expose solar disc scatter, snow crystal glints, camera glide easing, and field station/farmstead prop geometry", () => {
  // 1. Sky dome renders a physical solar disc + Mie horizon scatter
  const skyMat = buildSkyDomeMaterial();
  expect(skyMat.fragmentShader).toContain("sunDisc");
  expect(skyMat.fragmentShader).toContain("mieGlow");
  expect(skyMat.uniforms.uSunColor.value).toBeInstanceOf(Color);

  // 2. Ground & topsoil shaders inject snow crystal micro-glints and optional uWetness rainwater sheen
  const snowGroundMat = new MeshStandardMaterial({ color: "#73964b" });
  applyGroundShader(snowGroundMat, {
    uSnow: { value: 1 },
    uFrost: { value: 0 },
    uDryness: { value: 0 },
    uWetness: { value: 0.8 },
    uTrenchHalfWidth: { value: 12 },
    uTrenchFrontZ: { value: 5.3 },
    uPlotHalfZ: { value: 2.85 },
  });
  const groundShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  snowGroundMat.onBeforeCompile(groundShader as never, {} as never);
  expect(groundShader.uniforms.uWetness.value).toBe(0.8);
  expect(groundShader.fragmentShader).toContain("snowGlint");

  const soilMat = new MeshStandardMaterial({ color: "#6e4d31" });
  applySoilShader(soilMat, { uWetness: { value: 0.9 }, uHorizon: { value: 0 }, uSnow: { value: 1 } });
  const soilShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  soilMat.onBeforeCompile(soilShader as never, {} as never);
  expect(soilShader.fragmentShader).toContain("snowGlint");

  // 3. Camera pose glide converges monotonically without overshoot and snaps once within threshold
  const curPos = new Vector3(0, 6.8, 12.0);
  const curTarget = new Vector3(0, 0.2, 0);
  const goalPos: [number, number, number] = [0, -0.35, 13.5];
  const goalTarget: [number, number, number] = [0, -0.9, 0];
  const d0 = curPos.distanceTo(new Vector3(...goalPos));
  const stillMoving = lerpCameraPose(curPos, curTarget, goalPos, goalTarget, 1 / 60, 8);
  expect(stillMoving).toBe(true);
  const d1 = curPos.distanceTo(new Vector3(...goalPos));
  expect(d1).toBeLessThan(d0);
  expect(d1).toBeGreaterThan(0.5);
  for (let i = 0; i < 120; i++) {
    lerpCameraPose(curPos, curTarget, goalPos, goalTarget, 1 / 30, 8);
  }
  const done = lerpCameraPose(curPos, curTarget, goalPos, goalTarget, 1 / 30, 8);
  expect(done).toBe(false);
  expect(curPos.distanceTo(new Vector3(...goalPos))).toBeLessThan(1e-4);

  // 4. Headland micro weather-station and distant farmstead prop builders return grounded vertex-colored geometry
  const stationBody = buildWeatherStationBodyGeometry();
  const rotor = buildAnemometerRotorGeometry();
  stationBody.computeBoundingBox();
  rotor.computeBoundingBox();
  expect(stationBody.getAttribute("position").count).toBeGreaterThan(36);
  expect(stationBody.getAttribute("color").count).toBe(stationBody.getAttribute("position").count);
  expect(stationBody.boundingBox!.max.y).toBeGreaterThan(1.2);
  expect(rotor.getAttribute("position").count).toBeGreaterThan(36);
  expect(rotor.getAttribute("color").count).toBe(rotor.getAttribute("position").count);
  expect(rotor.boundingBox!.max.x).toBeGreaterThan(0.08);
  expect(rotor.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.02);

  const farm = buildFarmsteadParts();
  for (const geom of [farm.barnWalls, farm.barnRoof, farm.siloMetal, farm.fence]) {
    geom.computeBoundingBox();
    expect(geom.getAttribute("position").count).toBeGreaterThan(24);
    expect(geom.getAttribute("color").count).toBe(geom.getAttribute("position").count);
    expect(geom.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.05);
  }
});

test("real-world rain system builds GPU motion-blurred streaks, wet glossy foliage, and live concentric puddle ripples", () => {
  // 1. Cross-quad rain streak geometry & motion-blurred velocity material
  const streakGeom = buildRainStreaksGeometry(120, 16);
  const posAttr = streakGeom.getAttribute("position");
  const uvAttr = streakGeom.getAttribute("uv");
  const seedAttr = streakGeom.getAttribute("aSeed");
  expect(posAttr.count).toBeGreaterThanOrEqual(120 * 8);
  expect(uvAttr.count).toBe(posAttr.count);
  expect(seedAttr.count).toBe(posAttr.count);
  streakGeom.computeBoundingBox();
  expect(streakGeom.boundingBox!.max.x - streakGeom.boundingBox!.min.x).toBeGreaterThan(20);

  const rainMat = buildRainStreaksMaterial();
  expect(rainMat.transparent).toBe(true);
  expect(rainMat.depthWrite).toBe(false);
  expect(rainMat.uniforms.uTime).toBeDefined();
  expect(rainMat.uniforms.uWindX).toBeDefined();
  expect(rainMat.uniforms.uIntensity).toBeDefined();
  expect(rainMat.fragmentShader).toContain("smoothstep");
  expect(rainMat.vertexShader).toContain("uWindX");

  // 2. Foliage shader gains optional uWetness film for wet glistening leaves
  const leafMat = new MeshStandardMaterial({ color: "#3b8734", roughness: 0.72 });
  applyFoliageShader(leafMat, {
    uTime: { value: 0 },
    uWindStrength: { value: 0.08 },
    uSubsurfaceColor: { value: new Color("#9be04a") },
    uFrost: { value: 0 },
    uWetness: { value: 0.85 },
  });
  const leafShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  leafMat.onBeforeCompile(leafShader as never, {} as never);
  expect(leafShader.uniforms.uWetness.value).toBe(0.85);
  expect(leafShader.fragmentShader).toContain("wetSheen");

  // 3. Soil & ground shaders drive animated concentric raindrop rippleRing effects inside wet puddles when uTime advances
  const wetGroundMat = new MeshStandardMaterial({ color: "#73964b" });
  applyGroundShader(wetGroundMat, {
    uSnow: { value: 0 },
    uFrost: { value: 0 },
    uDryness: { value: 0 },
    uWetness: { value: 0.9 },
    uTime: { value: 1.5 },
    uTrenchHalfWidth: { value: 12 },
    uTrenchFrontZ: { value: 5.3 },
    uPlotHalfZ: { value: 2.85 },
  });
  const groundShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  wetGroundMat.onBeforeCompile(groundShader as never, {} as never);
  expect(groundShader.uniforms.uTime.value).toBe(1.5);
  expect(groundShader.fragmentShader).toContain("rippleRing");

  const wetSoilMat = new MeshStandardMaterial({ color: "#6e4d31" });
  applySoilShader(wetSoilMat, { uWetness: { value: 0.9 }, uHorizon: { value: 0 }, uTime: { value: 2.2 } });
  const soilShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  wetSoilMat.onBeforeCompile(soilShader as never, {} as never);
  expect(soilShader.uniforms.uTime.value).toBe(2.2);
  expect(soilShader.fragmentShader).toContain("rippleRing");
});
