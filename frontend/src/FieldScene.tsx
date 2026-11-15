// The 3D content of the season view: two field plots under one sky with a live
// underground soil & root cutaway. Everything drawn comes from the frames passed in
// (crop state & FAO-56 root traits from the rotation calendar, weather from NASA POWER);
// nothing here invents data.

import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Body,
  ContactMaterial,
  Material as CannonMaterial,
  NaiveBroadphase,
  Particle,
  Plane as CannonPlane,
  SAPBroadphase,
  Sphere as CannonSphere,
  Spring,
  Vec3,
  World,
} from "cannon-es";
import { type ComponentRef, type RefObject, useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";

import {
  type CameraView,
  computeFittedCamera,
  computeZoomBounds,
  HEAVY_RAIN_MONTH,
  type PlotFrame,
  plotSpacingForCount,
  plotWetness,
  rootProfile,
  SOIL_DEPTH,
  SOIL_TOP,
  soilExaggeration,
  sunElevationDeg,
  type WeatherFrame,
} from "./season";

export type Shape =
  | "corn_stalk"
  | "sorghum_stalk"
  | "cereal_tillers"
  | "soybean_bush"
  | "pea_vine"
  | "canola_stalk"
  | "alfalfa_clump"
  | "rye_tuft";

export type CrownShape =
  | "corn_tassel_ear"
  | "sorghum_panicle"
  | "wheat_spike"
  | "barley_awned_spike"
  | "oat_open_panicle"
  | "canola_raceme"
  | "alfalfa_raceme"
  | "legume_pods"
  | "pea_blossom_pods";

interface Look {
  shape: Shape;
  crown?: CrownShape;
  color: string;
  ripe?: string;
  flower?: string;
  height: number;
  width: number;
}

// Heights are typical mature heights at the scene's scale (1 m = 0.56 units, as for soil depth):
// corn about 2.6 m, sorghum 1.4 m, canola 1.3 m, oats 1.0 m, wheat and soybean 0.9 m, barley 0.8 m,
// field pea and alfalfa 0.7 m. General reference values, not measured on this field.
const LOOKS: Record<string, Look> = {
  corn: {
    shape: "corn_stalk",
    crown: "corn_tassel_ear",
    color: "#3b8734",
    ripe: "#c9b458",
    height: 1.45,
    width: 1.0,
  },
  sorghum: {
    shape: "sorghum_stalk",
    crown: "sorghum_panicle",
    color: "#57872a",
    ripe: "#9c4a2b",
    height: 0.8,
    width: 1.0,
  },
  soybean: {
    shape: "soybean_bush",
    crown: "legume_pods",
    color: "#2f7a3a",
    ripe: "#b39a45",
    height: 0.5,
    width: 0.85,
  },
  field_pea: {
    shape: "pea_vine",
    crown: "pea_blossom_pods",
    color: "#5aa04a",
    flower: "#f3f5ec",
    ripe: "#c2b05a",
    height: 0.4,
    width: 0.85,
  },
  winter_wheat: {
    shape: "cereal_tillers",
    crown: "wheat_spike",
    color: "#7ea844",
    ripe: "#dcb44a",
    height: 0.5,
    width: 1.0,
  },
  spring_wheat: {
    shape: "cereal_tillers",
    crown: "wheat_spike",
    color: "#7ea844",
    ripe: "#dcb44a",
    height: 0.48,
    width: 1.0,
  },
  barley: {
    shape: "cereal_tillers",
    crown: "barley_awned_spike",
    color: "#8ab34f",
    ripe: "#d8bd62",
    height: 0.45,
    width: 1.0,
  },
  oats: {
    shape: "cereal_tillers",
    crown: "oat_open_panicle",
    color: "#79aa50",
    ripe: "#d6c27a",
    height: 0.56,
    width: 1.0,
  },
  canola: {
    shape: "canola_stalk",
    crown: "canola_raceme",
    color: "#4a9437",
    flower: "#f2d02a",
    ripe: "#a88d48",
    height: 0.73,
    width: 0.95,
  },
  alfalfa: {
    shape: "alfalfa_clump",
    crown: "alfalfa_raceme",
    color: "#4b8c47",
    flower: "#8d6cc2",
    height: 0.4,
    width: 1.4,
  },
  rye_cover: {
    shape: "rye_tuft",
    color: "#52a242",
    height: 0.54,
    width: 1.12,
  },
};

const PLOT = 5.4;
const GRID = 9;
const CELL = PLOT / GRID;
const SOIL_BOTTOM = SOIL_TOP - SOIL_DEPTH;
const METER_TO_WORLD = 0.56;
const FROST = new Color("#e8f1f7");
// Frost only pales a plant subtly so winter rye/alfalfa stand out cleanly against snow; the shader adds the icy rim.
const FROST_TINT = 0.08;

// Fixed jitter so plants look natural but don't move between renders.
const POSITIONS: [number, number][] = Array.from({ length: GRID * GRID }, (_, i) => {
  const row = Math.floor(i / GRID);
  const col = i % GRID;
  const jitter = (n: number) => (Math.sin(n * 12.9898) * 43758.5453) % 1;
  const step = PLOT / GRID;
  return [
    -PLOT / 2 + step * (col + 0.5) + jitter(i) * 0.12,
    -PLOT / 2 + step * (row + 0.5) + jitter(i + 99) * 0.12,
  ];
});

// Root positions placed right along the front cutaway plane so root depth is legible.
const ROOT_POSITIONS: number[] = Array.from({ length: GRID * 2 }, (_, i) => {
  const step = PLOT / (GRID * 2);
  const jitter = ((Math.sin(i * 19.31) * 43758.5453) % 1) * 0.08;
  return -PLOT / 2 + step * (i + 0.5) + jitter;
});

function paintVertexGradient(
  geom: BufferGeometry,
  lowHex: string,
  highHex: string,
  minY: number,
  maxY: number,
): BufferGeometry {
  const pos = geom.getAttribute("position");
  const low = new Color(lowHex);
  const high = new Color(highHex);
  const tmp = new Color();
  const colors = new Float32Array(pos.count * 3);
  const span = Math.max(0.001, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - minY) / span));
    tmp.copy(low).lerp(high, t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geom.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geom;
}

