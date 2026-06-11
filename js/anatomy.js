// MAW — procedural oral anatomy.
//
// Everything in here is built from math at load time: 28 individually
// sculpted teeth on elliptical dental arches, festooned gingiva, a hard
// palate with rugae and a median raphe, a soft palate ending in a swinging
// uvula, palatoglossal arches, a muscular tongue with a median sulcus that
// deforms on the CPU every frame, a floor of mouth with a saliva pool, and
// a continuous buccal/labial shell whose lower half is skinned to the
// mandible so the cheeks stretch when the jaw drops.
//
// Axes: +Z out of the mouth (through the lips), +Y up, units ≈ centimetres.
// The occlusal (bite) plane sits at y = 0. The camera lives at the back of
// the oropharynx, right behind the uvula.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../vendor/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- constants

export const MOUTH = {
  jawPivot: new THREE.Vector3(0, 0.55, -1.9), // temporomandibular joint
  maxJawAngle: 0.40,                           // radians of mandible rotation
  lipsZ: 6.05,                                 // exit plane
  upperLipEdgeY: 0.12,
  lipHalfWidth: 2.3,
  throat: new THREE.Vector3(0, -0.25, -1.3),   // where swallowed things go
  cameraPos: new THREE.Vector3(0, 0.78, -1.62),
  cameraLook: new THREE.Vector3(0, -0.3, 6.0),
};

const UPPER_ARCH = { rx: 2.75, rz: 4.35, zOff: 0.95 };
const LOWER_ARCH = { rx: 2.56, rz: 4.05, zOff: 0.95 };

// A spot on the lingual (tongue-facing) side of the upper arch at angle `a`
// from the midline — where a chomped morsel wedges itself between the teeth.
// The maxilla never moves, so these points are stable in world space.
export function upperLingualSpot(a, y = 0.4, inset = 0.26) {
  const nx = UPPER_ARCH.rz * Math.sin(a);
  const nz = UPPER_ARCH.rx * Math.cos(a);
  const nl = Math.hypot(nx, nz);
  return new THREE.Vector3(
    UPPER_ARCH.rx * Math.sin(a) - (nx / nl) * inset,
    y,
    UPPER_ARCH.zOff + UPPER_ARCH.rz * Math.cos(a) - (nz / nl) * inset
  );
}

// Seeded RNG so the anatomy is identical on every visit.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