function mergeBufferGeometries(parts: BufferGeometry[]): BufferGeometry {
  const nonIndexed = parts.map((part) => {
    const g = part.index ? part.toNonIndexed() : part.clone();
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    part.dispose();
    return g;
  });

  let totalVertices = 0;
  for (const g of nonIndexed) {
    totalVertices += g.getAttribute("position").count;
  }

  const hasColors = nonIndexed.length > 0 && nonIndexed.every((g) => Boolean(g.getAttribute("color")));
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = hasColors ? new Float32Array(totalVertices * 3) : null;
  let offset = 0;

  for (const g of nonIndexed) {
    const pos = g.getAttribute("position");
    const norm = g.getAttribute("normal");
    positions.set(pos.array as Float32Array, offset * 3);
    normals.set(norm.array as Float32Array, offset * 3);
    if (colors) {
      const col = g.getAttribute("color");
      colors.set(col.array as Float32Array, offset * 3);
    }
    offset += pos.count;
    g.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute("position", new Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  if (colors) merged.setAttribute("color", new Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** Builds a 3-segment curved grass blade extending from (0, y, 0) outward at yaw. */
function buildCurvedLeaf(
  length: number,
  width: number,
  startPitch: number,
  curvePitch: number,
  yaw: number,
  y: number,
): BufferGeometry[] {
  const segLen = length / 3;
  const parts: BufferGeometry[] = [];
  let curY = 0;
  let curZ = 0;
  let angle = startPitch;

  for (let s = 0; s < 3; s++) {
    const segW = width * (1 - s * 0.25);
    const seg = new BoxGeometry(segW, 0.01, segLen);
    seg.translate(0, 0, segLen / 2);
    seg.rotateX(angle);
    seg.translate(0, curY, curZ);
    seg.rotateY(yaw);
    seg.translate(0, y, 0);
    parts.push(seg);

    curZ += Math.cos(angle) * segLen;
    curY -= Math.sin(angle) * segLen;
    angle += curvePitch;
  }
  return parts;
}

/** Builds a trifoliate compound leaf (petiole + 1 terminal leaflet + 2 lateral leaflets). */
function buildTrifoliateLeaf(scale: number, yaw: number, y: number, pitch: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const petiole = new CylinderGeometry(0.01 * scale, 0.014 * scale, 0.14 * scale, 4);
  petiole.rotateX(Math.PI / 2 - pitch);
  petiole.translate(0, 0.02 * scale, 0.07 * scale);
  parts.push(petiole);

  const makeLeaflet = (lx: number, lz: number, lyRot: number, size: number) => {
    const leaflet = new SphereGeometry(0.075 * scale * size, 6, 4);
    leaflet.scale(0.85, 0.16, 1.35);
    leaflet.rotateY(lyRot);
    leaflet.translate(lx * scale, 0.04 * scale, lz * scale);
    return leaflet;
  };

  parts.push(makeLeaflet(0, 0.22, 0, 1.05));
  parts.push(makeLeaflet(-0.085, 0.14, 0.65, 0.92));
  parts.push(makeLeaflet(0.085, 0.14, -0.65, 0.92));

  parts.forEach((p) => {
    p.rotateY(yaw);
    p.translate(0, y, 0);
  });
  return parts;
}

const CROP_GEOMETRIES = new Map<Shape, BufferGeometry>();
const CROWN_GEOMETRIES = new Map<CrownShape, BufferGeometry>();
const ROOT_GEOMETRIES = new Map<string, BufferGeometry>();
const CUMULUS_GEOMETRIES = new Map<number, BufferGeometry>();

type CloudPuffSpec = [px: number, py: number, pz: number, radius: number];

const CUMULUS_VARIANTS: CloudPuffSpec[][] = [
  [
    [0.0, 0.38, 0.0, 1.05],
    [-0.95, 0.16, 0.12, 0.84],
    [0.98, 0.2, -0.08, 0.88],
    [-1.62, -0.06, -0.05, 0.62],
    [1.68, -0.04, 0.08, 0.64],
    [-0.45, -0.02, 0.56, 0.68],
    [0.52, 0.02, -0.52, 0.66],
    [0.18, 0.68, 0.06, 0.68],
  ],
  [
    [-0.12, 0.44, 0.0, 1.02],
    [0.86, 0.26, 0.1, 0.88],
    [-1.08, 0.14, -0.08, 0.82],
    [-1.76, -0.08, 0.06, 0.58],
    [1.65, -0.05, -0.06, 0.66],
    [-0.55, 0.0, -0.55, 0.68],
    [0.42, 0.02, 0.58, 0.7],
    [-0.3, 0.8, 0.08, 0.64],
    [0.46, 0.68, -0.1, 0.58],
  ],
  [
    [0.05, 0.34, 0.0, 0.98],
    [-0.96, 0.12, -0.06, 0.82],
    [1.04, 0.14, 0.08, 0.84],
    [-1.68, -0.06, 0.1, 0.6],
    [1.72, -0.06, -0.08, 0.62],
    [-0.36, -0.02, 0.54, 0.66],
    [0.44, 0.0, -0.5, 0.64],
  ],
];

/** Builds and caches a billowy, flat-bottomed multi-puff cumulus cloud mesh. */
export function buildCumulusCloudGeometry(variant: number): BufferGeometry {
  const key = ((variant % CUMULUS_VARIANTS.length) + CUMULUS_VARIANTS.length) % CUMULUS_VARIANTS.length;
  const existing = CUMULUS_GEOMETRIES.get(key);
  if (existing) return existing;

  const puffs = CUMULUS_VARIANTS[key];
  const parts: BufferGeometry[] = puffs.map(([px, py, pz, r]) => {
    const puff = new SphereGeometry(r, 18, 14);
    const pos = puff.getAttribute("position");
    for (let v = 0; v < pos.count; v++) {
      const lx = pos.getX(v);
      const ly = pos.getY(v);
      const lz = pos.getZ(v);
      const billow =
        1 +
        0.08 * Math.sin(lx * 3.1 + key * 1.3) * Math.cos(lz * 2.9 + ly * 2.4) +
        0.04 * Math.sin((lx + lz) * 5.2 + ly * 3.7);
      const wx = lx * billow + px;
      let wy = ly * billow + py;
      const wz = lz * billow + pz;
      if (wy < -0.32) {
        wy = -0.32 + (wy + 0.32) * 0.18;
      }
      pos.setXYZ(v, wx, wy, wz);
    }
    puff.computeVertexNormals();
    return puff;
  });

  const built = mergeBufferGeometries(parts);
  CUMULUS_GEOMETRIES.set(key, built);
  return built;
}

export function getCropGeometry(shape: Shape): BufferGeometry {
  const existing = CROP_GEOMETRIES.get(shape);
  if (existing) return existing;

  const parts: BufferGeometry[] = [];
  switch (shape) {
    case "corn_stalk": {
      // Stout tapered maize culm
      const culm = new CylinderGeometry(0.032, 0.068, 0.92, 6);
      culm.translate(0, 0.46, 0);
      parts.push(culm);

      // Basal prop/brace roots anchoring lower stalk nodes into the soil
      [0, 1, 2, 3].forEach((idx) => {
        const brace = new CylinderGeometry(0.012, 0.018, 0.12, 4);
        brace.translate(0, 0.06, 0);
        brace.rotateZ(0.55);
        brace.rotateY((idx * Math.PI) / 2 + 0.4);
        brace.translate(0, 0.01, 0);
        parts.push(brace);
      });

      // Alternate broad, gracefully downward-arching leaf blades
      [0.2, 0.33, 0.46, 0.59, 0.72, 0.84].forEach((y, idx) => {
        const yaw = idx * 2.15;
        const startPitch = idx >= 4 ? -0.45 : -0.25;
        const curvePitch = idx >= 4 ? 0.42 : 0.52;
        parts.push(...buildCurvedLeaf(0.42, 0.068, startPitch, curvePitch, yaw, y));
      });
      break;
    }
    case "sorghum_stalk": {
      // Slightly thicker stalk with stiffer, more upright drought-adapted leaves
      const culm = new CylinderGeometry(0.036, 0.072, 0.86, 6);
      culm.translate(0, 0.43, 0);
      parts.push(culm);

      [0.18, 0.31, 0.44, 0.57, 0.69, 0.8].forEach((y, idx) => {
        const yaw = idx * 2.25;
        parts.push(...buildCurvedLeaf(0.36, 0.062, -0.58, 0.28, yaw, y));
      });
      break;
    }
    case "cereal_tillers": {
      // 4 hollow slender tillers radiating from crown with ascending flag leaves
      [0, 1, 2, 3].forEach((idx) => {
        const yaw = (idx * Math.PI) / 2 + 0.3;
        const tilt = 0.07 + (idx % 2) * 0.04;
        const tiller = new CylinderGeometry(0.014, 0.025, 0.88, 5);
        tiller.translate(0, 0.44, 0);
        tiller.rotateZ(tilt);
        tiller.rotateY(yaw);
        parts.push(tiller);

        parts.push(...buildCurvedLeaf(0.24, 0.024, -0.75, 0.45, yaw + 0.35, 0.42 + (idx % 2) * 0.14));
        if (idx < 2) {
          parts.push(...buildCurvedLeaf(0.19, 0.02, -0.65, 0.4, yaw - 0.8, 0.66));
        }
      });
      break;
    }
    case "soybean_bush": {
      // Main upright stem + slight side branches + 6 compound trifoliate leaves
      const stem = new CylinderGeometry(0.024, 0.042, 0.86, 5);
      stem.translate(0, 0.43, 0);
      parts.push(stem);

      [0, 1].forEach((idx) => {
        const branch = new CylinderGeometry(0.014, 0.024, 0.44, 4);
        branch.translate(0, 0.22, 0);
        branch.rotateZ(0.45);
        branch.rotateY(idx * Math.PI + 0.5);
        branch.translate(0, 0.22, 0);
        parts.push(branch);
      });

      [0.28, 0.4, 0.52, 0.64, 0.75, 0.84].forEach((y, idx) => {
        parts.push(...buildTrifoliateLeaf(1.05 - idx * 0.04, idx * 2.35, y, 0.35));
      });
      break;
    }
    case "pea_vine": {
      // 3 semi-erect vining stems with paired stipules and alternating oval leaflets
      [0, 1, 2].forEach((sIdx) => {
        const yaw = (sIdx * 2 * Math.PI) / 3 + 0.2;
        const vine = new CylinderGeometry(0.014, 0.022, 0.82, 5);
        vine.translate(0, 0.41, 0);
        vine.rotateZ(0.26);
        vine.rotateY(yaw);
        parts.push(vine);

        [0.24, 0.44, 0.64].forEach((y, lIdx) => {
          [-1, 1].forEach((side) => {
            const leaflet = new SphereGeometry(0.068, 6, 4);
            leaflet.scale(0.8, 0.16, 1.35);
            leaflet.translate(side * 0.075, y, -y * 0.26 * (lIdx % 2 === 0 ? 1 : -1));
            leaflet.rotateY(yaw);
            parts.push(leaflet);
          });
        });
      });
      break;
    }
    case "canola_stalk": {
      // Lower cabbage-like basal rosette + erect branching brassica stem
      const stem = new CylinderGeometry(0.024, 0.048, 0.86, 6);
      stem.translate(0, 0.43, 0);
      parts.push(stem);

      [0, 1, 2, 3].forEach((idx) => {
        const yaw = (idx * Math.PI) / 2 + 0.25;
        const basalLeaf = new SphereGeometry(0.11, 6, 4);
        basalLeaf.scale(0.75, 0.18, 1.65);
        basalLeaf.rotateX(-0.22);
        basalLeaf.translate(0, 0.12, 0.14);
        basalLeaf.rotateY(yaw);
        parts.push(basalLeaf);
      });

      [0, 1, 2].forEach((idx) => {
        const yaw = (idx * 2 * Math.PI) / 3 + 0.7;
        const branch = new CylinderGeometry(0.012, 0.02, 0.36, 4);
        branch.translate(0, 0.18, 0);
        branch.rotateZ(0.42);
        branch.rotateY(yaw);
        branch.translate(0, 0.48 + idx * 0.05, 0);
        parts.push(branch);

        parts.push(...buildCurvedLeaf(0.22, 0.045, -0.35, 0.35, yaw, 0.38 + idx * 0.08));
      });
      break;
    }
    case "alfalfa_clump": {
      // 6 perennial shoots from a woody crown, each bearing dense small trifoliate clusters
      [0, 1, 2, 3, 4, 5].forEach((idx) => {
        const yaw = (idx * Math.PI) / 3 + 0.15;
        const shoot = new CylinderGeometry(0.013, 0.022, 0.88, 5);
        shoot.translate(0, 0.44, 0);
        shoot.rotateZ(0.2 + (idx % 2) * 0.08);
        shoot.rotateY(yaw);
        parts.push(shoot);

        [0.32, 0.56, 0.76].forEach((y, tIdx) => {
          const r = Math.sin(0.22) * y;
          const x = -Math.sin(yaw) * r;
          const z = Math.cos(yaw) * r;
          const cluster = buildTrifoliateLeaf(0.62, yaw + tIdx * 1.4, y, 0.25);
          cluster.forEach((p) => p.translate(x * 0.2, 0, z * 0.2));
          parts.push(...cluster);
        });
      });
      break;
    }
    case "rye_tuft": {
      // Normalized dense winter-rye tiller clump: upright inner shoots + arching cover blades forming a continuous sward
      Array.from({ length: 8 }, (_, idx) => {
        const yaw = (idx * 2 * Math.PI) / 8 + (idx % 2) * 0.18;
        const pitch = -1.24 + (idx % 3) * 0.1;
        parts.push(...buildCurvedLeaf(0.88, 0.054, pitch, 0.36, yaw, 0.04));
      });
      Array.from({ length: 5 }, (_, idx) => {
        const yaw = (idx * 2 * Math.PI) / 5 + 0.35;
        parts.push(...buildCurvedLeaf(0.95, 0.044, -1.38, 0.24, yaw, 0.06));
      });
      break;
    }
  }

  const built = mergeBufferGeometries(parts);
  CROP_GEOMETRIES.set(shape, built);
  return built;
}

export function getCrownGeometry(shape: CrownShape): BufferGeometry {
  const existing = CROWN_GEOMETRIES.get(shape);
  if (existing) return existing;

  const parts: BufferGeometry[] = [];
  switch (shape) {
    case "corn_tassel_ear": {
      // Terminal male pollen tassel plume (y = 0.90..1.16)
      const centralSpike = new ConeGeometry(0.028, 0.24, 5);
      centralSpike.translate(0, 1.04, 0);
      parts.push(centralSpike);
      [0, 1, 2, 3].forEach((idx) => {
        const branch = new ConeGeometry(0.018, 0.19, 4);
        branch.translate(0, 0.095, 0);
        branch.rotateZ(0.55);
        branch.rotateY((idx * Math.PI) / 2 + 0.2);
        branch.translate(0, 0.92, 0);
        parts.push(branch);
      });
      // Two lateral husked female ears on mid-stalk nodes with silk tips
      [
        { y: 0.48, yaw: 0.4 },
        { y: 0.58, yaw: 3.4 },
      ].forEach(({ y, yaw }) => {
        const ear = new CylinderGeometry(0.038, 0.048, 0.16, 6);
        ear.translate(0, 0.08, 0);
        ear.rotateZ(0.45);
        ear.rotateY(yaw);
        ear.translate(0, y, 0);
        parts.push(ear);

        const silk = new ConeGeometry(0.022, 0.07, 4);
        silk.translate(0, 0.19, 0);
        silk.rotateZ(0.45);
        silk.rotateY(yaw);
        silk.translate(0, y, 0);
        parts.push(silk);
      });
      break;
    }
    case "sorghum_panicle": {
      // Compact, dense ovoid terminal grain head (club panicle) at stalk apex
      const core = new SphereGeometry(0.095, 7, 6);
      core.scale(0.85, 1.85, 0.85);
      core.translate(0, 0.98, 0);
      parts.push(core);
      [0, 1, 2, 3, 4].forEach((idx) => {
        const angle = (idx * 2 * Math.PI) / 5;
        const cluster = new SphereGeometry(0.055, 6, 5);
        cluster.scale(0.9, 1.3, 0.9);
        cluster.translate(Math.cos(angle) * 0.048, 0.94 + (idx % 2) * 0.07, Math.sin(angle) * 0.048);
        parts.push(cluster);
      });
      break;
    }
    case "wheat_spike": {
      // Compact erect spike along zigzag rachis (8 alternating plump spikelets)
      [0, 1, 2, 3].forEach((tIdx) => {
        const yaw = (tIdx * Math.PI) / 2 + 0.3;
        const rx = -Math.sin(0.08) * 0.88;
        for (let k = 0; k < 4; k++) {
          const spikelet = new SphereGeometry(0.024, 5, 4);
          spikelet.scale(0.8, 1.45, 0.7);
          const side = k % 2 === 0 ? 0.012 : -0.012;
          spikelet.translate(rx + side, 0.84 + k * 0.042, 0);
          spikelet.rotateY(yaw);
          parts.push(spikelet);
        }
      });
      break;
    }
    case "barley_awned_spike": {
      // Bearded spike with triplet spikelets + long parallel needle-like awns
      [0, 1, 2, 3].forEach((tIdx) => {
        const yaw = (tIdx * Math.PI) / 2 + 0.3;
        const head = new CylinderGeometry(0.028, 0.032, 0.16, 5);
        head.translate(0, 0.92, 0);
        head.rotateZ(0.18);
        head.rotateY(yaw);
        parts.push(head);

        [-0.014, 0, 0.014].forEach((offset) => {
          const awn = new CylinderGeometry(0.0025, 0.004, 0.24, 3);
          awn.translate(offset, 1.09, offset * 0.5);
          awn.rotateZ(0.18);
          awn.rotateY(yaw);
          parts.push(awn);
        });
      });
      break;
    }
    case "oat_open_panicle": {
      // Whorled spreading panicle branches with pendulous drooping teardrop spikelets
      [0, 1, 2, 3].forEach((tIdx) => {
        const yaw = (tIdx * Math.PI) / 2 + 0.3;
        [0, 1, 2].forEach((bIdx) => {
          const bYaw = yaw + (bIdx * 2 * Math.PI) / 3;
          const branch = new CylinderGeometry(0.004, 0.007, 0.18, 4);
          branch.translate(0, 0.09, 0);
          branch.rotateZ(0.85);
          branch.rotateY(bYaw);
          branch.translate(0, 0.86 + bIdx * 0.035, 0);
          parts.push(branch);

          const drop = new ConeGeometry(0.022, 0.065, 5);
          drop.rotateX(Math.PI);
          drop.translate(
            -Math.sin(bYaw) * 0.13,
            0.84 + bIdx * 0.035,
            Math.cos(bYaw) * 0.13,
          );
          parts.push(drop);
        });
      });
      break;
    }
    case "canola_raceme": {
      // Tall cruciform (4-petaled cross) yellow blossom corymb + slender lower siliques
      const addFlower = (fx: number, fy: number, fz: number) => {
        [0, Math.PI / 2].forEach((rot) => {
          const pair = new BoxGeometry(0.11, 0.012, 0.042);
          pair.rotateY(rot);
          pair.translate(fx, fy, fz);
          parts.push(pair);
        });
      };
      addFlower(0, 0.94, 0);
      [0, 1, 2].forEach((idx) => {
        const yaw = (idx * 2 * Math.PI) / 3 + 0.7;
        const r = 0.14;
        const fx = -Math.sin(yaw) * r;
        const fz = Math.cos(yaw) * r;
        addFlower(fx, 0.82 + idx * 0.05, fz);
        addFlower(fx * 0.6, 0.9, fz * 0.6);

        // Slender ascending silique pod
        const silique = new CylinderGeometry(0.007, 0.009, 0.16, 4);
        silique.translate(0, 0.08, 0);
        silique.rotateZ(0.45);
        silique.rotateY(yaw + 0.4);
        silique.translate(0, 0.64, 0);
        parts.push(silique);
      });
      break;
    }
    case "alfalfa_raceme": {
      // Compact oblong/oval vertical purple racemes near upper shoot tips
      [0, 1, 2, 3, 4].forEach((idx) => {
        const yaw = (idx * Math.PI) / 3 + 0.15;
        const raceme = new SphereGeometry(0.048, 6, 5);
        raceme.scale(0.85, 1.45, 0.85);
        raceme.translate(-Math.sin(yaw) * 0.17, 0.86 + (idx % 2) * 0.05, Math.cos(yaw) * 0.17);
        parts.push(raceme);
      });
      break;
    }
    case "legume_pods": {
      // Nodal clusters of curved hanging pubescent soybean pods in leaf axils
      [0.34, 0.46, 0.58, 0.68].forEach((y, idx) => {
        const yaw = idx * 2.1;
        [-0.025, 0.025].forEach((offset) => {
          const pod = new SphereGeometry(0.026, 5, 4);
          pod.scale(0.55, 1.9, 0.7);
          pod.rotateZ(0.35);
          pod.translate(offset, y, 0.045);
          pod.rotateY(yaw);
          parts.push(pod);
        });
      });
      break;
    }
    case "pea_blossom_pods": {
      // Upper papilionaceous blossoms + lower pendulous pea pods along the 3 vines
      [0, 1, 2].forEach((idx) => {
        const yaw = (idx * 2 * Math.PI) / 3 + 0.2;
        const banner = new SphereGeometry(0.042, 6, 4);
        banner.scale(1.1, 0.9, 0.5);
        banner.translate(0, 0.78, 0.16);
        banner.rotateY(yaw);
        parts.push(banner);

        const pod = new SphereGeometry(0.024, 5, 4);
        pod.scale(0.45, 2.2, 0.65);
        pod.translate(0, 0.48, 0.12);
        pod.rotateY(yaw + 0.3);
        parts.push(pod);
      });
      break;
    }
  }

  const built = mergeBufferGeometries(parts);
  CROWN_GEOMETRIES.set(shape, built);
  return built;
}

/** Builds organic curved multi-segment root variants (0..2) for fibrous or taproot architectures. */
export function getRootVariantGeometry(kind: "fibrous" | "taproot", variant = 0): BufferGeometry {
  const v = ((variant % 3) + 3) % 3;
  const cacheKey = `${kind}-${v}`;
  const existing = ROOT_GEOMETRIES.get(cacheKey);
  if (existing) return existing;

  const parts: BufferGeometry[] = [];
  const addSegment = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    r0: number,
    r1: number,
    radialSegs = 4,
  ) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.max(0.001, Math.hypot(dx, dy, dz));
    // Rotation aligns local +Y (`radiusTop`) onto `dir` (start -> end), so pass `(r1, r0)`
    // so thick crown/parent radius `r0` sits at `(x0, y0, z0)` and tapers to `r1` at the tip.
    const seg = new CylinderGeometry(r1, r0, len, radialSegs);
    const up = new Vector3(0, 1, 0);
    const dir = new Vector3(dx, dy, dz).normalize();
    seg.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir));
    seg.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
    parts.push(seg);
  };

  if (kind === "fibrous") {
    const strandAngles =
      v === 0
        ? [-0.52, -0.34, -0.14, 0.04, 0.22, 0.4, 0.56]
        : v === 1
          ? [-0.58, -0.3, -0.06, 0.16, 0.38, 0.6]
          : [-0.56, -0.38, -0.2, -0.02, 0.14, 0.3, 0.46, 0.62];
    strandAngles.forEach((ang, idx) => {
      const len = (0.76 + ((idx + v) % 3) * 0.11) * (idx === 3 || idx === 2 ? 1.05 : 0.94);
      const midX = Math.sin(ang) * len * 0.48;
      const midY = -Math.cos(ang) * len * 0.48;
      const midZ = (((idx + v) % 3) - 1) * 0.028;
      const bend = ((idx % 2 === 0 ? 1 : -1) * 0.12 + (v - 1) * 0.08);
      const endX = midX + Math.sin(ang + bend) * len * 0.54;
      const endY = Math.max(-1.0, midY - Math.cos(ang + bend) * len * 0.54);
      const endZ = midZ * 1.3;

      addSegment(0, 0, 0, midX, midY, midZ, 0.015, 0.009, 4);
      addSegment(midX, midY, midZ, endX, endY, endZ, 0.009, 0.003, 4);

      const forkSide = (idx + v) % 2 === 0 ? 1 : -1;
      addSegment(
        midX * 0.65,
        midY * 0.65,
        midZ * 0.65,
        midX * 0.65 + forkSide * 0.14,
        midY * 0.65 - 0.18,
        midZ + 0.02,
        0.007,
        0.002,
        3,
      );
      addSegment(
        midX,
        midY,
        midZ,
        midX - forkSide * 0.12,
        midY - 0.19,
        midZ - 0.02,
        0.006,
        0.002,
        3,
      );
    });
  } else {
    const swayA = v === 0 ? 0.032 : v === 1 ? -0.038 : 0.024;
    const swayB = v === 0 ? -0.022 : v === 1 ? 0.028 : -0.034;
    const zCurve = (v - 1) * 0.022;
    addSegment(0, 0, 0, swayA, -0.34, zCurve, 0.036, 0.022, 6);
    addSegment(swayA, -0.34, zCurve, swayB, -0.7, zCurve * 0.4, 0.022, 0.011, 5);
    addSegment(swayB, -0.7, zCurve * 0.4, swayA * 0.5, -1.0, 0, 0.011, 0.003, 5);

    const laterals =
      v === 0
        ? [
            { y: -0.14, rx: swayA * 0.4, dx: 0.28, dy: -0.15, dz: 0.03 },
            { y: -0.24, rx: swayA * 0.7, dx: -0.3, dy: -0.17, dz: -0.02 },
            { y: -0.38, rx: swayA, dx: 0.24, dy: -0.18, dz: 0.02 },
            { y: -0.52, rx: swayB * 0.3, dx: -0.22, dy: -0.18, dz: 0.03 },
            { y: -0.68, rx: swayB, dx: 0.17, dy: -0.17, dz: -0.02 },
          ]
        : v === 1
          ? [
              { y: -0.12, rx: swayA * 0.35, dx: -0.27, dy: -0.14, dz: 0.02 },
              { y: -0.24, rx: swayA * 0.72, dx: 0.31, dy: -0.18, dz: 0.03 },
              { y: -0.37, rx: swayA * 0.85, dx: -0.25, dy: -0.17, dz: -0.02 },
              { y: -0.51, rx: swayB * 0.4, dx: 0.22, dy: -0.18, dz: 0.02 },
              { y: -0.65, rx: swayB * 0.85, dx: -0.18, dy: -0.16, dz: 0.02 },
              { y: -0.78, rx: swayB * 0.7, dx: 0.12, dy: -0.14, dz: -0.02 },
            ]
          : [
              { y: -0.16, rx: swayA * 0.45, dx: 0.26, dy: -0.15, dz: -0.02 },
              { y: -0.31, rx: swayA * 0.85, dx: -0.3, dy: -0.17, dz: 0.03 },
              { y: -0.49, rx: swayB * 0.3, dx: 0.23, dy: -0.19, dz: 0.02 },
              { y: -0.7, rx: swayB * 0.9, dx: -0.17, dy: -0.17, dz: -0.02 },
            ];
    laterals.forEach(({ y, rx, dx, dy, dz }, li) => {
      const mx = rx + dx * 0.55;
      const my = y + dy * 0.45;
      const mz = dz * 0.6;
      addSegment(rx, y, 0, mx, my, mz, 0.014, 0.008, 4);
      addSegment(mx, my, mz, rx + dx, y + dy, dz, 0.008, 0.0025, 3);
      if (li < (v === 1 ? 4 : v === 0 ? 3 : 2)) {
        addSegment(mx, my, mz, mx + dx * 0.35, my - 0.13, mz + 0.025, 0.006, 0.002, 3);
      }
    });
  }

  const built = mergeBufferGeometries(parts);
  ROOT_GEOMETRIES.set(cacheKey, built);
  return built;
}

export function getRootGeometry(kind: "fibrous" | "taproot"): BufferGeometry {
  return getRootVariantGeometry(kind, 0);
}

function createSoilTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#e2e0dd";
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 1600; i++) {
    const x = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = Math.abs(Math.sin(i * 78.233) * 19341.123) % 1;
    const shade = i % 5 === 0 ? 158 : i % 3 === 0 ? 186 : i % 2 === 0 ? 214 : 238;
    ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 4})`;
    const size = 1.5 + (i % 4);
    ctx.fillRect(x * 252, y * 252, size, size * (0.7 + (i % 3) * 0.2));
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

const DEPTH_MARKS_M = [0.5, 1.0, 1.5];
const LABEL_TEXTURES = new Map<string, CanvasTexture | null>();

/** A small text texture ("0.5 m") for scales drawn in the scene; null where no 2D canvas exists (tests). */
function getLabelTexture(text: string, pill = false): CanvasTexture | null {
  const key = pill ? `pill:${text}` : text;
  if (LABEL_TEXTURES.has(key)) return LABEL_TEXTURES.get(key) ?? null;
  let texture: CanvasTexture | null = null;
  const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (ctx) {
    if (pill) {
      ctx.canvas.width = 256;
      ctx.canvas.height = 96;
      ctx.fillStyle = "rgba(22, 34, 26, 0.92)";
      ctx.strokeStyle = "rgba(238, 245, 240, 0.90)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(10, 10, 212, 76, 38);
      ctx.fill();
      ctx.stroke();
      ctx.font = "700 46px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fbf6ea";
      ctx.fillText(text, 116, 49);
    } else {
      ctx.canvas.width = 160;
      ctx.canvas.height = 64;
      ctx.font = "700 40px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(30, 20, 12, 0.85)";
      ctx.fillStyle = "#fbf6ea";
      ctx.strokeText(text, 6, 34);
      ctx.fillText(text, 6, 34);
    }
    texture = new CanvasTexture(ctx.canvas);
  }
  LABEL_TEXTURES.set(key, texture);
  return texture;
}

function tintFrost(hex: string, frost: boolean): string {
  const color = new Color(hex);
  if (frost) color.lerp(FROST, FROST_TINT);
  return `#${color.getHexString()}`;
}

function plantColor(look: Look, frame: PlotFrame, frost: boolean): string {
  let color = new Color(look.color);
  if (frame.ripe && look.ripe) color = new Color(look.ripe);
  else if (frame.growth >= 1 && look.flower && look.crown !== "canola_raceme" && look.crown !== "pea_blossom_pods") {
    color = new Color(look.color).lerp(new Color(look.flower), 0.15);
  }
  if (frost) color.lerp(FROST, FROST_TINT);
  return `#${color.getHexString()}`;
}

function crownColor(look: Look, frame: PlotFrame, frost: boolean): string | null {
  if (!look.crown || frame.state !== "crop") return null;
  switch (look.crown) {
    case "canola_raceme":
    case "alfalfa_raceme":
      if (frame.growth < 0.72) return null;
      return tintFrost(frame.ripe && look.ripe ? look.ripe : (look.flower ?? "#f2d02a"), frost);
    case "pea_blossom_pods":
      if (frame.growth < 0.65) return null;
      return tintFrost(frame.ripe && look.ripe ? look.ripe : (look.flower ?? "#f3f5ec"), frost);
    case "legume_pods":
      if (frame.growth < 0.75) return null;
      return tintFrost(frame.ripe && look.ripe ? look.ripe : "#639e45", frost);
    case "corn_tassel_ear":
    case "sorghum_panicle":
    case "wheat_spike":
    case "barley_awned_spike":
    case "oat_open_panicle":
      if (frame.growth < 0.45) return null;
      return tintFrost(frame.ripe && look.ripe ? look.ripe : "#c9be6c", frost);
  }
}

function subsurfaceColor(look: Look | undefined, frame: PlotFrame, frost: boolean): string {
  if (frost) return "#b5d6eb";
  if (frame.ripe) return "#e8c458";
  if (look?.flower && frame.growth >= 1 && look.crown === "canola_raceme") return "#d9df4a";
  return "#9be04a";
}

function injectAfter(src: string, chunk: string, snippet: string): string {
  return src.replace(chunk, () => `${chunk}\n${snippet}`);
}

export interface FoliageUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uSubsurfaceColor: { value: Color };
  uFrost: { value: number };
}

/** Enhances MeshStandardMaterial with GPU multi-frequency wind waves, sky-biased normals, canopy AO, and backlit SSS. */
export function applyFoliageShader(material: MeshStandardMaterial, uniforms: FoliageUniforms, tag = "foliage-v1"): void {
  material.customProgramCacheKey = () => `${tag}-${material.vertexColors ? 1 : 0}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uSubsurfaceColor = uniforms.uSubsurfaceColor;
    shader.uniforms.uFrost = uniforms.uFrost;

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <common>",
      `
uniform float uTime;
uniform float uWindStrength;
varying float vPlantHeight;
varying float vInstanceHash;
`,
    );

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <beginnormal_vertex>",
      `
objectNormal = normalize( mix( objectNormal, vec3( 0.0, 1.0, 0.0 ), 0.32 ) );
`,
    );

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
vPlantHeight = clamp( position.y, 0.0, 1.2 );
vec4 instOrigin = vec4( 0.0, 0.0, 0.0, 1.0 );
vec4 instWorldPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  instOrigin = instanceMatrix * instOrigin;
  instWorldPos = instanceMatrix * instWorldPos;
#endif
instOrigin = modelMatrix * instOrigin;
instWorldPos = modelMatrix * instWorldPos;
vInstanceHash = fract( sin( dot( instOrigin.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
float hBend = clamp( vPlantHeight, 0.0, 1.15 );
float bendProfile = hBend * hBend;
float primaryWave = sin( uTime * 2.1 + instOrigin.x * 0.85 + instOrigin.z * 0.55 + vInstanceHash * 3.14159 );
float tipFlutter = cos( uTime * 4.3 + instWorldPos.x * 2.3 - instWorldPos.z * 1.9 ) * 0.25;
float windDisp = ( primaryWave + tipFlutter ) * bendProfile * uWindStrength;
transformed.x += windDisp;
transformed.z += windDisp * 0.48;
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <common>",
      `
uniform vec3 uSubsurfaceColor;
uniform float uFrost;
varying float vPlantHeight;
varying float vInstanceHash;
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <color_fragment>",
      `
float canopyAo = mix( 0.62, 1.12, smoothstep( 0.0, 0.85, vPlantHeight ) );
diffuseColor.rgb *= canopyAo * ( 0.94 + vInstanceHash * 0.12 );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <lights_fragment_begin>",
      `
#if NUM_DIR_LIGHTS > 0
  vec3 halfLight = normalize( directionalLights[ 0 ].direction + geometryNormal * 0.35 );
  float backDot = saturate( dot( -geometryViewDir, halfLight ) );
  float backScatter = backDot * backDot * sqrt( max( backDot, 1e-5 ) );
  float sssMask = smoothstep( 0.15, 0.95, vPlantHeight );
  vec3 sssRadiance = backScatter * sssMask * uSubsurfaceColor * directionalLights[ 0 ].color * 0.55;
  reflectedLight.directDiffuse += sssRadiance;
#endif
if ( uFrost > 0.0 ) {
  float frostRimBase = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
  float frostFresnel = frostRimBase * frostRimBase;
  float upMask = smoothstep( 0.05, 0.75, geometryNormal.y * 0.5 + 0.5 );
  totalEmissiveRadiance += vec3( 0.18, 0.22, 0.27 ) * frostFresnel * upMask * uFrost * 0.18;
}
`,
    );
  };
}

export interface SoilUniforms {
  uWetness: { value: number };
  uHorizon: { value: number };
  uSnow?: { value: number };
  uFrost?: { value: number };
}

/** Enhances soil and cutaway faces with 3D crumbs, organic horizon waves, wetness PBR roughness, selective ridge frost, and top-only winter snow blanketing. */
export function applySoilShader(material: MeshStandardMaterial, uniforms: SoilUniforms): void {
  const snowUniform = uniforms.uSnow ?? { value: 0 };
  const frostUniform = uniforms.uFrost ?? { value: 0 };
  material.customProgramCacheKey = () => "soil-triplanar-v3";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = uniforms.uWetness;
    shader.uniforms.uHorizon = uniforms.uHorizon;
    shader.uniforms.uSnow = snowUniform;
    shader.uniforms.uFrost = frostUniform;

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <common>",
      `
varying vec3 vSoilWorldPos;
varying vec3 vSoilWorldNormal;
`,
    );

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
vec4 soilWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  soilWorld = instanceMatrix * soilWorld;
#endif
soilWorld = modelMatrix * soilWorld;
vSoilWorldPos = soilWorld.xyz;
vec3 soilNorm = vec3( objectNormal );
#ifdef USE_INSTANCING
  soilNorm = mat3( instanceMatrix ) * soilNorm;
#endif
vSoilWorldNormal = normalize( mat3( modelMatrix ) * soilNorm );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <common>",
      `
uniform float uWetness;
uniform float uHorizon;
uniform float uSnow;
uniform float uFrost;
varying vec3 vSoilWorldPos;
varying vec3 vSoilWorldNormal;

float soilHash3( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float soilNoise3( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix(
      mix( soilHash3( i + vec3( 0.0, 0.0, 0.0 ) ), soilHash3( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
      mix( soilHash3( i + vec3( 0.0, 1.0, 0.0 ) ), soilHash3( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ),
      f.y
    ),
    mix(
      mix( soilHash3( i + vec3( 0.0, 0.0, 1.0 ) ), soilHash3( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
      mix( soilHash3( i + vec3( 0.0, 1.0, 1.0 ) ), soilHash3( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ),
      f.y
    ),
    f.z
  );
}

float fbmSoil( vec3 p ) {
  float sum = 0.0;
  float amp = 0.5;
  sum += amp * soilNoise3( p );
  p *= 2.15;
  amp *= 0.5;
  sum += amp * soilNoise3( p );
  p *= 2.15;
  amp *= 0.5;
  sum += amp * soilNoise3( p );
  return sum;
}
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <color_fragment>",
      `
float macroNoise = fbmSoil( vSoilWorldPos * vec3( 2.2, 5.5, 2.2 ) );
float microCrumbs = soilNoise3( vSoilWorldPos * 18.0 );
float pedSpeckle = soilNoise3( vSoilWorldPos * 34.0 );
float strata = sin( vSoilWorldPos.y * 26.0 + macroNoise * 4.5 ) * 0.5 + 0.5;
float texMix = mix( macroNoise, microCrumbs, 0.48 );
float horizonShade = uHorizon > 1.5 ? 0.92 : ( uHorizon > 0.5 ? 0.98 : 1.0 );
diffuseColor.rgb *= ( 0.74 + texMix * 0.42 ) * mix( 0.92, 1.07, strata ) * horizonShade;

// Soft undulating horizon seams + natural mineral stones/humus mottling in the cutaway wall.
float wallMask = 1.0 - smoothstep( 0.35, 0.72, abs( vSoilWorldNormal.y ) );
float seamWave = ( macroNoise - 0.5 ) * 0.045 + sin( vSoilWorldPos.x * 2.3 + vSoilWorldPos.z * 1.6 ) * 0.014;
float organicTongue = smoothstep( -0.14, 0.04, vSoilWorldPos.y + seamWave );
vec3 humusTone = diffuseColor.rgb * 0.78;
if ( uHorizon > 0.5 && uHorizon < 1.5 ) {
  diffuseColor.rgb = mix( diffuseColor.rgb, humusTone, organicTongue * wallMask * 0.52 );
}
float pebbleSpot = smoothstep( 0.80, 0.94, pedSpeckle ) * step( 0.5, uHorizon ) * wallMask;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.56, 0.50, 0.44 ), pebbleSpot * 0.42 );

float wetFactor = saturate( uWetness * ( 0.65 + 0.35 * macroNoise ) );
diffuseColor.rgb *= mix( 1.0, 0.60, wetFactor );

float soilChannelShade = 1.0;
#ifdef USE_COLOR
  soilChannelShade = vColor.r;
#endif
float topUpFace = smoothstep( 0.32, 0.74, vSoilWorldNormal.y );
float snowRimLip = smoothstep( 0.118 - macroNoise * 0.032, 0.148, vSoilWorldPos.y ) * ( 1.0 - step( 0.5, uHorizon ) );
float snowCap = saturate( max( topUpFace, snowRimLip * 0.88 ) * uSnow * ( 0.86 + 0.24 * macroNoise ) );
vec3 snowDriftCol = mix( vec3( 0.76, 0.84, 0.94 ), vec3( 0.94, 0.965, 1.0 ), smoothstep( 0.28, 0.78, soilChannelShade * 0.65 + macroNoise * 0.4 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, snowDriftCol, snowCap );

// Subtle crystalline morning hoarfrost only on the highest dry furrow/clod crests (never washes loam gray).
float crestPeak = smoothstep( 0.68, 0.92, soilChannelShade + ( macroNoise - 0.5 ) * 0.22 );
float hoarfrostGrain = smoothstep( 0.54, 0.88, microCrumbs );
float dryExpose = 1.0 - smoothstep( 0.28, 0.72, uWetness );
float frostRime = topUpFace * crestPeak * hoarfrostGrain * uFrost * dryExpose * ( 1.0 - snowCap );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.38, 0.44 ), saturate( frostRime * 0.48 ) );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <roughnessmap_fragment>",
      `
float wetGloss = saturate( uWetness * ( 0.7 + 0.3 * fbmSoil( vSoilWorldPos * 3.0 ) ) );
float horizonMask = 1.0 - smoothstep( 0.5, 2.5, uHorizon );
// Keep soil clods matte when damp; concentrate slick rainwater mud sheen in depressed furrows & rills.
float channelWet = 0.0;
#ifdef USE_COLOR
  channelWet = 1.0 - smoothstep( 0.56, 0.80, vColor.r );
#endif
float topSnowRoughMask = smoothstep( 0.32, 0.74, vSoilWorldNormal.y ) * uSnow;
float microRoughNoise = soilNoise3( vSoilWorldPos * 16.0 );
roughnessFactor = mix( roughnessFactor, 0.66, wetGloss * horizonMask );
roughnessFactor = mix( roughnessFactor, 0.24, wetGloss * horizonMask * channelWet );
roughnessFactor = mix( roughnessFactor, 0.44 + microRoughNoise * 0.38, topSnowRoughMask );
roughnessFactor = clamp( roughnessFactor + ( microRoughNoise - 0.5 ) * 0.14, 0.22, 0.98 );
`,
    );
  };
}

export interface GroundUniforms {
  uSnow: { value: number };
  uFrost?: { value: number };
  uDryness: { value: number };
  uTrenchHalfWidth: { value: number };
  uTrenchFrontZ: { value: number };
  uPlotHalfZ: { value: number };
}

/** Upgrades surrounding field apron and rolling hills with crisp meadow turf blades, patchwork rural parcels, selective morning frost, snow drifts, and pit contact AO. */
export function applyGroundShader(material: MeshStandardMaterial, uniforms: GroundUniforms): void {
  const frostUniform = uniforms.uFrost ?? { value: 0 };
  material.customProgramCacheKey = () => "ground-terrain-v3";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = uniforms.uSnow;
    shader.uniforms.uFrost = frostUniform;
    shader.uniforms.uDryness = uniforms.uDryness;
    shader.uniforms.uTrenchHalfWidth = uniforms.uTrenchHalfWidth;
    shader.uniforms.uTrenchFrontZ = uniforms.uTrenchFrontZ;
    shader.uniforms.uPlotHalfZ = uniforms.uPlotHalfZ;

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <common>",
      `
varying vec3 vGroundWorldPos;
varying vec3 vGroundWorldNormal;
`,
    );

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
vec4 gw = modelMatrix * vec4( transformed, 1.0 );
vGroundWorldPos = gw.xyz;
vGroundWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <common>",
      `
uniform float uSnow;
uniform float uFrost;
uniform float uDryness;
uniform float uTrenchHalfWidth;
uniform float uTrenchFrontZ;
uniform float uPlotHalfZ;
varying vec3 vGroundWorldPos;
varying vec3 vGroundWorldNormal;

float gHash2( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}

float gNoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( gHash2( i ), gHash2( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( gHash2( i + vec2( 0.0, 1.0 ) ), gHash2( i + vec2( 1.0, 1.0 ) ), f.x ),
    f.y
  );
}

float fbmGround( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  sum += amp * gNoise2( p );
  p *= 2.07;
  amp *= 0.5;
  sum += amp * gNoise2( p );
  p *= 2.07;
  amp *= 0.5;
  sum += amp * gNoise2( p );
  return sum;
}
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <color_fragment>",
      `
float gMacro = fbmGround( vGroundWorldPos.xz * 0.085 );
float gDetail = gNoise2( vGroundWorldPos.xz * 0.72 );
float gFine = gNoise2( vGroundWorldPos.xz * 2.6 );
float gTurfBlade = gNoise2( vGroundWorldPos.xz * 8.2 );
float farFade = smoothstep( 16.0, 88.0, length( vGroundWorldPos.xz ) );

// Crisp mowed trial apron turf with close-range blade texture and subtle clover warmth
float turfTex = mix( gMacro, mix( gDetail, mix( gFine, gTurfBlade, 0.42 ), 0.55 ), 0.52 * ( 1.0 - farFade ) );
vec3 apronGrass = diffuseColor.rgb * mix( 0.80, 1.18, turfTex );
float mowerStripe = sin( vGroundWorldPos.x * 1.15 ) * 0.5 + 0.5;
apronGrass *= mix( 0.955, 1.045, mowerStripe * ( 1.0 - farFade ) );

// Surveyed patchwork farmland parcels across the outer valley & rolling horizon hills
vec2 ruralRot = mat2( 0.985, -0.174, 0.174, 0.985 ) * vGroundWorldPos.xz;
vec2 warp = vec2( fbmGround( ruralRot * 0.022 ) - 0.5, fbmGround( ruralRot * 0.022 + vec2( 5.2, 1.3 ) ) - 0.5 ) * 4.5;
vec2 parcelScale = vec2( 24.0, 17.5 );
vec2 parcelCoord = ( ruralRot + warp ) / parcelScale;
vec2 parcelId = floor( parcelCoord );
vec2 parcelFrac = fract( parcelCoord );
float parcelEdge = min(
  min( parcelFrac.x, 1.0 - parcelFrac.x ) * parcelScale.x,
  min( parcelFrac.y, 1.0 - parcelFrac.y ) * parcelScale.y
);
float parcelKind = gHash2( parcelId + vec2( 3.1, 7.4 ) );
float stripCoord = ( parcelKind < 0.5 ? ruralRot.x : ruralRot.y ) + warp.x * 0.25;
float rowStripes = sin( stripCoord * 2.4 + gMacro * 0.6 ) * 0.5 + 0.5;
float hayWindrow = sin( stripCoord * 0.65 ) * 0.5 + 0.5;

vec3 alfalfaColor = vec3( 0.095, 0.228, 0.048 ) * mix( 0.88, 1.14, gMacro );
vec3 stubbleColor = vec3( 0.435, 0.318, 0.115 ) * mix( 0.88, 1.10, mix( rowStripes, gMacro, farFade * 0.7 ) );
vec3 pastureColor = vec3( 0.168, 0.305, 0.074 ) * mix( 0.90, 1.10, hayWindrow );
vec3 furrowColor = vec3( 0.125, 0.075, 0.038 ) * mix( 0.84, 1.16, mix( rowStripes, gMacro, farFade * 0.75 ) );
vec3 ryeColor = vec3( 0.118, 0.262, 0.062 ) * mix( 0.88, 1.12, gDetail );

vec3 parcelFill = ryeColor;
if ( parcelKind < 0.24 ) parcelFill = alfalfaColor;
else if ( parcelKind < 0.46 ) parcelFill = mix( stubbleColor, alfalfaColor, farFade * 0.12 );
else if ( parcelKind < 0.68 ) parcelFill = pastureColor;
else if ( parcelKind < 0.83 ) parcelFill = furrowColor;

vec3 headlandMargin = vec3( 0.142, 0.262, 0.062 ) * mix( 0.90, 1.08, gMacro );
float borderMask = 1.0 - smoothstep( 0.45, 2.0, parcelEdge );
vec3 patchwork = mix( parcelFill, headlandMargin, borderMask );

// Blend smoothly from the calm specimen apron into the wider patchwork countryside
float dxApron = abs( vGroundWorldPos.x ) - ( uTrenchHalfWidth + 2.8 );
float dzApron = max( -9.5 - vGroundWorldPos.z, vGroundWorldPos.z - ( uTrenchFrontZ + 4.5 ) );
float apronDist = max( dxApron, dzApron );
float ruralMask = smoothstep( 0.0, 5.2, apronDist );
vec3 valleyColor = mix( apronGrass, patchwork, ruralMask );

// Gentle valley & hilltop shading across undulating terrain contours
float hillSun = saturate( vGroundWorldNormal.y * 0.45 + vGroundWorldNormal.x * 0.35 - vGroundWorldNormal.z * 0.22 + 0.36 );
float hillContour = mix( 0.88, 1.12, hillSun ) * mix( 0.94, 1.05, smoothstep( 0.1, 3.6, vGroundWorldPos.y ) );
valleyColor *= hillContour;

vec3 dryMeadow = mix( valleyColor, vec3( 0.42, 0.36, 0.19 ), uDryness * 0.36 * ( 0.65 + 0.35 * gMacro ) );

// Subtle cool silvery morning dew/frost glint on turf blades without splotchy white patches.
float meadowFrostMask = smoothstep( 0.62, 0.92, gFine * 0.4 + gTurfBlade * 0.6 ) * saturate( uFrost );
vec3 dewFrostTint = dryMeadow * vec3( 1.05, 1.15, 1.32 ) + vec3( 0.09, 0.12, 0.16 );
dryMeadow = mix( dryMeadow, dewFrostTint, meadowFrostMask * 0.34 );

// Wind-sculpted snow drifts with cool sky hollows, luminous crests, and faint frost-buried parcel contours
float driftWave = fbmGround( vGroundWorldPos.xz * vec2( 0.14, 0.34 ) + vec2( 2.1, -0.7 ) );
float slopeLight = saturate( vGroundWorldNormal.z * 0.5 + 0.5 );
vec3 snowBlanket = mix( vec3( 0.66, 0.77, 0.90 ), vec3( 0.94, 0.97, 1.0 ), smoothstep( 0.20, 0.76, driftWave * 0.68 + slopeLight * 0.32 ) );
snowBlanket *= mix( 0.94, 1.04, smoothstep( 0.2, 2.8, vGroundWorldPos.y ) );
snowBlanket = mix( snowBlanket, dryMeadow * 0.72, ruralMask * 0.06 * ( 1.0 - borderMask ) );
diffuseColor.rgb = mix( dryMeadow, snowBlanket, saturate( uSnow ) );

// Subtle ground contact AO halo bordering the inspection trench & plot perimeter
float dxPit = abs( vGroundWorldPos.x ) - uTrenchHalfWidth;
float dzPit = max( -uPlotHalfZ - vGroundWorldPos.z, vGroundWorldPos.z - uTrenchFrontZ );
float edgeDist = max( dxPit, dzPit );
float contactAO = mix( 0.80, 1.0, smoothstep( -0.05, 0.88, edgeDist ) );
diffuseColor.rgb *= contactAO;
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <roughnessmap_fragment>",
      `
float snowSparkle = gNoise2( vGroundWorldPos.xz * 2.4 );
roughnessFactor = clamp( mix( 0.93, 0.40 + snowSparkle * 0.44, saturate( uSnow ) ), 0.35, 0.98 );
`,
    );
  };
}

/** Applies winter frost desaturation and upper-bough snow flocking to shelterbelt evergreens and hedgerow shrubs. */
function applyWindbreakSnowShader(material: MeshStandardMaterial, uSnow: { value: number }): void {
  material.customProgramCacheKey = () => "windbreak-snow-v2";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = uSnow;
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <common>",
      `
varying vec3 vTreeWorldNormal;
varying float vTreeLocalY;
`,
    );
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
vTreeLocalY = transformed.y;
vec3 tn = vec3( objectNormal );
#ifdef USE_INSTANCING
  tn = mat3( instanceMatrix ) * tn;
#endif
vTreeWorldNormal = normalize( mat3( modelMatrix ) * tn );
`,
    );
    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <common>",
      `
uniform float uSnow;
varying vec3 vTreeWorldNormal;
varying float vTreeLocalY;
`,
    );
    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <color_fragment>",
      `
vec3 winterMuted = mix( diffuseColor.rgb, vec3( 0.14, 0.17, 0.19 ), saturate( uSnow ) * 0.52 );
float boughSnow = smoothstep( 0.18, 0.68, vTreeWorldNormal.y ) * smoothstep( 0.20, 0.58, vTreeLocalY ) * uSnow;
diffuseColor.rgb = mix( winterMuted, vec3( 0.89, 0.94, 0.99 ), saturate( boughSnow * 0.90 ) );
`,
    );
  };
}

/** Shades underground roots from suberized upper crowns to pale growing tips with a subtle cutaway rim glow. */
export function applyRootShader(material: MeshStandardMaterial): void {
  material.customProgramCacheKey = () => "root-rhizosphere-v1";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <common>",
      `
varying float vRootDepth;
`,
    );

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
vRootDepth = clamp( -position.y, 0.0, 1.0 );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <common>",
      `
varying float vRootDepth;
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <color_fragment>",
      `
vec3 crownWood = vec3( 0.76, 0.60, 0.38 );
vec3 youngTip = vec3( 0.96, 0.93, 0.80 );
diffuseColor.rgb = mix( diffuseColor.rgb * crownWood, youngTip, smoothstep( 0.15, 0.95, vRootDepth ) );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <lights_fragment_begin>",
      `
float rootRimBase = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
float rootRim = pow( max( rootRimBase, 1e-4 ), 2.2 );
totalEmissiveRadiance += diffuseColor.rgb * rootRim * 0.22;
`,
    );
  };
}