// ------------------------------------------------------------ canvas helpers

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function blotch(ctx, w, h, rng, n, rMin, rMax, colors, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h;
    const r = rMin + rng() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = colors[(rng() * colors.length) | 0];
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha * (0.4 + rng() * 0.6)})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function srgbTexture(cv, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}
function dataTexture(cv, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

// Mucosa: mottled wet pink-red tissue, shared recipe with per-use palettes.
function mucosaTexture(rng, base, blotches, veins = 0) {
  const w = 512, h = 512;
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  blotch(ctx, w, h, rng, 260, 14, 80, blotches, 0.10);
  blotch(ctx, w, h, rng, 700, 2, 9, blotches, 0.14);
  // capillary veins — faint branching squiggles
  for (let i = 0; i < veins; i++) {
    let x = rng() * w, y = rng() * h;
    ctx.strokeStyle = `rgba(${90 + rng() * 40 | 0}, ${20 + rng() * 20 | 0}, ${50 + rng() * 35 | 0}, ${0.10 + rng() * 0.12})`;
    ctx.lineWidth = 0.6 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let ang = rng() * Math.PI * 2;
    for (let s = 0; s < 14; s++) {
      ang += (rng() - 0.5) * 1.3;
      x += Math.cos(ang) * (5 + rng() * 11);
      y += Math.sin(ang) * (5 + rng() * 11);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return cv;
}

// ------------------------------------------------------------------ geometry

// Generic parametric surface. fn(u, v, target) fills target with a position.
// wrapU stitches the u seam so normals stay smooth around closed rings.
function paramGeometry(nu, nv, fn, wrapU = false) {
  const cols = wrapU ? nu : nu + 1;
  const positions = new Float32Array(cols * (nv + 1) * 3);
  const uvs = new Float32Array(cols * (nv + 1) * 2);
  const p = new THREE.Vector3();
  for (let iv = 0; iv <= nv; iv++) {
    for (let iu = 0; iu < cols; iu++) {
      const u = iu / nu, v = iv / nv;
      fn(u, v, p);
      const k = iv * cols + iu;
      positions[k * 3] = p.x; positions[k * 3 + 1] = p.y; positions[k * 3 + 2] = p.z;
      uvs[k * 2] = u; uvs[k * 2 + 1] = v;
    }
  }
  const index = [];
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const iu2 = wrapU ? (iu + 1) % nu : iu + 1;
      const a = iv * cols + iu, b = iv * cols + iu2;
      const c = (iv + 1) * cols + iu, d = (iv + 1) * cols + iu2;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Arch curve in the xz plane. side: angle a ∈ [-end, +end], 0 at the midline.
function archPoint(arch, a, out) {
  out.x = arch.rx * Math.sin(a);
  out.z = arch.zOff + arch.rz * Math.cos(a);
  return out;
}
function archSpeed(arch, a) {
  const dx = arch.rx * Math.cos(a), dz = -arch.rz * Math.sin(a);
  return Math.sqrt(dx * dx + dz * dz);
}
// Outward yaw of the arch normal at angle a (rotation about Y for the tooth).
function archYaw(arch, a) {
  const nx = arch.rz * Math.sin(a), nz = arch.rx * Math.cos(a);
  return Math.atan2(nx, nz);
}
// March along the arch until the given arc length is covered.
function angleAtArc(arch, dist) {
  let a = 0, acc = 0;
  const da = 0.0015;
  while (acc < dist && a < 1.6) {
    acc += archSpeed(arch, a) * da;
    a += da;
  }
  return a;
}

// ------------------------------------------------------------------- teeth

const gaussian = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const cuspAt = (x, z, cx, cz, h, s) => {
  const dx = x - cx, dz = z - cz;
  return h * Math.exp(-(dx * dx + dz * dz) / (2 * s * s));
};

// One canonical tooth: neck at y=0, occlusal/incisal surface toward +y,
// +z buccal (cheek side), x mesiodistal. Scaled to (w, h, d) centimetres.
function toothGeometry(type, w, h, d, rng) {
  let g = new THREE.BoxGeometry(1, 1, 1, 8, 12, 8);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const cNeck = new THREE.Color(0xd9c79f);  // cervical dentin warmth
  const cBody = new THREE.Color(0xf4efe2);  // body enamel
  const cEdge = new THREE.Color(0xe6ebea);  // translucent incisal edge
  const tint = 0.97 + rng() * 0.06;
  const tmp = new THREE.Color();
  const v = new THREE.Vector3(), n = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize().multiplyScalar(0.5);
    v.lerp(n, 0.45);                              // round the box
    const t = clamp(v.y + 0.5, 0, 1);             // 0 neck → 1 occlusal
    let x = v.x, z = v.z;
    const neck = 0.66 + 0.34 * sstep(0, 0.45, t); // cervical constriction
    x *= neck; z *= neck;
    let y = t;
    const topW = sstep(0.68, 0.98, t);            // occlusal sculpt weight

    if (type === 'incisor') {
      z *= 1 - 0.58 * Math.pow(t, 1.4);                       // chisel blade
      z += 0.05 * Math.sin(t * Math.PI);                      // labial convexity
      x *= 1 + 0.07 * t;                                      // incisal flare
      y += topW * 0.02 * Math.sin(x * 38 + 1.0);              // mamelons
    } else if (type === 'canine') {
      const taper = 1 - 0.50 * t * t;
      x *= taper; z *= taper;
      y += topW * 0.24 * Math.max(0, 1 - Math.abs(x) * 4.6);  // single cusp
    } else if (type === 'premolar') {
      y += topW * (
        cuspAt(x, z, 0, 0.16, 0.15, 0.16) +                   // buccal cusp
        cuspAt(x, z, 0, -0.15, 0.12, 0.15) -                  // lingual cusp
        0.07 * gaussian(z, 0.07)                              // central groove
      );
    } else { // molar
      y += topW * (
        cuspAt(x, z, -0.17, 0.15, 0.14, 0.13) +
        cuspAt(x, z, 0.17, 0.15, 0.13, 0.13) +
        cuspAt(x, z, -0.17, -0.14, 0.12, 0.13) +
        cuspAt(x, z, 0.18, -0.14, 0.11, 0.13) -
        0.07 * gaussian(x, 0.09) * gaussian(z, 0.3) -         // central fossa
        0.045 * gaussian(z, 0.05)                             // transverse groove
      );
    }

    pos.setXYZ(i, x * w, y * h, z * d);
    tmp.copy(cNeck).lerp(cBody, sstep(0.05, 0.55, t));
    if (type === 'incisor' || type === 'canine') {
      tmp.lerp(cEdge, sstep(0.82, 1.0, t) * 0.7);
    }
    tmp.multiplyScalar(tint);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// Tooth roster, central incisor → second molar (per quadrant):
// [type, width, height, buccolingual depth]
const UPPER_TEETH = [
  ['incisor', 0.86, 1.00, 0.32],
  ['incisor', 0.66, 0.90, 0.30],
  ['canine', 0.78, 1.06, 0.42],
  ['premolar', 0.68, 0.92, 0.56],
  ['premolar', 0.66, 0.90, 0.58],
  ['molar', 1.02, 0.95, 0.78],
  ['molar', 0.95, 0.90, 0.76],
];
const LOWER_TEETH = [
  ['incisor', 0.55, 0.85, 0.28],
  ['incisor', 0.60, 0.82, 0.29],
  ['canine', 0.68, 0.88, 0.38],
  ['premolar', 0.70, 0.88, 0.52],
  ['premolar', 0.72, 0.88, 0.54],
  ['molar', 1.05, 0.92, 0.80],
  ['molar', 0.98, 0.88, 0.78],
];

// Lay one arch of teeth. Returns { geometry, boundaries } where boundaries
// are the signed arch angles between teeth (used to festoon the gums).
function buildArchTeeth(arch, roster, isUpper, gumlineY, rng) {
  const parts = [];
  const boundaries = [0.035]; // half-gap at the midline
  const p = new THREE.Vector3();
  const geos = [];
  let cursor = 0.10; // arc cm from midline to first tooth surface

  for (const [type, w, h, d] of roster) {
    const aEnd = angleAtArc(arch, cursor + w);
    const aMid = angleAtArc(arch, cursor + w / 2);
    boundaries.push(aEnd + 0.012);
    cursor += w + 0.06; // interproximal gap

    for (const side of [-1, 1]) {
      const a = aMid * side;
      const g = toothGeometry(type, w, h, d, rng);
      if (isUpper) g.rotateZ(Math.PI); // crown hangs downward
      const sink = 0.14;               // neck buried in the gingiva
      const yNeck = isUpper ? gumlineY + sink : -(gumlineY + sink);
      g.rotateY(archYaw(arch, a));     // face the crown outward along the arch
      archPoint(arch, a, p);
      g.translate(p.x, yNeck, p.z);
      geos.push(g);
    }
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return { geometry: merged, boundaries };
}

// ------------------------------------------------------------------ gingiva

// Festoon: how exposed the crown is at arch angle a. 1 over the middle of a
// tooth (margin pulled apical), 0 at the interdental papillae.
function festoon(boundaries, a) {
  const aa = Math.abs(a);
  const last = boundaries[boundaries.length - 1];
  if (aa < boundaries[0]) return 0; // papilla between the central incisors
  if (aa > last) return 0.45 * Math.max(0, 1 - (aa - last) * 3);
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (aa >= boundaries[i] && aa <= boundaries[i + 1]) {
      const s = (aa - boundaries[i]) / (boundaries[i + 1] - boundaries[i]);
      return Math.pow(Math.sin(s * Math.PI), 1.3);
    }
  }
  return 0.5;
}

function buildGums(arch, boundaries, isUpper, rng) {
  const sign = isUpper ? 1 : -1;
  const aEnd = boundaries[boundaries.length - 1] + 0.16;
  // Cross-section control points: [offset along outward normal, |y| from bite plane]
  const profile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.50, 0.74, 0),  // lingual margin
    new THREE.Vector3(-0.64, 1.18, 0),  // lingual wall
    new THREE.Vector3(0.02, 1.55, 0),   // alveolar crest / vestibule roof
    new THREE.Vector3(0.70, 1.15, 0),   // buccal wall
    new THREE.Vector3(0.60, 0.70, 0),   // buccal margin
  ]);

  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const geo = paramGeometry(150, 22, (u, v, out) => {
    const a = (u * 2 - 1) * aEnd;
    archPoint(arch, a, p);
    // outward normal in xz
    const nx = arch.rz * Math.sin(a), nz = arch.rx * Math.cos(a);
    const nl = Math.hypot(nx, nz);
    const ox = nx / nl, oz = nz / nl;

    profile.getPoint(v, q);
    let off = q.x, hy = q.y;

    const f = festoon(boundaries, a);
    // Margins (v near 0 and 1) ride apically over each crown, dip into
    // papillae between crowns; the body of the gum keeps its shape.
    const marginW = Math.max(sstep(0.12, 0.0, v), sstep(0.88, 1.0, v));
    hy += marginW * (0.16 * f - 0.10);
    // Root eminences bulge the buccal plate over each root.
    const buccalW = sstep(0.55, 0.85, v) * (1 - sstep(0.9, 1, v));
    off += buccalW * 0.10 * f;
    // organic wobble
    off += 0.02 * Math.sin(a * 41 + v * 9) + 0.015 * Math.sin(a * 17 - v * 5);

    out.set(p.x + ox * off, sign * hy, p.z + oz * off);
  });

  // stretch uvs along the arch so the texture doesn't smear
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 7);
  return geo;
}

// ------------------------------------------------------------------- palate

function buildPalate() {
  const rxIn = 2.30, rzIn = 3.85, zOff = UPPER_ARCH.zOff;
  return paramGeometry(56, 72, (u, v, out) => {
    // v: 0 back (soft palate) → 1 front (behind the incisors)
    const s = u * 2 - 1; // -1..1 across
    const widthBack = 1.78, widthFront = 0.4;
    const vault = sstep(0, 0.34, v); // how far forward we've come
    const halfW = lerp(widthBack, rxIn * Math.sqrt(Math.max(0.02, 1 - Math.pow((lerp(-1.35, zOff + rzIn - 0.45, v) - zOff) / rzIn, 2))), vault);
    const x = s * Math.max(halfW, widthFront);
    let z = lerp(-1.45, zOff + rzIn - 0.42, Math.pow(v, 0.92));
    // pull the front corners back along the arch curve
    z -= s * s * sstep(0.55, 1, v) * 1.45;

    // vault: highest mid-palate, shallower at front, sloping at the velum
    const depth = lerp(0.65, 1.1, Math.sin(Math.min(v * 1.25, 1) * Math.PI * 0.5));
    let y = 0.78 + depth * Math.pow(Math.max(0, 1 - s * s), 0.85);
    // soft palate droops toward the uvula
    y -= sstep(0.18, 0.0, v) * 0.45 * (1 - s * s * 0.5);
    // rugae: transverse ridges on the front third
    const rw = sstep(0.58, 0.72, v) * (1 - sstep(0.9, 1, v));
    y -= 0.055 * Math.pow(Math.abs(Math.sin(z * 4.1 + Math.abs(x) * 0.9)), 1.4) * rw * (0.35 + 0.65 * (1 - Math.abs(s)));
    // median raphe
    y -= 0.035 * Math.exp(-Math.pow(s * 6.5, 2)) * sstep(0.3, 0.6, v);

    out.set(x, y, z);
  });
}

// Soft palate continuation + uvula, returned as a group so it can sway.
function buildVelum(materials) {
  const group = new THREE.Group();

  const velumGeo = paramGeometry(28, 14, (u, v, out) => {
    // hangs from the back palate edge, curving down toward the pharynx
    const s = u * 2 - 1;
    const halfW = lerp(1.75, 0.55, v);
    const x = s * halfW;
    const y = lerp(1.12, 0.84, v) - s * s * 0.28 - v * v * 0.10;
    const z = lerp(-1.43, -1.16, v) + (1 - s * s) * v * 0.22;
    out.set(x, y, z);
  });
  const velum = new THREE.Mesh(velumGeo, materials.velum);
  velum.castShadow = true;
  group.add(velum);

  // Uvula — the protagonist's perch. Narrow neck, plump bulb, rounded tip.
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const bulb = 0.05 + 0.13 * Math.sin(Math.PI * Math.pow(t, 1.35));
    const cap = Math.sqrt(Math.max(0, 1 - Math.pow(sstep(0.78, 1, t), 2)));
    pts.push(new THREE.Vector2(Math.max(0.001, bulb * cap), -t * 0.5));
  }
  const uvulaGeo = new THREE.LatheGeometry(pts, 24);
  const uvula = new THREE.Mesh(uvulaGeo, materials.uvula);
  uvula.castShadow = true;

  const pendulum = new THREE.Group();
  pendulum.position.set(0, 1.45, -1.28); // right at the camera: the player IS the hangy ball
  pendulum.add(uvula);
  group.add(pendulum);

  return { group, pendulum };
}