export interface CloudUniforms {
  uTime: { value: number };
  uDark: { value: number };
}

/** Enhances cumulus clouds with animated internal billow shading, cool sky undersides, and subtle sunlit rim light. */
export function applyCloudShader(material: MeshStandardMaterial, uniforms: CloudUniforms): void {
  material.customProgramCacheKey = () => "cloud-fresnel-v3";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDark = uniforms.uDark;

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <common>",
      `
varying vec3 vCloudLocalPos;
`,
    );

    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
vCloudLocalPos = position;
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <common>",
      `
uniform float uTime;
uniform float uDark;
varying vec3 vCloudLocalPos;

float cloudHash3( vec3 p ) {
  p = fract( p * vec3( 443.897, 441.423, 437.195 ) );
  p += dot( p, p.yxz + 19.19 );
  return fract( ( p.x + p.y ) * p.z );
}

float cloudNoise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix(
      mix( cloudHash3( i ), cloudHash3( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
      mix( cloudHash3( i + vec3( 0.0, 1.0, 0.0 ) ), cloudHash3( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ),
      f.y
    ),
    mix(
      mix( cloudHash3( i + vec3( 0.0, 0.0, 1.0 ) ), cloudHash3( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
      mix( cloudHash3( i + vec3( 0.0, 1.0, 1.0 ) ), cloudHash3( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ),
      f.y
    ),
    f.z
  );
}
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <color_fragment>",
      `
float puff = cloudNoise3( vCloudLocalPos * 1.4 + vec3( uTime * 0.06, 0.0, 0.0 ) );
float bellyShade = smoothstep( -0.35, 0.95, vCloudLocalPos.y );
vec3 bellyTint = mix( vec3( 0.78, 0.86, 0.95 ), vec3( 0.56, 0.63, 0.73 ), uDark );
diffuseColor.rgb = mix( bellyTint, diffuseColor.rgb * ( 0.99 + puff * 0.06 ), bellyShade );
`,
    );

    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "#include <lights_fragment_begin>",
      `
float cloudRimBase = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
float fresnelRim = pow( max( cloudRimBase, 1e-4 ), 2.6 );
vec3 rimGlow = mix( vec3( 0.98, 0.99, 1.0 ), vec3( 0.80, 0.86, 0.93 ), uDark );
totalEmissiveRadiance += rimGlow * fresnelRim * 0.18;
`,
    );
  };
}

/** Builds a procedural atmospheric sky dome ShaderMaterial whose horizon locks cleanly to the active fog color. */
export function buildSkyDomeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new Color("#3a78c2") },
      uHorizon: { value: new Color("#c4ddf2") },
      uSunColor: { value: new Color("#fff4dc") },
      uSunDir: { value: new Vector3(0.45, 0.55, -0.7).normalize() },
      uStorm: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
varying vec3 vSkyDir;
void main() {
  vSkyDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uStorm;
uniform float uTime;
varying vec3 vSkyDir;

float skyHash2( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}

float skyNoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( skyHash2( i ), skyHash2( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( skyHash2( i + vec2( 0.0, 1.0 ) ), skyHash2( i + vec2( 1.0, 1.0 ) ), f.x ),
    f.y
  );
}

float skyFbm( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  sum += amp * skyNoise2( p );
  p *= 2.05;
  amp *= 0.5;
  sum += amp * skyNoise2( p );
  p *= 2.05;
  amp *= 0.5;
  sum += amp * skyNoise2( p );
  return sum;
}

void main() {
  vec3 dir = normalize( vSkyDir );
  float elev = max( dir.y, 0.0 );
  float grad = pow( elev, 0.56 );
  vec3 sky = mix( uHorizon, uZenith, grad );

  float sunCos = max( dot( dir, normalize( uSunDir ) ), 0.0 );
  float halo = pow( sunCos, 8.0 ) * 0.24 + pow( sunCos, 64.0 ) * 0.16;
  sky += uSunColor * halo * ( 1.0 - uStorm * 0.82 ) * smoothstep( -0.02, 0.35, dir.y );

  vec2 wispUv = dir.xz / max( elev + 0.18, 0.18 ) * 1.45 + vec2( uTime * 0.004, uTime * 0.0015 );
  float wisp = smoothstep( 0.48, 0.86, skyFbm( wispUv ) ) * smoothstep( 0.04, 0.34, elev );
  vec3 wispTint = mix( vec3( 0.94, 0.97, 1.0 ), vec3( 0.68, 0.74, 0.82 ), uStorm );
  sky = mix( sky, wispTint, wisp * mix( 0.24, 0.40, uStorm ) );

  sky = mix( uHorizon, sky, smoothstep( -0.01, 0.035, dir.y ) );
  gl_FragColor = vec4( sky, 1.0 );
  #include <colorspace_fragment>
}
`,
  });
}

let cachedStubbleGeom: BufferGeometry | null = null;

function getStubbleGeometry(): BufferGeometry {
  if (cachedStubbleGeom) return cachedStubbleGeom;
  const parts: BufferGeometry[] = [];
  // 3 clipped harvest stalks + 1 scattered straw fragment lying on the furrow shoulder
  const stalks: [dx: number, dz: number, h: number, tiltX: number, tiltZ: number][] = [
    [-0.035, -0.02, 0.085, 0.14, 0.08],
    [0.032, 0.015, 0.072, -0.1, -0.16],
    [-0.008, 0.038, 0.065, 0.08, -0.09],
  ];
  stalks.forEach(([dx, dz, h, tx, tz]) => {
    const straw = new CylinderGeometry(0.011, 0.016, h, 5);
    straw.translate(0, h / 2, 0);
    straw.rotateX(tx);
    straw.rotateZ(tz);
    straw.translate(dx, 0, dz);
    parts.push(paintVertexGradient(straw, "#735a38", "#c8ab6f", 0, h));
  });
  const litter = new CylinderGeometry(0.008, 0.009, 0.16, 4);
  litter.rotateZ(Math.PI / 2 - 0.08);
  litter.rotateY(0.55);
  litter.translate(0.04, 0.014, -0.02);
  parts.push(paintVertexGradient(litter, "#96794a", "#bea068", 0, 0.03));

  cachedStubbleGeom = mergeBufferGeometries(parts);
  return cachedStubbleGeom;
}

function Stubble({ visible, frost }: { visible: boolean; frost: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const geom = useMemo(() => getStubbleGeometry(), []);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    POSITIONS.forEach(([x, z], i) => {
      dummy.position.set(x, SOIL_TOP + 0.006, z);
      dummy.rotation.set(0, (i * 1.17) % (Math.PI * 2), ((i % 3) - 1) * 0.06);
      const s = 0.85 + (i % 4) * 0.12;
      dummy.scale.set(s, 0.9 + (i % 3) * 0.15, s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  return (
    <instancedMesh ref={mesh} args={[geom, undefined, POSITIONS.length]} visible={visible} castShadow>
      <meshStandardMaterial vertexColors color={frost ? "#dbe2e6" : "#ffffff"} roughness={0.92} />
    </instancedMesh>
  );
}

export interface SpringScalarState {
  value: number;
  velocity: number;
}

/** Integrates a second-order Hookean spring-damper for smooth physical growth & root extension. */
export function stepSpringScalar(
  state: SpringScalarState,
  target: number,
  dt: number,
  stiffness = 120,
  damping = 16,
): number {
  const clampedDt = Math.min(Math.max(dt, 0), 0.05);
  const accel = (target - state.value) * stiffness - state.velocity * damping;
  state.velocity += accel * clampedDt;
  state.value += state.velocity * clampedDt;
  return state.value;
}

/** Real-time `cannon-es` rigid-body & spring-damper simulation for all 81 field plants. */
export class PlantCanopyPhysics {
  readonly world: World;
  readonly anchors: Body[] = [];
  readonly bodies: Body[] = [];
  readonly springs: Spring[] = [];

  constructor() {
    this.world = new World();
    this.world.broadphase = new NaiveBroadphase();

    for (const [x, z] of POSITIONS) {
      const anchor = new Body({
        mass: 0,
        position: new Vec3(x, 0, z),
        collisionFilterGroup: 0,
        collisionFilterMask: 0,
      });
      const body = new Body({
        mass: 0.45,
        shape: new Particle(),
        position: new Vec3(x, 0, z),
        linearDamping: 0.15,
        collisionFilterGroup: 0,
        collisionFilterMask: 0,
      });
      const spring = new Spring(body, anchor, {
        restLength: 0,
        stiffness: 28,
        damping: 4.2,
      });
      this.world.addBody(anchor);
      this.world.addBody(body);
      this.anchors.push(anchor);
      this.bodies.push(body);
      this.springs.push(spring);
    }
  }

  /** Applies a radial impulse outward from a cursor interaction point over the plot. */
  applyImpulseAt(localX: number, localZ: number, strength = 1.0, radius = 1.35): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const dx = body.position.x - localX;
      const dz = body.position.z - localZ;
      const dist = Math.hypot(dx, dz);
      if (dist >= radius) continue;
      const mag = strength * (1 - dist / radius);
      const nx = dist > 1e-4 ? dx / dist : 1;
      const nz = dist > 1e-4 ? dz / dist : 0;
      body.applyImpulse(new Vec3(nx * mag, 0, nz * mag));
    }
  }

  /** Steps aerodynamic wind gusts and Hookean spring restoration across all plants. */
  step(dt: number, elapsedTime: number, storm: boolean, shape: Shape): void {
    let stiffness = 28;
    let damping = 4.0;
    if (shape === "corn_stalk" || shape === "sorghum_stalk") {
      stiffness = 34;
      damping = 4.8;
    } else if (shape === "cereal_tillers" || shape === "rye_tuft") {
      stiffness = 22;
      damping = 3.4;
    }

    const gustScale = storm ? 3.2 : 1.3;
    const crossScale = storm ? 1.4 : 0.55;
    for (let i = 0; i < this.bodies.length; i++) {
      const [ax, az] = POSITIONS[i];
      const gust =
        (Math.sin(elapsedTime * 1.9 + ax * 0.7 + az * 0.45) + 0.5 * Math.cos(elapsedTime * 3.4 + ax * 1.4 - az * 1.1)) *
        gustScale;
      const cross = Math.cos(elapsedTime * 1.3 + az * 0.8 + i * 0.2) * crossScale;
      this.bodies[i].applyForce(new Vec3(gust, 0, cross));
      this.springs[i].stiffness = stiffness;
      this.springs[i].damping = damping;
      this.springs[i].applyForce();
    }

    this.world.step(1 / 60, Math.min(Math.max(dt, 0), 0.05), 3);

    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const anchor = this.anchors[i];
      body.position.y = 0;
      body.velocity.y = 0;
      const dx = body.position.x - anchor.position.x;
      const dz = body.position.z - anchor.position.z;
      const r = Math.hypot(dx, dz);
      if (r > 0.45) {
        const s = 0.45 / r;
        body.position.x = anchor.position.x + dx * s;
        body.position.z = anchor.position.z + dz * s;
      }
    }
  }

  /** Converts lateral displacement into local plant pitch/roll angles. */
  getTilt(index: number): { rotX: number; rotZ: number } {
    const dx = this.bodies[index].position.x - this.anchors[index].position.x;
    const dz = this.bodies[index].position.z - this.anchors[index].position.z;
    return {
      rotX: Math.max(-0.55, Math.min(0.55, dz * 1.15)),
      rotZ: Math.max(-0.55, Math.min(0.55, -dx * 1.15)),
    };
  }
}

/**
 * Plants drawn per grid cell along the row. Drilled crops (small grains, rye) stand
 * close together; wide-row crops less so. Alfalfa's model is already a dense clump and
 * the heaviest to draw. `dense` is false on small screens to keep the frame rate up.
 */
export function plantsPerCell(shape: Shape, dense: boolean): number {
  if (!dense || shape === "alfalfa_clump") return 1;
  return shape === "cereal_tillers" || shape === "rye_tuft" ? 3 : 2;
}

function Plants({
  frame,
  frost,
  storm = false,
  dense,
}: {
  frame: PlotFrame;
  frost: boolean;
  storm?: boolean;
  dense: boolean;
}) {
  const look = frame.crop ? LOOKS[frame.crop] : undefined;
  const isBare = frame.state === "bare" || !look;
  const clearFrost = frost && !storm;
  const cColor = look ? crownColor(look, frame, clearFrost) : null;
  const cropGeom = useMemo(() => (look ? getCropGeometry(look.shape) : null), [look]);
  const crownGeom = useMemo(() => (look?.crown && cColor ? getCrownGeometry(look.crown) : null), [look, cColor]);
  const canopyPhysics = useMemo(() => new PlantCanopyPhysics(), []);
  const heightSpring = useRef<SpringScalarState>({ value: 0, velocity: 0 });

  const foliageUniforms = useMemo<FoliageUniforms>(
    () => ({
      uTime: { value: 0 },
      uWindStrength: { value: 0.068 },
      uSubsurfaceColor: { value: new Color("#9be04a") },
      uFrost: { value: 0 },
    }),
    [],
  );

  const materials = useMemo(() => {
    const foliage = new MeshStandardMaterial({ color: "#3b8734", roughness: 0.72 });
    const crown = new MeshStandardMaterial({ color: "#c9be6c", roughness: 0.65 });
    applyFoliageShader(foliage, foliageUniforms, "foliage-v1");
    applyFoliageShader(crown, foliageUniforms, "foliage-crown-v1");
    return { foliage, crown };
  }, [foliageUniforms]);

  useEffect(() => {
    const clearFrost = frost && !storm;
    // A light rim: rain washes surface frost off foliage; dry mornings get a gentle cool sheen.
    foliageUniforms.uFrost.value = clearFrost ? 0.35 : 0;
    foliageUniforms.uWindStrength.value = frame.state === "planted" ? 0.04 : 0.068;
    foliageUniforms.uSubsurfaceColor.value.set(subsurfaceColor(look, frame, clearFrost));
    if (look) materials.foliage.color.set(plantColor(look, frame, clearFrost));
    if (cColor) materials.crown.color.set(cColor);
  }, [foliageUniforms, materials, look, frame, frost, storm, cColor]);

  useEffect(
    () => () => {
      materials.foliage.dispose();
      materials.crown.dispose();
    },
    [materials],
  );

  const mesh = useRef<InstancedMesh>(null);
  const crownMesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const target = look && frame.state !== "bare" ? look.height * Math.max(frame.growth, 0.08) : 0;
  const perCell = look ? plantsPerCell(look.shape, dense) : 1;
  const instanceCount = POSITIONS.length * perCell;

  useFrame(({ clock }, delta) => {
    foliageUniforms.uTime.value = clock.elapsedTime;
    const m = mesh.current;
    if (isBare || !m || !look) {
      heightSpring.current.value = 0;
      heightSpring.current.velocity = 0;
      return;
    }
    const h = Math.max(stepSpringScalar(heightSpring.current, target, delta, 110, 15), 0.001);
    canopyPhysics.step(delta, clock.elapsedTime, storm, look.shape);
    const cm = crownMesh.current;
    const xzScale = look.width * Math.min(1.1, Math.max(0.35, h / look.height + 0.25));

    POSITIONS.forEach(([x, z], i) => {
      const tilt = canopyPhysics.getTilt(i);
      // Neighbours along the row share the cell's sway and differ a little in height.
      for (let k = 0; k < perCell; k++) {
        const n = i * perCell + k;
        dummy.position.set(x + ((k + 0.5) / perCell - 0.5) * CELL, SOIL_TOP, z);
        dummy.rotation.set(tilt.rotX, (n * 1.1) % (Math.PI * 2), tilt.rotZ);
        dummy.scale.set(xzScale, h * (0.92 + 0.04 * (n % 3)), xzScale);
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        if (cm && crownGeom) cm.setMatrixAt(n, dummy.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    if (cm && crownGeom) cm.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <Stubble visible={isBare} frost={clearFrost} />
      {!isBare && (
        <mesh
          position={[0, SOIL_TOP + 0.55, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            const local = e.object.worldToLocal(e.point.clone());
            canopyPhysics.applyImpulseAt(local.x, -local.y, 0.85);
          }}
        >
          <planeGeometry args={[PLOT, PLOT]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {look && cropGeom && (
        <instancedMesh
          key={`${look.shape}-${perCell}`}
          ref={mesh}
          args={[undefined, undefined, instanceCount]}
          castShadow
          visible={!isBare}
        >
          <primitive object={cropGeom} attach="geometry" dispose={null} />
          <primitive object={materials.foliage} attach="material" dispose={null} />
        </instancedMesh>
      )}
      {look?.crown && crownGeom && cColor && (
        <instancedMesh
          key={`${look.crown}-${perCell}`}
          ref={crownMesh}
          args={[undefined, undefined, instanceCount]}
          castShadow
          visible={!isBare}
        >
          <primitive object={crownGeom} attach="geometry" dispose={null} />
          <primitive object={materials.crown} attach="material" dispose={null} />
        </instancedMesh>
      )}
    </>
  );
}

const ROOT_VARIANTS = [0, 1, 2] as const;
const NODULE_OFFSETS: [depthFrac: number, xOffset: number][] = [
  [0.14, 0.028],
  [0.24, -0.034],
  [0.36, 0.026],
];

function RootSystem({ frame, soilScale }: { frame: PlotFrame; soilScale: number }) {
  const profile = rootProfile(frame);
  const kind = profile.architecture === "taproot" ? "taproot" : "fibrous";
  const rootGeoms = useMemo(() => ROOT_VARIANTS.map((v) => getRootVariantGeometry(kind, v)), [kind]);
  const rootMat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: "#e6d6ae", roughness: 0.85 });
    applyRootShader(m);
    return m;
  }, []);
  useEffect(() => () => rootMat.dispose(), [rootMat]);

  const variantRefs = useRef<(InstancedMesh | null)[]>([null, null, null]);
  const noduleMesh = useRef<InstancedMesh>(null);
  const depthSpring = useRef<SpringScalarState>({ value: 0, velocity: 0 });
  const dummy = useMemo(() => new Object3D(), []);
  const noduleDummy = useMemo(() => new Object3D(), []);

  const targetWorldDepth = profile.activeDepthM * METER_TO_WORLD;
  const showNodules = profile.nitrogenFixing && profile.activeDepthM > 0.15;
  const perVariantCount = ROOT_POSITIONS.length / 3;
  const noduleCount = ROOT_POSITIONS.length * NODULE_OFFSETS.length;

  useFrame((_, delta) => {
    const d = Math.max(0, stepSpringScalar(depthSpring.current, targetWorldDepth, delta, 90, 14));
    const hidden = d < 0.01;
    variantRefs.current.forEach((rm) => {
      if (rm) rm.visible = !hidden;
    });
    if (hidden) {
      if (noduleMesh.current) noduleMesh.current.visible = false;
      return;
    }

    const variantCounters = [0, 0, 0];
    ROOT_POSITIONS.forEach((x, i) => {
      const vIdx = i % 3;
      const hash = ((Math.sin(i * 19.7 + 1.3) * 43758.5453) % 1 + 1) % 1;
      const variation = 0.84 + hash * 0.22;
      const rootD = Math.min(SOIL_DEPTH - 0.04, d * variation);
      dummy.position.set(x, SOIL_TOP - 0.01, PLOT / 2 + 0.165);
      dummy.rotation.set(0, (hash - 0.5) * 0.55, ((i % 2 === 0 ? 1 : -1) * 0.04) * hash);
      dummy.scale.set(0.92 + hash * 0.24, rootD, 0.92);
      dummy.updateMatrix();
      variantRefs.current[vIdx]?.setMatrixAt(variantCounters[vIdx]++, dummy.matrix);

      if (showNodules && noduleMesh.current) {
        NODULE_OFFSETS.forEach(([depthFrac, xOff], k) => {
          const idx = i * NODULE_OFFSETS.length + k;
          const sign = i % 2 === 0 ? 1 : -1;
          const nx = x + xOff * sign * (0.7 + hash * 0.5);
          const ny = SOIL_TOP - rootD * depthFrac;
          noduleDummy.position.set(nx, ny, PLOT / 2 + 0.172);
          noduleDummy.scale.set(1, 1 / soilScale, 1);
          noduleDummy.updateMatrix();
          noduleMesh.current!.setMatrixAt(idx, noduleDummy.matrix);
        });
      }
    });

    variantRefs.current.forEach((rm) => {
      if (rm) rm.instanceMatrix.needsUpdate = true;
    });
    if (noduleMesh.current) {
      noduleMesh.current.visible = showNodules;
      if (showNodules) noduleMesh.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {ROOT_VARIANTS.map((vIdx) => (
        <instancedMesh
          key={`${kind}-${vIdx}`}
          ref={(el) => {
            variantRefs.current[vIdx] = el;
          }}
          args={[undefined, undefined, perVariantCount]}
        >
          <primitive object={rootGeoms[vIdx]} attach="geometry" dispose={null} />
          <primitive object={rootMat} attach="material" dispose={null} />
        </instancedMesh>
      ))}
      <instancedMesh ref={noduleMesh} args={[undefined, undefined, noduleCount]} visible={showNodules}>
        <sphereGeometry args={[0.02, 6, 5]} />
        <meshStandardMaterial color="#dc8d6c" emissive="#5c2c18" emissiveIntensity={0.28} roughness={0.62} />
      </instancedMesh>
    </>
  );
}

interface RillSpec {
  x0: number;
  zStart: number;
  phase: number;
  maxWidth: number;
  maxDepth: number;
  tributarySide: -1 | 1;
  tributaryZ: number;
}

const SOIL_WALL_HALF = (PLOT + 0.3) / 2;
const TOPSOIL_BOTTOM = -0.07;

const EROSION_RILLS: RillSpec[] = [
  { x0: -1.52, zStart: -0.9, phase: 0.4, maxWidth: 0.13, maxDepth: 0.056, tributarySide: -1, tributaryZ: 0.45 },
  { x0: 0.06, zStart: -1.25, phase: 2.1, maxWidth: 0.145, maxDepth: 0.064, tributarySide: 1, tributaryZ: 0.2 },
  { x0: 1.42, zStart: -0.65, phase: 3.9, maxWidth: 0.12, maxDepth: 0.052, tributarySide: -1, tributaryZ: 0.75 },
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2D(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function soilValueNoise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

function rillCenterX(rill: RillSpec, z: number): number {
  return rill.x0 + 0.14 * Math.sin(z * 1.35 + rill.phase) + 0.05 * Math.cos(z * 3.4 + rill.phase * 1.7);
}

interface TopsoilSample {
  y: number;
  r: number;
  g: number;
  b: number;
}

function sampleTopsoilSurface(x: number, z: number, eroded: boolean): TopsoilSample {
  const step = PLOT / GRID;
  const halfInner = PLOT / 2;
  const xFade = 1 - smoothstep(halfInner - 0.05, SOIL_WALL_HALF, Math.abs(x));
  const zBackFade = 1 - smoothstep(-halfInner + 0.05, -SOIL_WALL_HALF, z);
  const zFrontFade = 1 - smoothstep(halfInner - 0.05, SOIL_WALL_HALF, z);
  const fieldMask = xFade * zBackFade * zFrontFade;

  // Natural wander + clod micro-relief so tilled rows never look laser-extruded.
  const rowWobble =
    0.017 * Math.sin(x * 1.9 + 0.4) + 0.009 * Math.cos(x * 4.3 - 0.7) + 0.005 * Math.sin(x * 8.1 + z * 2.7);
  const phase = ((z + halfInner + rowWobble) / step) * Math.PI * 2;
  const ridgeWave = -Math.cos(phase);
  // Broad rounded planting beds (+1 crest) curving down into deeper shaded furrow bottoms (-1 trough).
  const furrowProfile = 0.016 * ridgeWave - 0.005 * Math.cos(phase * 2);

  const macroClod = (soilValueNoise2(x * 3.4 + 4.2, z * 3.4 + 1.8) - 0.5) * 0.011;
  const fineClod = (soilValueNoise2(x * 10.5 + 9.1, z * 10.5 + 3.3) - 0.5) * 0.006;
  const clods = (macroClod + fineClod) * (0.35 + 0.65 * fieldMask);

  let channelCut = 0;
  let bankLift = 0;

  if (eroded) {
    for (const rill of EROSION_RILLS) {
      const down = smoothstep(rill.zStart, SOIL_WALL_HALF, z);
      if (down <= 0) continue;

      const edgeNoise = 0.82 + 0.36 * soilValueNoise2(x * 7.2 + rill.phase, z * 7.2);
      const mainX = rillCenterX(rill, z);
      const mainW = rill.maxWidth * (0.28 + 0.72 * down) * edgeNoise;
      const mainD = rill.maxDepth * Math.pow(down, 0.85);
      const distMain = Math.abs(x - mainX);

      if (distMain < mainW) {
        const t = distMain / mainW;
        channelCut = Math.max(channelCut, mainD * Math.pow(1 - t * t, 1.35));
      } else if (distMain < mainW * 1.85) {
        const s = (distMain - mainW) / (mainW * 0.85);
        bankLift = Math.max(bankLift, 0.007 * down * Math.sin(s * Math.PI));
      }

      if (z >= rill.tributaryZ && z < rill.tributaryZ + 1.45) {
        const join = clamp01((z - rill.tributaryZ) / 1.35);
        const startFade = smoothstep(rill.tributaryZ, rill.tributaryZ + 0.35, z);
        const tribX = mainX + rill.tributarySide * 0.44 * (1 - join);
        const tribW = rill.maxWidth * 0.52 * edgeNoise * (0.4 + 0.6 * join);
        const tribD = rill.maxDepth * 0.52 * startFade * (1 - 0.25 * join);
        const distTrib = Math.abs(x - tribX);
        if (distTrib < tribW) {
          const tt = distTrib / tribW;
          channelCut = Math.max(channelCut, tribD * Math.pow(1 - tt * tt, 1.3));
        }
      }
    }
  }

  // Eroded runoff channels wash across horizontal tillage ridges rather than sitting on top of them.
  const furrowWash = 1 - clamp01(channelCut / 0.025);
  const y = SOIL_TOP + furrowProfile * fieldMask * furrowWash + clods - channelCut + bankLift * fieldMask;

  const troughAO = clamp01(-ridgeWave) * fieldMask * furrowWash;
  const rillAO = clamp01(channelCut / 0.045);
  const siltBank = clamp01(bankLift / 0.006);
  const clodTint = 0.96 + (macroClod + fineClod) * 3.5;

  let shade = clodTint * (1 - 0.24 * troughAO);
  shade *= 1 - 0.36 * rillAO;
  shade += 0.05 * siltBank * (1 - rillAO);
  shade = Math.max(0.48, Math.min(1.08, shade));

  return {
    y,
    r: shade,
    g: shade * (1 - 0.03 * troughAO - 0.06 * rillAO),
    b: shade * (1 - 0.06 * troughAO - 0.1 * rillAO),
  };
}

const TOPSOIL_GEOMETRIES = new Map<boolean, BufferGeometry>();
const STREAK_GEOMETRIES = new Map<number, BufferGeometry>();
const FAN_GEOMETRIES = new Map<number, BufferGeometry>();

/** Builds the cached Horizon A topsoil block with sculpted tillage ridges, furrow troughs, and optional meandering erosion rills. */
export function buildTopsoilGeometry(eroded: boolean): BufferGeometry {
  const cached = TOPSOIL_GEOMETRIES.get(eroded);
  if (cached) return cached;

  const seg = 104;
  const span = SOIL_WALL_HALF * 2;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushVertex = (x: number, y: number, z: number, u: number, v: number, r: number, g: number, b: number) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    colors.push(r, g, b);
    return positions.length / 3 - 1;
  };

  // 1. Sculpted top grid (+Y facing, separate vertices so 90° cutaway edges stay sharp).
  const grid: TopsoilSample[][] = [];
  const topOffset = 0;
  for (let iz = 0; iz <= seg; iz++) {
    const v = iz / seg;
    const z = -SOIL_WALL_HALF + v * span;
    const row: TopsoilSample[] = [];
    for (let ix = 0; ix <= seg; ix++) {
      const u = ix / seg;
      const x = -SOIL_WALL_HALF + u * span;
      const s = sampleTopsoilSurface(x, z, eroded);
      row.push(s);
      pushVertex(x, s.y, z, u, 1 - v, s.r, s.g, s.b);
    }
    grid.push(row);
  }

  for (let iz = 0; iz < seg; iz++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = topOffset + iz * (seg + 1) + ix;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // 2. Cutaway side skirts following the exact carved rim profile down to Horizon B.
  const addWallStrip = (points: Array<{ x: number; z: number; sample: TopsoilSample; u: number }>, flip: boolean) => {
    const base = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      pushVertex(p.x, p.sample.y, p.z, p.u, 1, p.sample.r, p.sample.g, p.sample.b);
      pushVertex(p.x, TOPSOIL_BOTTOM, p.z, p.u, 0, 0.88, 0.84, 0.8);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const t0 = base + i * 2;
      const b0 = t0 + 1;
      const t1 = t0 + 2;
      const b1 = t0 + 3;
      if (flip) indices.push(t1, b1, t0, t0, b1, b0);
      else indices.push(t0, b0, t1, t1, b0, b1);
    }
  };

  addWallStrip(
    Array.from({ length: seg + 1 }, (_, ix) => ({
      x: -SOIL_WALL_HALF + (ix / seg) * span,
      z: SOIL_WALL_HALF,
      sample: grid[seg][ix],
      u: ix / seg,
    })),
    false,
  );
  addWallStrip(
    Array.from({ length: seg + 1 }, (_, ix) => ({
      x: -SOIL_WALL_HALF + (ix / seg) * span,
      z: -SOIL_WALL_HALF,
      sample: grid[0][ix],
      u: 1 - ix / seg,
    })),
    true,
  );
  addWallStrip(
    Array.from({ length: seg + 1 }, (_, iz) => ({
      x: SOIL_WALL_HALF,
      z: -SOIL_WALL_HALF + (iz / seg) * span,
      sample: grid[iz][seg],
      u: 1 - iz / seg,
    })),
    true,
  );
  addWallStrip(
    Array.from({ length: seg + 1 }, (_, iz) => ({
      x: -SOIL_WALL_HALF,
      z: -SOIL_WALL_HALF + (iz / seg) * span,
      sample: grid[iz][0],
      u: iz / seg,
    })),
    false,
  );

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geom.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  TOPSOIL_GEOMETRIES.set(eroded, geom);
  return geom;
}

/** Builds an organic, tapering runoff washout streak descending the soil cutaway from a rill's front exit notch. */
export function buildCutawayStreakGeometry(rillIndex: number): BufferGeometry {
  const cached = STREAK_GEOMETRIES.get(rillIndex);
  if (cached) return cached;

  const rill = EROSION_RILLS[rillIndex % EROSION_RILLS.length];
  const exitX = rillCenterX(rill, SOIL_WALL_HALF);
  const exitY = sampleTopsoilSurface(exitX, SOIL_WALL_HALF, true).y;
  const rows = 22;
  const cols = 8;
  const topY = exitY + 0.005;
  const bottomY = SOIL_BOTTOM + 0.005;
  const height = topY - bottomY;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const core = new Color("#4d3018");
  const rim = new Color("#785231");

  for (let ir = 0; ir <= rows; ir++) {
    const v = ir / rows;
    const y = topY - v * height;
    const weave = 0.032 * Math.sin(v * 7.2 + rill.phase) + 0.015 * Math.cos(v * 13.5 - rill.phase);
    const halfW = rill.maxWidth * (0.68 - 0.25 * Math.sin(v * Math.PI) + 0.28 * v * v);

    for (let ic = 0; ic <= cols; ic++) {
      const u = ic / cols;
      const across = u * 2 - 1;
      const x = exitX + weave + across * halfW;
      const bulge = Math.sin(u * Math.PI);
      const z = SOIL_WALL_HALF + 0.003 + 0.01 * bulge + 0.012 * v * v;
      positions.push(x, y, z);

      const c = rim.clone().lerp(core, 0.25 + 0.75 * bulge);
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let ir = 0; ir < rows; ir++) {
    for (let ic = 0; ic < cols; ic++) {
      const t0 = ir * (cols + 1) + ic;
      const t1 = t0 + 1;
      const b0 = t0 + cols + 1;
      const b1 = b0 + 1;
      indices.push(t0, b0, t1, t1, b0, b1);
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  STREAK_GEOMETRIES.set(rillIndex, geom);
  return geom;
}

/** Builds a lobate alluvial silt fan radiating from a cutaway washout onto the trench floor. */
export function buildSedimentFanGeometry(rillIndex: number): BufferGeometry {
  const cached = FAN_GEOMETRIES.get(rillIndex);
  if (cached) return cached;

  const rill = EROSION_RILLS[rillIndex % EROSION_RILLS.length];
  const exitX = rillCenterX(rill, SOIL_WALL_HALF);
  const rings = 12;
  const segs = 22;
  const startZ = SOIL_WALL_HALF + 0.015;
  const minR = 0.02;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const apexColor = new Color("#56371e");
  const siltColor = new Color("#84603e");
  const trenchBlend = new Color("#4c4034");

  for (let ir = 0; ir <= rings; ir++) {
    const rt = ir / rings;
    for (let ia = 0; ia <= segs; ia++) {
      const at = ia / segs;
      const theta = (at * 2 - 1) * Math.PI * 0.46;
      const lobe = 1 + 0.16 * Math.cos(theta * 2.2 + rill.phase) + 0.09 * Math.sin(theta * 5.8 - rill.phase * 1.4);
      const maxR = 0.86 * lobe * (0.72 + 0.28 * Math.cos(theta));
      const r = minR + rt * (maxR - minR);

      const x = exitX + r * Math.sin(theta);
      const z = startZ + r * Math.cos(theta);
      const edgeDrop = Math.pow(1 - rt, 1.35);
      const sideTaper = Math.sin(at * Math.PI);
      const ripple = 0.004 * Math.sin(theta * 14 + r * 6 + rill.phase) * Math.sin(rt * Math.PI);
      const y = SOIL_BOTTOM - 0.004 + (0.03 * edgeDrop * (0.4 + 0.6 * sideTaper) + ripple);
      positions.push(x, y, z);

      const c = apexColor.clone().lerp(siltColor, clamp01(rt * 0.85)).lerp(trenchBlend, Math.pow(rt, 1.8) * 0.85);
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let ir = 0; ir < rings; ir++) {
    for (let ia = 0; ia < segs; ia++) {
      const a = ir * (segs + 1) + ia;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  FAN_GEOMETRIES.set(rillIndex, geom);
  return geom;
}

export function erosionRisk(frame: PlotFrame, weather: WeatherFrame): boolean {
  return (frame.state === "bare" || frame.state === "planted") && weather.heavyRainDays >= HEAVY_RAIN_MONTH;
}

function isSnowWeather(weather: WeatherFrame): boolean {
  return weather.frost && weather.et0Mm < 30;
}

function createSoilMaterialSet(soilTexture: CanvasTexture | null) {
  const uWetness = { value: 0 };
  const uSurfaceWetness = { value: 0 };
  const uSnow = { value: 0 };
  const uFrost = { value: 0 };
  const makeMat = (
    horizon: number,
    color: string,
    map: CanvasTexture | null,
    roughness: number,
    wetness = uWetness,
    vertexColors = false,
    snow = { value: 0 },
    frost = { value: 0 },
  ) => {
    const m = new MeshStandardMaterial({ color, map, roughness, vertexColors });
    applySoilShader(m, { uWetness: wetness, uHorizon: { value: horizon }, uSnow: snow, uFrost: frost });
    return m;
  };
  return {
    uWetness,
    uSurfaceWetness,
    uSnow,
    uFrost,
    horizonA: makeMat(0, "#6e4d31", soilTexture, 0.96, uSurfaceWetness, true, uSnow, uFrost),
    horizonB: makeMat(1, "#8d613e", soilTexture, 0.95),
    horizonC: makeMat(2, "#675a4e", null, 1),
  };
}

function Plot({
  x,
  frame,
  weather,
  soilTexture,
  highlighted = false,
  soilScale = 1,
  dense,
}: {
  x: number;
  frame: PlotFrame;
  weather: WeatherFrame;
  soilTexture: CanvasTexture | null;
  highlighted?: boolean;
  /** Draw the soil profile this many times deeper than true scale (the roots view). */
  soilScale?: number;
  dense: boolean;
}) {
  const erosion = erosionRisk(frame, weather);
  const storm = weather.heavyRainDays >= HEAVY_RAIN_MONTH;
  // Wetter where the month's rain exceeds what this plot's crop uses, drier where the crop draws more.
  const wet = plotWetness(frame, weather);
  const snow = isSnowWeather(weather);
  const topsoil = useMemo(() => new Color("#6e4d31").lerp(new Color("#362111"), wet * 0.75), [wet]);
  const subsoil = useMemo(() => new Color("#8d613e").lerp(new Color("#593a23"), wet * 0.4), [wet]);

  const topsoilGeom = useMemo(() => buildTopsoilGeometry(erosion), [erosion]);
  const streakGeoms = useMemo(() => EROSION_RILLS.map((_, i) => buildCutawayStreakGeometry(i)), []);
  const fanGeoms = useMemo(() => EROSION_RILLS.map((_, i) => buildSedimentFanGeometry(i)), []);
  const soilMats = useMemo(() => createSoilMaterialSet(soilTexture), [soilTexture]);

  useEffect(() => {
    soilMats.uWetness.value = wet;
    soilMats.uSurfaceWetness.value = snow ? 0.3 : wet;
    soilMats.uSnow.value = snow ? 1 : 0;
    soilMats.uFrost.value = !snow && weather.frost && !storm ? 0.62 : 0;
    soilMats.horizonA.color.copy(topsoil);
    soilMats.horizonB.color.copy(subsoil);
  }, [soilMats, wet, snow, storm, weather.frost, topsoil, subsoil]);

  useEffect(
    () => () => {
      soilMats.horizonA.dispose();
      soilMats.horizonB.dispose();
      soilMats.horizonC.dispose();
    },
    [soilMats],
  );

  return (
    <group position={[x, 0, 0]}>
      <group position={[0, SOIL_TOP, 0]} scale={[1, soilScale, 1]}>
      <group position={[0, -SOIL_TOP, 0]}>
      {/* Base plinth frame */}
      <mesh receiveShadow position={[0, SOIL_BOTTOM - 0.03, 0]}>
        <boxGeometry args={[PLOT + 0.44, 0.06, PLOT + 0.44]} />
        <meshStandardMaterial color="#382e26" roughness={0.95} />
      </mesh>
      {/* Horizon A: sculpted organic topsoil with tilled furrows & optional erosion rills */}
      <mesh receiveShadow castShadow>
        <primitive object={topsoilGeom} attach="geometry" dispose={null} />
        <primitive object={soilMats.horizonA} attach="material" dispose={null} />
      </mesh>
      {/* Horizon B: mineral subsoil */}
      <mesh receiveShadow position={[0, -0.27, 0]}>
        <boxGeometry args={[PLOT + 0.3, 0.4, PLOT + 0.3]} />
        <primitive object={soilMats.horizonB} attach="material" dispose={null} />
      </mesh>
      {/* Horizon C: parent material */}
      <mesh receiveShadow position={[0, -0.61, 0]}>
        <boxGeometry args={[PLOT + 0.3, 0.28, PLOT + 0.3]} />
        <primitive object={soilMats.horizonC} attach="material" dispose={null} />
      </mesh>
      {/* Depth scale (0.5 m, 1.0 m, 1.5 m): flush ticks on left shoulder, translucent rule lines when zoomed deeper */}
      {DEPTH_MARKS_M.map((meters) => (
        <mesh
          key={meters}
          position={[
            soilScale > 1 ? 0 : -(PLOT + 0.3) / 2 + 0.015,
            SOIL_TOP - meters * METER_TO_WORLD,
            PLOT / 2 + 0.16,
          ]}
        >
          <boxGeometry args={[soilScale > 1 ? PLOT + 0.3 : 0.11, 0.015 / soilScale, 0.016]} />
          <meshBasicMaterial color="#e8dfd0" transparent opacity={soilScale > 1 ? 0.55 : 0.72} />
        </mesh>
      ))}
      <RootSystem frame={frame} soilScale={soilScale} />
      {/* Cutaway runoff streaks and curved alluvial sediment fans flowing out of the carved rill notches */}
      {EROSION_RILLS.map((rill, idx) => (
        <group key={rill.x0} visible={erosion}>
          <mesh receiveShadow>
            <primitive object={streakGeoms[idx]} attach="geometry" dispose={null} />
            <meshStandardMaterial vertexColors roughness={0.28} />
          </mesh>
          <mesh receiveShadow>
            <primitive object={fanGeoms[idx]} attach="geometry" dispose={null} />
            <meshStandardMaterial vertexColors roughness={0.44} />
          </mesh>
        </group>
      ))}
      {/* Highlighted plot plinth collar around the base frame so it never slices through crop leaves */}
      {highlighted && (
        <group position={[0, SOIL_BOTTOM + 0.008, 0]}>
          {[
            { pos: [0, 0, -(PLOT + 0.48) / 2] as const, args: [PLOT + 0.5, 0.022, 0.045] as const },
            { pos: [0, 0, (PLOT + 0.48) / 2] as const, args: [PLOT + 0.5, 0.022, 0.045] as const },
            { pos: [-(PLOT + 0.48) / 2, 0, 0] as const, args: [0.045, 0.022, PLOT + 0.48] as const },
            { pos: [(PLOT + 0.48) / 2, 0, 0] as const, args: [0.045, 0.022, PLOT + 0.48] as const },
          ].map((edge, idx) => (
            <mesh key={idx} position={edge.pos}>
              <boxGeometry args={edge.args} />
              <meshStandardMaterial color="#3c8a5e" emissive="#1e5638" emissiveIntensity={0.48} roughness={0.42} />
            </mesh>
          ))}
          {([-1, 1] as const).flatMap((sx) =>
            ([-1, 1] as const).map((sz) => (
              <group key={`${sx}-${sz}`} position={[sx * (PLOT / 2 + 0.24), 0.012, sz * (PLOT / 2 + 0.24)]}>
                <mesh position={[-sx * 0.24, 0, 0]}>
                  <boxGeometry args={[0.52, 0.028, 0.068]} />
                  <meshStandardMaterial color="#76d49c" emissive="#2d7a51" emissiveIntensity={0.68} roughness={0.35} />
                </mesh>
                <mesh position={[0, 0, -sz * 0.24]}>
                  <boxGeometry args={[0.068, 0.028, 0.52]} />
                  <meshStandardMaterial color="#76d49c" emissive="#2d7a51" emissiveIntensity={0.68} roughness={0.35} />
                </mesh>
              </group>
            )),
          )}
        </group>
      )}
      </group>
      </group>
      {soilScale > 1 &&
        DEPTH_MARKS_M.map((meters) => {
          const map = getLabelTexture(`${meters.toFixed(1)} m`);
          return (
            map && (
              <sprite
                key={meters}
                position={[-(PLOT + 0.3) / 2 + 0.52, SOIL_TOP - meters * METER_TO_WORLD * soilScale + 0.2, PLOT / 2 + 0.2]}
                scale={[0.9, 0.36, 1]}
              >
                <spriteMaterial map={map} depthTest={false} />
              </sprite>
            )
          );
        })}
      <Plants frame={frame} frost={weather.frost} storm={storm} dense={dense} />
    </group>
  );
}

const DROPS = 260;

/** Gravity, wind-drift, ground `Plane` collision, and splash-rebound physics for precipitation. */
export class PrecipitationPhysics {
  readonly world: World;
  readonly bodies: Body[] = [];
  private readonly bounced: boolean[];

  constructor(count = DROPS) {
    this.world = new World();
    this.world.gravity.set(0, -9.82, 0);
    this.world.broadphase = new SAPBroadphase(this.world);

    const groundMat = new CannonMaterial("soil");
    const dropMat = new CannonMaterial("drop");
    this.world.addContactMaterial(
      new ContactMaterial(groundMat, dropMat, {
        friction: 0.15,
        restitution: 0.38,
      }),
    );

    const ground = new Body({
      mass: 0,
      material: groundMat,
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
    });
    ground.addShape(new CannonPlane());
    ground.quaternion.setFromAxisAngle(new Vec3(1, 0, 0), -Math.PI / 2);
    ground.position.set(0, SOIL_TOP, 0);
    this.world.addBody(ground);

    const dropShape = new CannonSphere(0.03);
    this.bounced = Array<boolean>(count).fill(false);

    for (let i = 0; i < count; i++) {
      const body = new Body({
        mass: 0.05,
        shape: dropShape,
        material: dropMat,
        linearDamping: 0.04,
        collisionFilterGroup: 2,
        collisionFilterMask: 1,
      });
      body.position.set(((i * 7.31) % 18) - 9, SOIL_TOP + 0.5 + ((i * 3.17) % 9.5), ((i * 5.13) % 10) - 5);
      body.velocity.set(0.3, -4.0 - (i % 5) * 0.6, 0);
      this.world.addBody(body);
      this.bodies.push(body);
    }
  }

  private respawnDrop(i: number, snow: boolean): void {
    const body = this.bodies[i];
    body.position.set(((i * 7.31) % 18) - 9, 8.6 + (i % 7) * 0.35, ((i * 5.13) % 10) - 5);
    body.velocity.set(snow ? 0.2 : 0.4, snow ? -1.2 : -6.2 - (i % 4) * 0.5, 0);
    this.bounced[i] = false;
  }

  /** Steps falling drops/snowflakes under gravity, wind drift, and soil surface collisions. */
  step(dt: number, snow: boolean, activeCount = this.bodies.length): void {
    const clampedDt = Math.min(Math.max(dt, 0), 0.05);
    const n = Math.min(activeCount, this.bodies.length);
    if (n === 0 || clampedDt === 0) return;

    this.world.gravity.set(0, snow ? -1.8 : -9.82, 0);

    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      if (snow) {
        b.applyForce(new Vec3(Math.sin(b.position.y * 2.0 + i) * 0.06, 0.04, 0));
      } else {
        b.applyForce(new Vec3(0.03, 0, 0));
      }
    }
    for (let i = n; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      b.position.set(0, 9.5, 0);
      b.velocity.set(0, 0, 0);
      this.bounced[i] = false;
    }

    this.world.step(1 / 60, clampedDt, 2);

    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      if (!this.bounced[i]) {
        if (b.position.y <= SOIL_TOP + 0.22 && b.velocity.y > 0.05) {
          this.bounced[i] = true;
        } else if (b.position.y <= SOIL_TOP + 0.045 && Math.abs(b.velocity.y) <= 0.05) {
          this.respawnDrop(i, snow);
        }
      } else if (b.velocity.y < -0.1 || b.position.y <= SOIL_TOP + 0.04) {
        this.respawnDrop(i, snow);
      }
    }
  }

  /** Returns active post-impact ground splash coordinates for rendering bounce rings. */
  getSplashPositions(): { x: number; y: number; z: number }[] {
    const splashes: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.bounced[i]) {
        const b = this.bodies[i];
        splashes.push({ x: b.position.x, y: SOIL_TOP + 0.02, z: b.position.z });
      }
    }
    return splashes;
  }
}

function Precipitation({ weather }: { weather: WeatherFrame }) {
  const mesh = useRef<InstancedMesh>(null);
  const splashMesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const splashDummy = useMemo(() => new Object3D(), []);
  const physics = useMemo(() => new PrecipitationPhysics(DROPS), []);
  const snow = isSnowWeather(weather);
  const count = Math.round(Math.min(1, weather.rainMm / 150) * DROPS);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    physics.step(delta, snow, count);

    for (let i = 0; i < count; i++) {
      const p = physics.bodies[i].position;
      dummy.position.set(p.x * 1.38, p.y, p.z);
      dummy.rotation.set(0, 0, snow ? i * 0.4 : -0.11);
      dummy.scale.set(1, snow ? 0.16 : 1, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;

    const sm = splashMesh.current;
    if (sm) {
      if (snow || count === 0) {
        sm.count = 0;
        sm.instanceMatrix.needsUpdate = true;
      } else {
        const splashes = physics.getSplashPositions();
        for (let i = 0; i < splashes.length; i++) {
          const s = splashes[i];
          splashDummy.position.set(s.x * 1.38, SOIL_TOP + 0.012, s.z);
          splashDummy.rotation.set(-Math.PI / 2, 0, 0);
          splashDummy.scale.set(1, 1, 1);
          splashDummy.updateMatrix();
          sm.setMatrixAt(i, splashDummy.matrix);
        }
        sm.count = splashes.length;
        sm.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, DROPS]}>
        {snow ? (
          <boxGeometry args={[0.075, 0.24, 0.075]} />
        ) : (
          <cylinderGeometry args={[0.004, 0.011, 0.44, 4]} />
        )}
        <meshBasicMaterial color={snow ? "#ffffff" : "#cbe5fc"} transparent opacity={snow ? 0.78 : 0.48} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={splashMesh} args={[undefined, undefined, DROPS]}>
        <ringGeometry args={[0.045, 0.082, 16]} />
        <meshBasicMaterial color="#d4ebff" transparent opacity={0.44} side={DoubleSide} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

function SkyDome({
  zenith,
  horizon,
  sunPos,
  storm,
}: {
  zenith: string;
  horizon: string;
  sunPos: [number, number, number];
  storm: boolean;
}) {
  const mat = useMemo(() => buildSkyDomeMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    (mat.uniforms.uZenith.value as Color).set(zenith);
    (mat.uniforms.uHorizon.value as Color).set(horizon);
    (mat.uniforms.uSunDir.value as Vector3).set(...sunPos).normalize();
    mat.uniforms.uStorm.value = storm ? 1 : 0;
  }, [mat, zenith, horizon, sunPos, storm]);
  useFrame((_, delta) => {
    mat.uniforms.uTime.value = (mat.uniforms.uTime.value as number) + Math.min(delta, 0.1);
  });
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[TERRAIN_EXTENT * 1.45, 32, 20]} />
      <primitive object={mat} attach="material" dispose={null} />
    </mesh>
  );
}

function Clouds({ weather, spanFactor = 1 }: { weather: WeatherFrame; spanFactor?: number }) {
  const group = useRef<Group>(null);
  const dark = weather.heavyRainDays >= HEAVY_RAIN_MONTH;
  const cloudUniforms = useMemo<CloudUniforms>(() => ({ uTime: { value: 0 }, uDark: { value: 0 } }), []);
  const cloudMat = useMemo(() => {
    const mat = new MeshStandardMaterial({ color: "#f8fbff", roughness: 1.0, metalness: 0.0 });
    applyCloudShader(mat, cloudUniforms);
    return mat;
  }, [cloudUniforms]);
  const geometries = useMemo(() => [0, 1, 2].map((v) => buildCumulusCloudGeometry(v)), []);

  useEffect(() => {
    cloudUniforms.uDark.value = dark ? 1 : 0;
    cloudMat.color.set(dark ? "#d3dde8" : "#f8fbff");
  }, [cloudUniforms, cloudMat, dark]);

  useEffect(() => () => cloudMat.dispose(), [cloudMat]);

  useFrame(({ clock }) => {
    cloudUniforms.uTime.value = clock.elapsedTime;
    if (group.current) {
      group.current.position.x = Math.sin(clock.elapsedTime * 0.06) * 2.1;
    }
  });

  if (weather.heavyRainDays < HEAVY_RAIN_MONTH && weather.rainMm < 25) return null;
  const scaleSpread = Math.max(0.95, spanFactor);
  const placements: [x: number, y: number, z: number, v: number, sx: number, sy: number, sz: number][] = [
    [-33 * scaleSpread, 4.4, -48, 0, 2.7, 1.05, 1.6],
    [-16 * scaleSpread, 5.1, -64, 2, 3.1, 1.15, 1.8],
    [-4.5 * scaleSpread, 5.55, -78, 1, 3.3, 1.18, 1.9],
    [13.5 * scaleSpread, 5.25, -72, 0, 3.0, 1.12, 1.75],
    [28 * scaleSpread, 4.6, -52, 1, 2.8, 1.08, 1.65],
    [44 * scaleSpread, 5.0, -62, 2, 3.2, 1.15, 1.8],
  ];
  return (
    <group ref={group}>
      {placements.map(([x, y, z, v, sx, sy, sz], i) => (
        <mesh key={i} geometry={geometries[v]} material={cloudMat} position={[x, y, z]} scale={[sx, sy, sz]} />
      ))}
    </group>
  );
}

const plotSpacing = (n: number) => plotSpacingForCount(n);
const plotX = (i: number, n: number) => (i - (n - 1) / 2) * plotSpacing(n);
const trenchHalfWidth = (n: number) => (n <= 1 ? 3.4 : Math.max(7.0, Math.abs(plotX(0, n)) + PLOT / 2 + 0.8));

/** Enforces minimum horizontal pixel separation while keeping all labels within canvas bounds when zoomed in or out. */
export function resolveLabelScreenPositions(xs: number[], minGapPx = 185, canvasWidth = 800): number[] {
  const n = xs.length;
  if (n === 0) return xs;
  const margin = Math.min(88, Math.max(48, canvasWidth * 0.12));
  const minAllowed = Math.min(margin, canvasWidth / 2);
  const maxAllowed = Math.max(minAllowed, canvasWidth - margin);
  if (n === 1) {
    return [Math.max(minAllowed, Math.min(maxAllowed, xs[0]))];
  }
  const usableSpan = Math.max(0, maxAllowed - minAllowed);
  const effectiveGap = Math.min(minGapPx, usableSpan / (n - 1));
  const order = xs.map((x, idx) => ({ x, idx })).sort((a, b) => a.x - b.x);
  const pos = order.map((o) => Math.max(minAllowed, Math.min(maxAllowed, o.x)));

  for (let pass = 0; pass < n * 6; pass++) {
    for (let k = 0; k < n - 1; k++) {
      const diff = pos[k + 1] - pos[k];
      if (diff < effectiveGap) {
        const push = (effectiveGap - diff) / 2;
        pos[k] -= push;
        pos[k + 1] += push;
      }
    }
  }
  pos[0] = Math.max(minAllowed, pos[0]);
  for (let k = 1; k < n; k++) {
    pos[k] = Math.max(pos[k], pos[k - 1] + effectiveGap);
  }
  pos[n - 1] = Math.min(maxAllowed, pos[n - 1]);
  for (let k = n - 2; k >= 0; k--) {
    pos[k] = Math.min(pos[k], pos[k + 1] - effectiveGap);
  }

  const out = new Array<number>(n);
  order.forEach((o, k) => {
    out[o.idx] = pos[k];
  });
  return out;
}

export const TERRAIN_EXTENT = 240;
export const TERRAIN_FOG_NEAR = 48;
export const TERRAIN_FOG_FAR = 168;

/** Clamps a downward-anchored upward-translated DOM label so stacked badges stay inside the stage. */
export function clampLabelBottomY(rawY: number, tagHeight: number, canvasHeight: number): number {
  const minY = Math.max(36, tagHeight + 10);
  const maxY = Math.max(minY, canvasHeight - 10);
  return Math.max(minY, Math.min(maxY, rawY));
}

/**
 * Moves page elements (labels drawn outside the canvas) to sit above each plot. Plain
 * DOM labels are used instead of drei's Html, which mounts a separate React root per
 * label and dropped labels under React 19.
 */
function LabelAnchors({
  count,
  anchors,
  view,
}: {
  count: number;
  anchors: RefObject<(HTMLElement | null)[]>;
  view: CameraView;
}) {
  const { camera, size } = useThree();
  const point = useMemo(() => new Vector3(), []);
  const targetVec = useMemo(() => new Vector3(), []);
  const aspect = size.width / Math.max(size.height, 1);
  const fitted = useMemo(() => computeFittedCamera(view, count, aspect), [view, count, aspect]);
  const zoom = useMemo(() => computeZoomBounds(view, count, aspect), [view, count, aspect]);
  useFrame(() => {
    const yAnchor = view === "roots" ? 2.3 : 1.85;
    const zAnchor = view === "roots" ? PLOT / 2 : -PLOT / 2;
    const rawXs: number[] = [];
    const rawYs: number[] = [];
    for (let i = 0; i < count; i++) {
      point.set(plotX(i, count), yAnchor, zAnchor).project(camera);
      rawXs.push(((point.x + 1) / 2) * size.width);
      rawYs.push(point.z > 1 ? size.height - 10 : ((1 - point.y) / 2) * size.height);
    }
    const minGap = Math.max(72, Math.min(count <= 2 ? 210 : count === 3 ? 165 : 135, (size.width - 28) / Math.max(count, 1)));
    const adjustedXs = resolveLabelScreenPositions(rawXs, minGap, size.width);
    targetVec.set(...fitted.target);
    const cameraDist = Math.max(camera.position.distanceTo(targetVec), 1);
    const zoomScale = Math.pow(zoom.fitDistance / cameraDist, 0.35);
    const tagScale =
      size.width < 520 ? Math.max(0.72, Math.min(0.9, 0.82 * zoomScale)) : Math.max(0.76, Math.min(1.06, zoomScale));
    for (let i = 0; i < count; i++) {
      const el = anchors.current?.[i];
      if (!el) continue;
      const tagHeight = (el.offsetHeight || 54) * tagScale;
      const clampedY = clampLabelBottomY(rawYs[i], tagHeight, size.height);
      el.style.transform = `translate(-50%, -100%) translate(${adjustedXs[i]}px, ${clampedY}px) scale(${tagScale.toFixed(3)})`;
    }
  });
  return null;
}

/** Updates camera position and OrbitControls target for the selected view preset & aspect ratio. */
function FitCamera({
  view,
  count,
  fitVersion,
  controlsRef,
}: {
  view: CameraView;
  count: number;
  fitVersion: number;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const { pos, target } = computeFittedCamera(view, count, aspect);
    camera.position.set(...pos);
    camera.lookAt(...target);
    if (controlsRef.current) {
      controlsRef.current.target.set(...target);
      controlsRef.current.update();
    }
  }, [camera, controlsRef, count, fitVersion, size.width, size.height, view]);
  return null;
}

/** Height of the surrounding ground: just under the plots' soil surface, so they read as strips of one field. */
const GROUND_Y = 0.1;
const PLOT_HALF = (PLOT + 0.3) / 2;

/** Evaluates multi-layer undulating rural hills: low valley slopes in midground and sweeping ridge contours along the far skyline. */
export function terrainHillY(x: number, z: number): number {
  if (z >= -26) return GROUND_Y;
  const tNear = clamp01((-26 - z) / 38);
  const smoothNear = tNear * tNear * (3 - 2 * tNear);
  const tFar = clamp01((-74 - z) / 48);
  const smoothFar = tFar * tFar * (3 - 2 * tFar);
  const farTaper = 1 - clamp01((-138 - z) / 38);
  const h1 = (Math.sin(x * 0.032 + 0.65) * 0.5 + 0.5) * 0.62;
  const h2 = (Math.sin(x * 0.075 - z * 0.044) * 0.5 + 0.5) * 0.38;
  const h3 = (Math.cos(x * 0.017 + z * 0.024) * 0.5 + 0.5) * 0.42;
  const nearRoll = smoothNear * (0.14 + h1 + h2 + h3);
  const farRidge = smoothFar * (0.55 + (Math.sin(x * 0.024 + 2.1) * 0.5 + 0.5) * 1.02 + (Math.cos(x * 0.052 - 0.8) * 0.5 + 0.5) * 0.62);
  return GROUND_Y + farTaper * (nearRoll + farRidge);
}

let cachedHorizonRidge: BufferGeometry | null = null;

/** Builds and caches rolling distant agricultural hills behind the flat field apron (z = -24 to -175). */
export function buildHorizonRidgeGeometry(): BufferGeometry {
  if (cachedHorizonRidge) return cachedHorizonRidge;
  const segX = 96;
  const segZ = 44;
  const xMin = -TERRAIN_EXTENT;
  const xMax = TERRAIN_EXTENT;
  const zMin = -175;
  const zMax = -24;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let iz = 0; iz <= segZ; iz++) {
    const z = zMin + (iz / segZ) * (zMax - zMin);
    for (let ix = 0; ix <= segX; ix++) {
      const x = xMin + (ix / segX) * (xMax - xMin);
      const seamBlend = iz === segZ ? -0.018 : -0.008;
      positions.push(x, terrainHillY(x, z) + seamBlend, z);
    }
  }
  const stride = segX + 1;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  cachedHorizonRidge = geom;
  return geom;
}

let cachedWindbreakConifer: BufferGeometry | null = null;
let cachedBroadleafCrown: BufferGeometry | null = null;
let cachedBareBranch: BufferGeometry | null = null;
let cachedShrub: BufferGeometry | null = null;

/** Builds a layered boreal spruce/pine shelterbelt tree with organic ruffled bough whorls and bark trunk. */
export function buildWindbreakConiferGeometry(): BufferGeometry {
  if (cachedWindbreakConifer) return cachedWindbreakConifer;
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.11, 0.22, 1.5, 7);
  trunk.translate(0, 0.75, 0);
  parts.push(paintVertexGradient(trunk, "#463528", "#614937", 0, 1.5));

  const whorls: [radius: number, height: number, yCenter: number, lean: number][] = [
    [1.42, 1.65, 1.75, 0.04],
    [1.16, 1.55, 2.65, -0.03],
    [0.86, 1.38, 3.48, 0.03],
    [0.54, 1.15, 4.22, -0.02],
  ];
  whorls.forEach(([r, h, yc, lean], wi) => {
    const cone = new ConeGeometry(r, h, 10, 2);
    const pos = cone.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const radial = Math.hypot(px, pz);
      if (radial > 0.05) {
        const angle = Math.atan2(pz, px);
        const ripple = 1 + 0.14 * Math.sin(angle * 5 + wi * 1.4) + 0.06 * Math.cos(py * 4.2);
        pos.setXYZ(i, px * ripple, py - 0.05 * Math.sin(angle * 5 + wi), pz * ripple);
      }
    }
    cone.rotateZ(lean);
    cone.translate(0, yc, 0);
    cone.computeVertexNormals();
    parts.push(paintVertexGradient(cone, "#274e34", "#47784d", yc - h * 0.5, yc + h * 0.5));
  });

  cachedWindbreakConifer = mergeBufferGeometries(parts);
  return cachedWindbreakConifer;
}

/** Builds a smooth multi-lobe deciduous windbreak tree crown for warm seasons. */
export function buildBroadleafCrownGeometry(): BufferGeometry {
  if (cachedBroadleafCrown) return cachedBroadleafCrown;
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.16, 0.27, 2.2, 7);
  trunk.translate(0, 1.1, 0);
  parts.push(paintVertexGradient(trunk, "#4b392b", "#644f3e", 0, 2.2));

  const lobes: [x: number, y: number, z: number, r: number][] = [
    [0.0, 3.25, 0.0, 1.15],
    [-0.78, 2.88, 0.28, 0.88],
    [0.82, 2.94, -0.18, 0.9],
    [-0.28, 2.98, -0.72, 0.85],
    [0.34, 2.86, 0.68, 0.82],
    [-0.25, 3.88, 0.14, 0.78],
    [0.35, 3.74, -0.16, 0.74],
  ];
  lobes.forEach(([lx, ly, lz, r], li) => {
    const sphere = new SphereGeometry(r, 11, 8);
    const pos = sphere.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const puff = 1 + 0.08 * Math.sin(px * 3.4 + li) * Math.cos(pz * 3.1 + py * 2.5);
      pos.setXYZ(i, px * puff + lx, py * puff * 0.88 + ly, pz * puff + lz);
    }
    sphere.computeVertexNormals();
    parts.push(paintVertexGradient(sphere, "#3a6b35", "#6ca150", ly - r, ly + r));
  });

  cachedBroadleafCrown = mergeBufferGeometries(parts);
  return cachedBroadleafCrown;
}

/** Builds a low multi-puff hedgerow understory shrub to ground tree copses along parcel borders. */
export function buildShrubGeometry(): BufferGeometry {
  if (cachedShrub) return cachedShrub;
  const parts: BufferGeometry[] = [];
  const puffs: [x: number, y: number, z: number, r: number][] = [
    [0.0, 0.44, 0.0, 0.56],
    [-0.44, 0.34, 0.18, 0.42],
    [0.46, 0.36, -0.14, 0.44],
    [0.08, 0.32, 0.4, 0.38],
  ];
  puffs.forEach(([lx, ly, lz, r], li) => {
    const sphere = new SphereGeometry(r, 9, 6);
    const pos = sphere.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const puff = 1 + 0.1 * Math.sin(px * 4.2 + li) * Math.cos(pz * 3.6);
      pos.setXYZ(i, px * puff + lx, py * puff * 0.78 + ly, pz * puff + lz);
    }
    sphere.computeVertexNormals();
    parts.push(paintVertexGradient(sphere, "#365c2f", "#66984b", 0.02, 0.92));
  });
  cachedShrub = mergeBufferGeometries(parts);
  return cachedShrub;
}

/** Builds a crisp winter forked bare-branch tree silhouette with zero solid crown blobs. */
export function buildBareBranchGeometry(): BufferGeometry {
  if (cachedBareBranch) return cachedBareBranch;
  const parts: BufferGeometry[] = [];
  const addSegment = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    r0: number,
    r1: number,
  ) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    const cyl = new CylinderGeometry(r1, r0, len, 6);
    const dir = new Vector3(dx, dy, dz).normalize();
    const up = new Vector3(0, 1, 0);
    cyl.translate(0, len / 2, 0);
    const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(dir))));
    const axis = new Vector3().crossVectors(up, dir);
    if (axis.lengthSq() > 1e-6) {
      axis.normalize();
      const tmp = new Object3D();
      tmp.quaternion.setFromAxisAngle(axis, angle);
      cyl.applyQuaternion(tmp.quaternion);
    }
    cyl.translate(x0, y0, z0);
    cyl.computeVertexNormals();
    parts.push(paintVertexGradient(cyl, "#46392f", "#64564a", 0, 4.4));
  };

  // Main trunk
  addSegment(0, 0, 0, 0.04, 1.95, -0.02, 0.22, 0.13);
  // Primary limbs + secondary forks
  const boughs: [tx: number, ty: number, tz: number, fx: number, fy: number, fz: number][] = [
    [-0.65, 3.05, 0.35, -1.15, 3.92, 0.55],
    [0.72, 3.15, -0.25, 1.18, 4.02, -0.45],
    [-0.18, 3.22, -0.68, -0.42, 4.1, -1.05],
    [0.24, 3.08, 0.66, 0.52, 3.96, 1.02],
  ];
  boughs.forEach(([tx, ty, tz, fx, fy, fz], i) => {
    addSegment(0.04, 1.88, -0.02, tx, ty, tz, 0.1, 0.055);
    addSegment(tx, ty, tz, fx, fy, fz, 0.052, 0.022);
    const sideX = tx + (i % 2 === 0 ? 0.32 : -0.35);
    const sideZ = tz + (i < 2 ? 0.36 : -0.34);
    addSegment(tx, ty, tz, sideX, fy - 0.18, sideZ, 0.048, 0.02);
  });
  addSegment(0.04, 1.9, -0.02, -0.08, 3.65, 0.08, 0.09, 0.042);
  addSegment(-0.08, 3.65, 0.08, 0.14, 4.38, -0.1, 0.04, 0.018);

  cachedBareBranch = mergeBufferGeometries(parts);
  return cachedBareBranch;
}