// Palatoglossal arches — the pillars framing the view down the throat.
function buildPillar(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 1.05, 1.05, -1.30),
    new THREE.Vector3(side * 1.75, 0.55, -0.85),
    new THREE.Vector3(side * 2.18, -0.10, -0.15),
    new THREE.Vector3(side * 2.30, -0.75, 0.55),
  ]);
  return new THREE.TubeGeometry(curve, 24, 0.21, 10, false);
}

// ------------------------------------------------------------------- tongue

const TONGUE = {
  nu: 84, nv: 26,
  rootZ: -1.95, tipZ: 4.72,
  centerY: (u) => lerp(-0.58, -0.40, u) + 0.13 * Math.sin(u * Math.PI),
  topH: (u) => lerp(0.52, 0.26, sstep(0.35, 1, u)),
  botH: (u) => lerp(0.56, 0.24, u),
  halfW: (u) => 2.0 * (1 - sstep(0.5, 1, u) * 0.62) * (0.55 + 0.45 * Math.sin(Math.min(1, u * 3) * Math.PI * 0.5)),
};

// u: angle around the cross-section (wrapped seam; dorsum centre at u=0.25),
// v: along the length, root → tip.
function tongueBasePoint(u, v, out) {
  const L = v;
  const th = u * Math.PI * 2;
  let sx = Math.cos(th), sy = Math.sin(th);
  // superellipse: flatter dorsum & belly, rounded lateral borders
  sx = Math.sign(sx) * Math.pow(Math.abs(sx), 0.72);
  sy = Math.sign(sy) * Math.pow(Math.abs(sy), 0.85);

  // rounded tip cap
  const tipT = sstep(0.93, 1.0, L);
  const cap = Math.sqrt(Math.max(0, 1 - tipT * tipT));

  const hw = Math.max(0.04, TONGUE.halfW(L) * cap);
  const hy = (sy >= 0 ? TONGUE.topH(L) : TONGUE.botH(L)) * cap;

  let x = sx * hw;
  let y = TONGUE.centerY(L) + sy * hy;
  const z = lerp(TONGUE.rootZ, TONGUE.tipZ, L) + tipT * 0.12;

  // median sulcus down the dorsum, fading into a tip notch
  if (sy > 0.3) {
    const sul = 0.085 * Math.exp(-Math.pow(x / 0.4, 2)) * (0.4 + 0.6 * Math.sin(L * Math.PI));
    y -= sul * sstep(0.3, 0.8, sy);
  }
  // subtle muscular lobes along the lateral borders
  y += 0.018 * Math.sin(L * 26) * Math.abs(sx) * (sy > 0 ? 1 : 0.3);

  out.set(x, y, z);
}