/**
 * The field around the plots: textured grass/snow margins running smoothly into rolling distant
 * hills, plus a curbed inspection trench in front exposing the soil cutaway profile.
 */
function Terrain({
  grass,
  count,
  soilScale,
  weather,
  soilTexture,
}: {
  grass: Color;
  count: number;
  soilScale: number;
  weather: WeatherFrame;
  soilTexture: CanvasTexture | null;
}) {
  const halfTrench = trenchHalfWidth(count);
  const trenchWidth = halfTrench * 2;
  const sideWidth = Math.max(6, TERRAIN_EXTENT - halfTrench);
  const sideCenter = halfTrench + sideWidth / 2;
  // The roots view looks level at the cut face, so its trench runs out past the camera.
  const trenchDepth = soilScale > 1 ? 70 : 3.15;
  const floorY = SOIL_TOP - SOIL_DEPTH * soilScale - 0.01;
  const wallHeight = GROUND_Y - floorY;
  const wallY = GROUND_Y - wallHeight / 2;
  const trenchBackZ = 2.15;
  const trenchFrontZ = trenchBackZ + trenchDepth;
  const trenchCenterZ = trenchBackZ + trenchDepth / 2;
  const sidePlaneDepth = TERRAIN_EXTENT - trenchBackZ;
  const sidePlaneCenterZ = trenchBackZ + sidePlaneDepth / 2;
  const frontMeadowDepth = Math.max(1, TERRAIN_EXTENT - trenchFrontZ);
  const frontMeadowCenterZ = trenchFrontZ + frontMeadowDepth / 2;
  const snow = isSnowWeather(weather);
  const storm = weather.heavyRainDays >= HEAVY_RAIN_MONTH;
  const dryness = snow ? 0 : clamp01(1 - weather.rainMm / Math.max(weather.et0Mm, 1));

  const groundUniforms = useMemo<GroundUniforms>(
    () => ({
      uSnow: { value: 0 },
      uFrost: { value: 0 },
      uDryness: { value: 0 },
      uTrenchHalfWidth: { value: halfTrench },
      uTrenchFrontZ: { value: trenchFrontZ },
      uPlotHalfZ: { value: PLOT_HALF },
    }),
    [],
  );
  const groundMat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: "#7a9a52", roughness: 0.94, side: DoubleSide });
    applyGroundShader(m, groundUniforms);
    return m;
  }, [groundUniforms]);
  useEffect(() => () => groundMat.dispose(), [groundMat]);

  useEffect(() => {
    groundUniforms.uSnow.value = snow ? 1 : 0;
    groundUniforms.uFrost!.value = !snow && weather.frost && !storm ? 0.45 : 0;
    groundUniforms.uDryness.value = dryness;
    groundUniforms.uTrenchHalfWidth.value = halfTrench;
    groundUniforms.uTrenchFrontZ.value = trenchFrontZ;
    groundMat.color.copy(grass);
  }, [groundUniforms, groundMat, grass, snow, storm, weather.frost, dryness, halfTrench, trenchFrontZ]);

  const ridgeGeom = useMemo(() => buildHorizonRidgeGeometry(), []);

  // Grass between and beside the plots, leaving each plot's own footprint open.
  const plotEdges = Array.from({ length: count }, (_, i) => [plotX(i, count) - PLOT_HALF, plotX(i, count) + PLOT_HALF]).flat();
  const stripEdges = [-TERRAIN_EXTENT, ...plotEdges, TERRAIN_EXTENT];
  const strips = Array.from({ length: count + 1 }, (_, j) => [stripEdges[j * 2], stripEdges[j * 2 + 1]]);
  const ground = (key: string, x: number, z: number, width: number, depth: number) => (
    <mesh key={key} rotation={[-Math.PI / 2, 0, 0]} position={[x, GROUND_Y, z]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <primitive object={groundMat} attach="material" dispose={null} />
    </mesh>
  );

  const curbHeight = 0.045;
  const curbThick = 0.085;
  const wallTint = snow ? "#7e6e5d" : "#685645";
  const floorTint = snow ? "#6c5d4e" : storm ? "#43362a" : "#55473a";

  return (
    <group>
      {ground("back", 0, (-TERRAIN_EXTENT - PLOT_HALF) / 2, TERRAIN_EXTENT * 2, TERRAIN_EXTENT - PLOT_HALF)}
      {strips.map(([left, right], j) =>
        ground(`strip-${j}`, (left + right) / 2, (trenchBackZ - PLOT_HALF) / 2, right - left, trenchBackZ + PLOT_HALF),
      )}
      {ground("left", -sideCenter, sidePlaneCenterZ, sideWidth, sidePlaneDepth)}
      {ground("right", sideCenter, sidePlaneCenterZ, sideWidth, sidePlaneDepth)}
      {ground("front", 0, frontMeadowCenterZ, trenchWidth, frontMeadowDepth)}
      <mesh receiveShadow>
        <primitive object={ridgeGeom} attach="geometry" dispose={null} />
        <primitive object={groundMat} attach="material" dispose={null} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, trenchCenterZ]} receiveShadow>
        <planeGeometry args={[trenchWidth, trenchDepth]} />
        <meshStandardMaterial color={floorTint} map={soilTexture ?? undefined} roughness={storm && !snow ? 0.68 : 0.94} />
      </mesh>
      <mesh position={[0, wallY, trenchBackZ]} receiveShadow>
        <planeGeometry args={[trenchWidth, wallHeight]} />
        <meshStandardMaterial color={wallTint} map={soilTexture ?? undefined} roughness={0.94} />
      </mesh>
      <mesh position={[-halfTrench, wallY, trenchCenterZ]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[trenchDepth, wallHeight]} />
        <meshStandardMaterial color={wallTint} map={soilTexture ?? undefined} roughness={0.94} />
      </mesh>
      <mesh position={[halfTrench, wallY, trenchCenterZ]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[trenchDepth, wallHeight]} />
        <meshStandardMaterial color={wallTint} map={soilTexture ?? undefined} roughness={0.94} />
      </mesh>
      <mesh position={[0, wallY, trenchFrontZ]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[trenchWidth, wallHeight]} />
        <meshStandardMaterial color={wallTint} map={soilTexture ?? undefined} roughness={0.94} />
      </mesh>
      {/* Weathered retaining curb around the soil inspection trench */}
      <mesh position={[-halfTrench, GROUND_Y + curbHeight / 2 - 0.01, trenchCenterZ]} castShadow receiveShadow>
        <boxGeometry args={[curbThick, curbHeight, trenchDepth + curbThick]} />
        <meshStandardMaterial color="#594a3d" roughness={0.82} />
      </mesh>
      <mesh position={[halfTrench, GROUND_Y + curbHeight / 2 - 0.01, trenchCenterZ]} castShadow receiveShadow>
        <boxGeometry args={[curbThick, curbHeight, trenchDepth + curbThick]} />
        <meshStandardMaterial color="#594a3d" roughness={0.82} />
      </mesh>
      <mesh position={[0, GROUND_Y + curbHeight / 2 - 0.01, trenchFrontZ]} castShadow receiveShadow>
        <boxGeometry args={[trenchWidth + curbThick, curbHeight, curbThick]} />
        <meshStandardMaterial color="#594a3d" roughness={0.82} />
      </mesh>
    </group>
  );
}

interface ShelterbeltTree {
  x: number;
  z: number;
  scaleXZ: number;
  scaleY: number;
  rotY: number;
  kind: "conifer" | "deciduous";
}

interface ShrubSpec {
  x: number;
  z: number;
  scaleXZ: number;
  scaleY: number;
  rotY: number;
}

// Organic farmstead woodlots & shelterbelt hedgerows nestled across valley parcel edges.
const { SHELTERBELT_TREES, SHRUB_SPECS } = (() => {
  const groves: [centerX: number, centerZ: number, count: number, spreadX: number][] = [
    [-92, -60, 10, 14],
    [-64, -52, 11, 13],
    [-46, -70, 9, 12],
    [-31, -56, 8, 9],
    [-20, -64, 5, 6],
    [-7, -92, 6, 8],
    [20, -63, 5, 6],
    [32, -57, 8, 9],
    [48, -71, 9, 12],
    [66, -53, 11, 13],
    [94, -62, 10, 14],
  ];
  const trees: ShelterbeltTree[] = [];
  const shrubs: ShrubSpec[] = [];
  groves.forEach(([cx, cz, cnt, spreadX], ci) => {
    for (let k = 0; k < cnt; k++) {
      const idx = ci * 17 + k;
      const hashA = ((Math.sin(idx * 12.9898 + 1.3) * 43758.5453) % 1 + 1) % 1;
      const hashB = ((Math.sin(idx * 78.233 + 2.7) * 28461.213) % 1 + 1) % 1;
      const hashC = ((Math.sin(idx * 45.164 + 4.1) * 19384.421) % 1 + 1) % 1;
      const normK = cnt > 1 ? k / (cnt - 1) - 0.5 : 0;
      const x = cx + normK * spreadX + (hashA - 0.5) * 2.2;
      const z = cz + (hashB - 0.5) * 8.5;
      const kind: "conifer" | "deciduous" = (k + ci) % 3 === 0 ? "conifer" : "deciduous";
      const baseScale = 0.38 + hashA * 0.34;
      const scaleXZ = kind === "deciduous" ? baseScale * (1.05 + hashC * 0.2) : baseScale * 0.92;
      const scaleY = kind === "conifer" ? baseScale * (1.08 + hashC * 0.16) : baseScale * (0.94 + hashC * 0.16);
      trees.push({ x, z, scaleXZ, scaleY, rotY: hashB * Math.PI * 2, kind });

      shrubs.push({
        x: x + (hashC - 0.5) * 2.4,
        z: z + 0.9 + hashA * 1.4,
        scaleXZ: 0.65 + hashB * 0.48,
        scaleY: 0.58 + hashC * 0.35,
        rotY: hashA * Math.PI * 2,
      });
    }
  });
  return { SHELTERBELT_TREES: trees, SHRUB_SPECS: shrubs };
})();