function tongueTextures(rng) {
  const w = 1024, h = 512;
  // ALBEDO — dorsum band lives at v≈0.25 (texture y ≈ h*0.25)
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#a8454e');
  grad.addColorStop(0.18, '#b3505a');
  grad.addColorStop(0.32, '#ad4b55');
  grad.addColorStop(0.55, '#b75863');
  grad.addColorStop(0.78, '#c06a72'); // underside lighter
  grad.addColorStop(1.0, '#a8454e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  blotch(ctx, w, h, rng, 340, 10, 70, [[140, 50, 62], [196, 100, 106], [105, 32, 44]], 0.22);
  // whitish filiform coating, denser toward the back of the dorsum
  for (let i = 0; i < 4200; i++) {
    const x = Math.pow(rng(), 1.6) * w * 0.62;
    const y = h * 0.25 + (rng() - 0.5) * h * 0.34;
    const r = 0.8 + rng() * 2.6;
    ctx.fillStyle = `rgba(238, 224, 208, ${0.08 + rng() * 0.16})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // fungiform papillae — little red dots scattered on the dorsum
  for (let i = 0; i < 760; i++) {
    const x = rng() * w;
    const y = h * 0.25 + (rng() - 0.5) * h * 0.4;
    ctx.fillStyle = `rgba(${150 + rng() * 50 | 0}, ${30 + rng() * 25 | 0}, ${45 + rng() * 25 | 0}, ${0.35 + rng() * 0.4})`;
    ctx.beginPath(); ctx.arc(x, y, 1.2 + rng() * 2.8, 0, 7); ctx.fill();
  }
  // median sulcus shading
  ctx.fillStyle = 'rgba(95, 28, 38, 0.35)';
  ctx.fillRect(0, h * 0.245, w * 0.9, h * 0.012);
  // sublingual veins on the underside
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(70, 60, 130, ${0.10 + rng() * 0.12})`;
    ctx.lineWidth = 1.5 + rng() * 2.5;
    ctx.beginPath();
    let x = rng() * w, y = h * (0.72 + rng() * 0.16);
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += 14 + rng() * 30; y += (rng() - 0.5) * 16;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // BUMP — papillae stipple
  const bv = canvas(w, h);
  const bctx = bv.getContext('2d');
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const x = rng() * w;
    const y = h * 0.25 + (rng() - 0.5) * h * 0.42;
    const r = 0.6 + rng() * 1.8;
    bctx.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.25})`;
    bctx.beginPath(); bctx.arc(x, y, r, 0, 7); bctx.fill();
  }
  bctx.fillStyle = 'rgba(0,0,0,0.5)';
  bctx.fillRect(0, h * 0.243, w, h * 0.014); // sulcus carved into bump

  // ROUGHNESS — coated centre drier, borders & underside saliva-slick
  const rv = canvas(256, 128);
  const rctx = rv.getContext('2d');
  const rg = rctx.createLinearGradient(0, 0, 0, 128);
  rg.addColorStop(0.0, '#5a5a5a');
  rg.addColorStop(0.25, '#8a8a8a'); // dorsum band: rougher coating
  rg.addColorStop(0.5, '#4a4a4a');
  rg.addColorStop(0.8, '#383838');  // underside: wet
  rg.addColorStop(1.0, '#5a5a5a');
  rctx.fillStyle = rg;
  rctx.fillRect(0, 0, 256, 128);

  return {
    map: srgbTexture(cv),
    bumpMap: dataTexture(bv),
    roughnessMap: dataTexture(rv),
  };
}

// ----------------------------------------------------- buccal / labial shell

const SHELL = { nu: 72, nv: 46, rollStart: 40 }; // roll rows: v beyond lips

function shellBasePoint(u, v, out) {
  // u: ring angle, seam tucked at the top under the palate. v: throat → lips.
  const th = Math.PI / 2 + u * Math.PI * 2;
  const vl = v * (SHELL.nv) / SHELL.rollStart; // 0..1 reaches lips at rollStart
  const t = Math.min(vl, 1);

  // ring centreline
  const zc = lerp(-2.05, MOUTH.lipsZ + 0.05, Math.pow(t, 0.9));
  const yc = lerp(0.35, 0.02, t);

  // radii: throat → bulging cheeks (outside the gum arches) → a vestibule
  // that stays tall past the front teeth, then funnels hard into the lips
  const bulge = Math.sin(t * Math.PI);
  const funnel = sstep(0.86, 1.0, t);
  const rx = lerp(lerp(1.8, 2.7, t) + bulge * 1.2, 2.5, funnel);
  const ry = lerp(1.75 + bulge * 0.45, 0.16, funnel);

  let cx = Math.cos(th), cy = Math.sin(th);
  // superellipse — flat-ish cheek walls
  cx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.8);
  cy = Math.sign(cy) * Math.pow(Math.abs(cy), 0.9);

  let x = cx * rx;
  let y = yc + cy * ry;
  let z = zc;

  if (vl > 1) {
    // the lip roll: curl outward and forward, vermilion turning to skin
    const phi = Math.min(1, (vl - 1) / ((SHELL.nv - SHELL.rollStart) / SHELL.rollStart));
    const ang = phi * Math.PI * 0.85;
    const rollR = 0.30 + 0.10 * Math.abs(cy);
    x += cx * Math.sin(ang) * rollR * 0.8;
    y += cy * Math.sin(ang) * rollR;
    z += (1 - Math.cos(ang)) * rollR * 1.1;
  }
  out.set(x, y, z);
}

// Mandible-follow weight for a shell vertex: bottom verts ride the jaw,
// top verts stay with the skull, corners stretch between.
function shellJawWeight(u, v) {
  const th = Math.PI / 2 + u * Math.PI * 2;
  const s = Math.sin(th); // 1 top … -1 bottom
  const wy = sstep(0.18, -0.55, s);
  const wv = sstep(0.02, 0.30, v);
  return wy * wv;
}

// Vertex tint: deep wet interior → vermilion at the lip line → outer skin.
function shellColor(u, v, tmp) {
  const vl = v * SHELL.nv / SHELL.rollStart;
  const inner = new THREE.Color(0x97434c);
  const verm = new THREE.Color(0xb05156);
  const skin = new THREE.Color(0xd2a184);
  tmp.copy(inner);
  tmp.lerp(verm, sstep(0.82, 1.0, vl));
  tmp.lerp(skin, sstep(1.35, 1.9, vl));
  return tmp;
}

// ------------------------------------------------------------- floor + pool

function buildFloor() {
  return paramGeometry(40, 30, (u, v, out) => {
    const s = u * 2 - 1;
    const z = lerp(4.55, -1.95, v);
    const dz = (z - LOWER_ARCH.zOff) / (LOWER_ARCH.rz - 0.35);
    const halfW = 2.25 * Math.sqrt(Math.max(0.03, 1 - dz * dz));
    const x = s * halfW;
    let y = -0.52 - 0.62 * Math.pow(Math.max(0, 1 - s * s), 0.8) * (0.55 + 0.45 * Math.sin(v * Math.PI));
    // sublingual folds either side of the frenulum
    y += 0.10 * Math.exp(-Math.pow((Math.abs(s) - 0.3) * 6, 2)) * sstep(0.75, 0.95, 1 - v);
    out.set(x, y, z);
  });
}

function buildSaliva() {
  const g = paramGeometry(36, 26, (u, v, out) => {
    const s = u * 2 - 1;
    const z = lerp(4.2, -1.4, v);
    const dz = (z - LOWER_ARCH.zOff) / (LOWER_ARCH.rz - 0.55);
    const halfW = 2.05 * Math.sqrt(Math.max(0.0, 1 - dz * dz));
    const x = s * halfW;
    const y = -0.78 + 0.015 * Math.sin(s * 9 + z * 5);
    out.set(x, y, z);
  });
  return g;
}

// ------------------------------------------------------------------ pharynx

function buildPharynx() {
  return paramGeometry(36, 12, (u, v, out) => {
    const th = u * Math.PI * 2;
    const r = lerp(1.95, 0.4, Math.pow(v, 1.6));
    const z = lerp(-1.9, -3.4, v);
    out.set(Math.cos(th) * r, 0.25 + Math.sin(th) * r * lerp(1.0, 0.7, v) - v * 0.5, z);
  }, true);
}

// ============================================================== buildMouth ==

export function buildMouth(scene) {
  const rng = mulberry32(20260610);
  const root = new THREE.Group();
  scene.add(root);

  // ----------------------------------------------------------- materials
  const gumMap = srgbTexture(mucosaTexture(rng, '#b25260', [[210, 110, 120], [150, 55, 70], [190, 85, 95]]), 1, 1);
  const gumMat = new THREE.MeshPhysicalMaterial({
    map: gumMap, roughness: 0.34, clearcoat: 0.75, clearcoatRoughness: 0.28,
    sheen: 0.4, sheenColor: new THREE.Color(0xff8090), envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });
  const palateMat = new THREE.MeshPhysicalMaterial({
    map: srgbTexture(mucosaTexture(rng, '#c98184', [[225, 150, 150], [165, 85, 90], [205, 120, 122]], 26), 2, 2),
    roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3,
    envMapIntensity: 0.5, side: THREE.DoubleSide,
  });
  const cheekMat = new THREE.MeshPhysicalMaterial({
    map: srgbTexture(mucosaTexture(rng, '#9c4750', [[180, 90, 95], [130, 50, 60], [165, 70, 80]], 40), 3, 2),
    vertexColors: true,
    roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.3,
    envMapIntensity: 0.5, side: THREE.DoubleSide,
  });
  cheekMat.shadowSide = THREE.DoubleSide;
  const toothMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.21, clearcoat: 0.7, clearcoatRoughness: 0.22,
    ior: 1.55, envMapIntensity: 0.9,
  });
  const tongueTex = tongueTextures(rng);
  const tongueMat = new THREE.MeshPhysicalMaterial({
    map: tongueTex.map, bumpMap: tongueTex.bumpMap, bumpScale: 2.6,
    roughnessMap: tongueTex.roughnessMap, roughness: 1.0,
    clearcoat: 0.6, clearcoatRoughness: 0.2,
    sheen: 0.5, sheenColor: new THREE.Color(0xff7080), envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: gumMap, color: 0xb0606a, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.15,
    envMapIntensity: 0.7, side: THREE.DoubleSide,
  });
  const salivaMat = new THREE.MeshPhysicalMaterial({
    color: 0xc97f80, transparent: true, opacity: 0.55,
    roughness: 0.04, clearcoat: 1.0, clearcoatRoughness: 0.04,
    envMapIntensity: 1.4, depthWrite: false,
  });
  const velumMat = new THREE.MeshPhysicalMaterial({
    color: 0xa14b52, map: gumMap, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2,
    envMapIntensity: 0.6, side: THREE.DoubleSide,
  });
  const uvulaMat = new THREE.MeshPhysicalMaterial({
    color: 0xa84e58, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.3,
    sheen: 0.6, sheenColor: new THREE.Color(0xff6a70), envMapIntensity: 0.35,
  });
  const pharynxMat = new THREE.MeshPhysicalMaterial({
    color: 0x4f181c, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.4,
    envMapIntensity: 0.25, side: THREE.DoubleSide,
  });

  // -------------------------------------------------------------- maxilla
  const maxilla = new THREE.Group();
  root.add(maxilla);

  const upper = buildArchTeeth(UPPER_ARCH, UPPER_TEETH, true, 0.78, rng);
  const upperTeeth = new THREE.Mesh(upper.geometry, toothMat);
  upperTeeth.castShadow = upperTeeth.receiveShadow = true;
  maxilla.add(upperTeeth);

  const upperGums = new THREE.Mesh(buildGums(UPPER_ARCH, upper.boundaries, true, rng), gumMat);
  upperGums.castShadow = upperGums.receiveShadow = true;
  maxilla.add(upperGums);

  const palate = new THREE.Mesh(buildPalate(), palateMat);
  palate.castShadow = palate.receiveShadow = true;
  maxilla.add(palate);

  const velum = buildVelum({ velum: velumMat, uvula: uvulaMat });
  maxilla.add(velum.group);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(buildPillar(side), velumMat);
    pillar.castShadow = true;
    maxilla.add(pillar);
  }

  const pharynx = new THREE.Mesh(buildPharynx(), pharynxMat);
  maxilla.add(pharynx);

  // ------------------------------------------------------------- mandible
  // The group sits at the TMJ pivot; children are offset by -pivot so that
  // rotation.x swings the whole lower jaw open.
  const mandible = new THREE.Group();
  mandible.position.copy(MOUTH.jawPivot);
  root.add(mandible);
  const mandibleOffset = MOUTH.jawPivot.clone().negate();

  const lower = buildArchTeeth(LOWER_ARCH, LOWER_TEETH, false, 0.78, rng);
  const lowerTeeth = new THREE.Mesh(lower.geometry, toothMat);
  lowerTeeth.castShadow = lowerTeeth.receiveShadow = true;
  lowerTeeth.position.copy(mandibleOffset);
  mandible.add(lowerTeeth);

  const lowerGums = new THREE.Mesh(buildGums(LOWER_ARCH, lower.boundaries, false, rng), gumMat);
  lowerGums.castShadow = lowerGums.receiveShadow = true;
  lowerGums.position.copy(mandibleOffset);
  mandible.add(lowerGums);

  const floor = new THREE.Mesh(buildFloor(), floorMat);
  floor.receiveShadow = true;
  floor.position.copy(mandibleOffset);
  mandible.add(floor);

  const saliva = new THREE.Mesh(buildSaliva(), salivaMat);
  saliva.position.copy(mandibleOffset);
  saliva.renderOrder = 2;
  mandible.add(saliva);

  // --------------------------------------------------------------- tongue
  // u (wrapped) runs around the cross-section, v runs root → tip.
  const tongueGeo = paramGeometry(TONGUE.nv, TONGUE.nu, tongueBasePoint, true);
  {
    // The painted texture maps length along x and circumference along y,
    // so swap the generated uv components to match.
    const uv = tongueGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const a = uv.getX(i), b = uv.getY(i);
      uv.setXY(i, b, a);
    }
  }
  const tongueBase = tongueGeo.attributes.position.array.slice();
  const tongue = new THREE.Mesh(tongueGeo, tongueMat);
  tongue.castShadow = tongue.receiveShadow = true;
  tongue.frustumCulled = false;
  root.add(tongue);

  // ---------------------------------------------------------------- shell
  const shellGeo = paramGeometry(SHELL.nu, SHELL.nv, shellBasePoint, true);
  const shellBase = shellGeo.attributes.position.array.slice();
  // jaw weights + vertex colors
  {
    const count = shellGeo.attributes.position.count;
    const cols = SHELL.nu;
    const weights = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    for (let iv = 0; iv <= SHELL.nv; iv++) {
      for (let iu = 0; iu < cols; iu++) {
        const k = iv * cols + iu;
        const u = iu / SHELL.nu, v = iv / SHELL.nv;
        weights[k] = shellJawWeight(u, v);
        shellColor(u, v, tmp);
        colors[k * 3] = tmp.r; colors[k * 3 + 1] = tmp.g; colors[k * 3 + 2] = tmp.b;
      }
    }
    shellGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    shellGeo.userData.jawWeights = weights;
  }
  const shell = new THREE.Mesh(shellGeo, cheekMat);
  shell.castShadow = shell.receiveShadow = true;
  shell.frustumCulled = false;
  root.add(shell);

  // ------------------------------------------------------- animation state
  const state = {
    jawAngle: 0,          // set by the game every frame
    talk: 0,              // 0..1 — articulation amount
    wordCurl: 0,          // tongue-tip curl while a word passes
    chew: 0,              // transient pressed-back tongue during a chomp
    swallowT: -1,         // 0..1 travelling wave when swallowing
    time: 0,
    uvulaVel: 0, uvulaAng: 0, uvulaVelZ: 0, uvulaAngZ: 0,
  };

  const pivotY = MOUTH.jawPivot.y, pivotZ = MOUTH.jawPivot.z;

  function deformTongue() {
    const pos = tongueGeo.attributes.position;
    const arr = pos.array;
    const t = state.time;
    const jaw = state.jawAngle;
    for (let i = 0; i < pos.count; i++) {
      const bx = tongueBase[i * 3], by = tongueBase[i * 3 + 1], bz = tongueBase[i * 3 + 2];
      const u = clamp((bz - TONGUE.rootZ) / (TONGUE.tipZ - TONGUE.rootZ), 0, 1);
      let x = bx, y = by, z = bz;

      // slow breathing undulation
      y += 0.04 * Math.sin(t * 1.7 + u * 5.0) * u;
      // articulation: rapid tip work while words are being formed
      const tipW = sstep(0.5, 1, u);
      y += state.talk * tipW * (0.16 * Math.sin(t * 9.2 + 1.2) + 0.07 * Math.sin(t * 13.7));
      x += state.talk * tipW * 0.12 * Math.sin(t * 7.3);
      // word curl: tip reaches for the palate
      y += state.wordCurl * tipW * 0.55;
      z -= state.wordCurl * tipW * 0.18;
      // chew: tongue flattens and retreats out of harm's way
      z -= state.chew * u * 0.55;
      y = lerp(y, y * 0.7 - 0.08, state.chew * sstep(0.25, 0.9, u));
      // swallow: a wave travels tip → root
      if (state.swallowT >= 0) {
        const wavePos = 1 - state.swallowT;
        y += 0.42 * Math.exp(-Math.pow((u - wavePos) * 5, 2)) * Math.sin(state.swallowT * Math.PI);
      }
      // follow the mandible — root rides the jaw, tip has a will of its own
      const w = clamp(0.95 - u * 0.5, 0.4, 0.95);
      const ang = jaw * w;
      const dy = y - pivotY, dz = z - pivotZ;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      y = pivotY + dy * ca - dz * sa;
      z = pivotZ + dy * sa + dz * ca;

      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    tongueGeo.computeVertexNormals();
  }

  function deformShell() {
    const pos = shellGeo.attributes.position;
    const arr = pos.array;
    const weights = shellGeo.userData.jawWeights;
    const jaw = state.jawAngle;
    for (let i = 0; i < pos.count; i++) {
      const w = weights[i];
      const bx = shellBase[i * 3], by = shellBase[i * 3 + 1], bz = shellBase[i * 3 + 2];
      if (w < 0.001) {
        arr[i * 3] = bx; arr[i * 3 + 1] = by; arr[i * 3 + 2] = bz;
        continue;
      }
      const ang = jaw * w;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dy = by - pivotY, dz = bz - pivotZ;
      arr[i * 3] = bx * (1 - w * 0.06 * Math.sin(jaw * 2.4)); // cheeks pull in slightly
      arr[i * 3 + 1] = pivotY + dy * ca - dz * sa;
      arr[i * 3 + 2] = pivotZ + dy * sa + dz * ca;
    }
    pos.needsUpdate = true;
    shellGeo.computeVertexNormals();
  }

  // ------------------------------------------------------------------ API
  const api = {
    root, mandible, tongue, shell,
    uvulaPendulum: velum.pendulum,
    state,

    // call once per frame
    update(dt, params) {
      state.time += dt;
      state.jawAngle = params.jawAngle;
      state.talk = lerp(state.talk, params.talk, 1 - Math.exp(-dt * 8));
      state.wordCurl = lerp(state.wordCurl, params.wordCurl, 1 - Math.exp(-dt * 10));
      state.chew = lerp(state.chew, params.chew, 1 - Math.exp(-dt * 9));
      if (state.swallowT >= 0) {
        state.swallowT += dt * 1.6;
        if (state.swallowT > 1) state.swallowT = -1;
      }

      mandible.rotation.x = state.jawAngle;

      // uvula pendulum — damped spring, kicked by chomps and passing words
      const k = 26, damp = 2.6;
      state.uvulaVel += (-k * state.uvulaAng - damp * state.uvulaVel) * dt;
      state.uvulaAng += state.uvulaVel * dt;
      state.uvulaVelZ += (-k * state.uvulaAngZ - damp * state.uvulaVelZ) * dt;
      state.uvulaAngZ += state.uvulaVelZ * dt;
      const idle = 0.05 * Math.sin(state.time * 2.3) + state.talk * 0.1 * Math.sin(state.time * 11);
      velum.pendulum.rotation.x = state.uvulaAng + idle;
      velum.pendulum.rotation.z = state.uvulaAngZ + 0.04 * Math.sin(state.time * 1.7);

      deformTongue();
      deformShell();
    },

    // impulses
    kickUvula(vx = 1.2, vz = 0) {
      state.uvulaVel += vx;
      state.uvulaVelZ += vz + (Math.random() - 0.5) * 0.8;
    },
    triggerSwallow() { state.swallowT = 0; },

    // ---- gameplay geometry queries ----
    // Approximate resting height of the dorsum at (x, z), including jaw drop.
    tongueSurfaceY(x, z) {
      const u = clamp((z - TONGUE.rootZ) / (TONGUE.tipZ - TONGUE.rootZ), 0, 1);
      const hw = TONGUE.halfW(u);
      const lateral = clamp(Math.abs(x) / Math.max(hw, 0.001), 0, 1);
      let y = TONGUE.centerY(u) + TONGUE.topH(u) * Math.sqrt(Math.max(0, 1 - lateral * lateral * 0.8));
      const w = clamp(0.95 - u * 0.5, 0.4, 0.95);
      y -= Math.sin(state.jawAngle * w) * (z - pivotZ);
      return y;
    },

    // Inner half-width of the corridor at depth z (cheek walls / arches).
    corridorHalfWidth(z) {
      const dz = (z - LOWER_ARCH.zOff) / LOWER_ARCH.rz;
      return Math.max(0.7, 2.3 * Math.sqrt(Math.max(0.05, 1 - dz * dz)));
    },

    // The lip aperture for a given jaw angle.
    aperture(jawAngle = state.jawAngle) {
      const drop = Math.sin(jawAngle) * (MOUTH.lipsZ - pivotZ);
      const halfH = Math.max(0.02, drop / 2);
      const centerY = MOUTH.upperLipEdgeY - halfH;
      const open01 = clamp(jawAngle / MOUTH.maxJawAngle, 0, 1);
      const halfW = MOUTH.lipHalfWidth * (0.35 + 0.65 * Math.sqrt(open01));
      return { centerY, halfH, halfW, open01 };
    },
  };

  return api;
}