const CONIFER_SPECS = SHELTERBELT_TREES.filter((t) => t.kind === "conifer");
const DECIDUOUS_SPECS = SHELTERBELT_TREES.filter((t) => t.kind === "deciduous");

/** Mixed conifer, deciduous, and hedgerow shrub windbreaks resting on the background hills. Scenery only: not this field's surroundings. */
function TreeLine({ leafless }: { leafless: boolean }) {
  const coniferRef = useRef<InstancedMesh>(null);
  const deciduousRef = useRef<InstancedMesh>(null);
  const shrubRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const coniferGeom = useMemo(() => buildWindbreakConiferGeometry(), []);
  const broadleafGeom = useMemo(() => buildBroadleafCrownGeometry(), []);
  const branchGeom = useMemo(() => buildBareBranchGeometry(), []);
  const shrubGeom = useMemo(() => buildShrubGeometry(), []);
  const snowUniform = useMemo(() => ({ value: 0 }), []);
  const coniferMat = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    applyWindbreakSnowShader(m, snowUniform);
    return m;
  }, [snowUniform]);
  useEffect(() => () => coniferMat.dispose(), [coniferMat]);
  useEffect(() => {
    snowUniform.value = leafless ? 1 : 0;
  }, [snowUniform, leafless]);

  useEffect(() => {
    CONIFER_SPECS.forEach((t, i) => {
      dummy.position.set(t.x, terrainHillY(t.x, t.z) - 0.1, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.scale.set(t.scaleXZ, t.scaleY, t.scaleXZ);
      dummy.updateMatrix();
      coniferRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (coniferRef.current) coniferRef.current.instanceMatrix.needsUpdate = true;

    DECIDUOUS_SPECS.forEach((t, i) => {
      dummy.position.set(t.x, terrainHillY(t.x, t.z) - 0.1, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.scale.set(t.scaleXZ, t.scaleY, t.scaleXZ);
      dummy.updateMatrix();
      deciduousRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (deciduousRef.current) deciduousRef.current.instanceMatrix.needsUpdate = true;

    SHRUB_SPECS.forEach((s, i) => {
      dummy.position.set(s.x, terrainHillY(s.x, s.z) - 0.08, s.z);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.scale.set(s.scaleXZ, s.scaleY, s.scaleXZ);
      dummy.updateMatrix();
      shrubRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (shrubRef.current) shrubRef.current.instanceMatrix.needsUpdate = true;
  }, [dummy, leafless]);

  return (
    <>
      <instancedMesh ref={coniferRef} args={[coniferGeom, coniferMat, CONIFER_SPECS.length]} castShadow />
      <instancedMesh
        key={leafless ? "deciduous-bare" : "deciduous-leaf"}
        ref={deciduousRef}
        args={[leafless ? branchGeom : broadleafGeom, undefined, DECIDUOUS_SPECS.length]}
        castShadow
      >
        <meshStandardMaterial vertexColors roughness={leafless ? 0.95 : 0.88} />
      </instancedMesh>
      <instancedMesh ref={shrubRef} args={[shrubGeom, coniferMat, SHRUB_SPECS.length]} receiveShadow />
    </>
  );
}

const POLE_BAND_M = 0.5;

/** A 2 m surveyor's pole with 0.5 m bands beside the first plot, so plant heights can be judged. */
function ScalePole({ x }: { x: number }) {
  const label = getLabelTexture("2 m", true);
  const band = POLE_BAND_M * METER_TO_WORLD;
  return (
    <group position={[x, GROUND_Y, 1.98]}>
      {/* Dark iron mounting base plate */}
      <mesh position={[0, 0.012, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.11, 0.13, 0.024, 12]} />
        <meshStandardMaterial color="#35393d" metalness={0.45} roughness={0.55} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <group key={i}>
          <mesh position={[0, band * (i + 0.5), 0]} castShadow>
            <cylinderGeometry args={[0.036, 0.036, band, 10]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#c84232" : "#f6f2e8"} roughness={0.45} />
          </mesh>
          <mesh position={[0, band * (i + 1), 0]}>
            <cylinderGeometry args={[0.041, 0.041, 0.018, 10]} />
            <meshStandardMaterial color="#aeb6be" metalness={0.65} roughness={0.32} />
          </mesh>
        </group>
      ))}
      {label && (
        <sprite position={[0.48, band * 4 + 0.14, 0]} scale={[1.15, 0.43, 1]}>
          <spriteMaterial map={label} depthTest={false} />
        </sprite>
      )}
    </group>
  );
}

export default function FieldScene({
  frames,
  weather,
  latitude,
  anchors,
  cameraView = "overview",
  fitVersion = 0,
  highlightedIndex,
}: {
  frames: PlotFrame[];
  weather: WeatherFrame;
  /** The field's latitude in degrees (north positive); sets how high the midday sun stands each month. */
  latitude: number;
  anchors: RefObject<(HTMLElement | null)[]>;
  cameraView?: CameraView;
  fitVersion?: number;
  highlightedIndex?: number;
}) {
  const { size } = useThree();
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const soilTexture = useMemo(() => createSoilTexture(), []);
  useEffect(() => () => soilTexture?.dispose(), [soilTexture]);

  // Midday sun elevation from latitude/month, placed at an oblique 3/4 key azimuth for sculptural relief.
  const sunElevation = (sunElevationDeg(latitude, weather.month) * Math.PI) / 180;
  const sunUp = Math.sin(sunElevation);
  const hot = weather.heatDays >= 1;
  const darkStorm = weather.heavyRainDays >= HEAVY_RAIN_MONTH;
  const snow = isSnowWeather(weather);
  const sunFlat = Math.cos(sunElevation) * 22;
  const sun: [number, number, number] = [Math.max(8.5, sunFlat * 0.72 + 4.5), Math.max(6.0, sunUp * 22), sunFlat * 0.58 + 3.0];
  const skySunPos: [number, number, number] = [sunFlat * 0.65, Math.max(4.5, sunUp * 20), -sunFlat * 0.75];
  const dense = size.width >= 520;
  const grass = new Color("#73964b");
  if (snow) grass.set("#eef4fb");
  else if (weather.frost) grass.lerp(new Color("#657c45"), 0.35);
  else if (weather.rainMm < weather.et0Mm * 0.5) grass.lerp(new Color("#b5a25d"), 0.45);
  const skyZenith = snow ? "#5a8bc0" : weather.frost ? "#4d82ba" : darkStorm ? "#586d83" : "#3a78c2";
  const fogColor = snow ? "#d2e2f0" : weather.frost ? "#cbdeed" : darkStorm ? "#b5c5d4" : "#c4ddf2";
  const halfTrench = trenchHalfWidth(frames.length);
  const soilScale = soilExaggeration(cameraView);
  const aspect = size.width / Math.max(size.height, 1);
  const zoom = computeZoomBounds(cameraView, frames.length, aspect);

  return (
    <>
      <color attach="background" args={[fogColor]} />
      <fog attach="fog" args={[fogColor, TERRAIN_FOG_NEAR, TERRAIN_FOG_FAR]} />
      <SkyDome zenith={skyZenith} horizon={fogColor} sunPos={skySunPos} storm={darkStorm} />
      {/* Offline procedural IBL environment dome so soil, foliage, snow, and metal bands receive realistic sky/ground bounce */}
      <Environment resolution={128} frames={1} environmentIntensity={snow ? 0.54 : darkStorm ? 0.42 : 0.62}>
        <Lightformer form="rect" intensity={1.8} position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[28, 28, 1]} color="#e8f3ff" />
        <Lightformer form="circle" intensity={2.4} position={[12, 8, 8]} scale={9} color="#fff5e0" />
        <Lightformer form="rect" intensity={0.85} position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[28, 28, 1]} color="#7f715d" />
      </Environment>
      <hemisphereLight args={[snow ? "#cfe3f8" : "#dff0ff", snow ? "#8ba3bd" : "#5e4c38", snow ? 0.78 : 0.62]} />
      <ambientLight intensity={0.22 + sunUp * 0.14 + (snow ? 0.14 : 0)} />
      <directionalLight
        position={sun}
        intensity={snow ? 1.85 : 0.8 + sunUp * 1.5}
        color={hot ? "#ffd2a0" : snow ? "#fff5e6" : "#fffaf0"}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00035}
        shadow-normalBias={0.02}
        shadow-camera-left={-(halfTrench + 3)}
        shadow-camera-right={halfTrench + 3}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      {/* The roots view faces the cut soil, which a low sun misses: fill it gently from the front. */}
      {soilScale > 1 && <directionalLight position={[0, 3, 14]} intensity={1.05} />}
      <Terrain grass={grass} count={frames.length} soilScale={soilScale} weather={weather} soilTexture={soilTexture} />
      <TreeLine leafless={snow} />
      <ScalePole
        x={
          frames.length > 1
            ? (plotX(0, frames.length) + plotX(1, frames.length)) / 2
            : plotX(0, 1) - PLOT_HALF - 0.24
        }
      />
      {frames.map((frame, i) => (
        <Plot
          key={i}
          x={plotX(i, frames.length)}
          frame={frame}
          weather={weather}
          soilTexture={soilTexture}
          highlighted={highlightedIndex === i}
          soilScale={soilScale}
          dense={dense}
        />
      ))}
      <LabelAnchors count={frames.length} anchors={anchors} view={cameraView} />
      <FitCamera view={cameraView} count={frames.length} fitVersion={fitVersion} controlsRef={controlsRef} />
      <Precipitation weather={weather} />
      <Clouds weather={weather} spanFactor={halfTrench / 7.2} />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        zoomSpeed={0.85}
        minDistance={zoom.minDistance}
        maxDistance={zoom.maxDistance}
        minPolarAngle={zoom.minPolarAngle}
        maxPolarAngle={zoom.maxPolarAngle}
        minAzimuthAngle={-0.9}
        maxAzimuthAngle={0.9}
      />
    </>
  );
}
