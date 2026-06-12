// MAW — the dinner guest's face. During the DEFEND YOURSELF round you sit
// across the table from the mouth, and for those ten seconds it needs to be
// somebody: a whole sculpted head — skull and brow, orbital sockets with
// blinking eyes that track the incoming food, a properly overhanging nose
// with alar flares and nostrils, cheekbones, nasolabial folds, a chin that
// rides the mandible, salt-and-pepper hair swept back in instanced clumps,
// grey-flecked stubble, and a collar to land the splatter on. All of it is
// procedural: one generated skin texture, one parametric head plate, one
// deformed-sphere nose, and a few hundred hair cards.

import * as THREE from 'three';
import { MOUTH } from './anatomy.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const g1 = (d, s) => Math.exp(-((d / s) * (d / s)));
const g2 = (dx, dy, sx, sy) => Math.exp(-((dx / sx) * (dx / sx) + (dy / sy) * (dy / sy)));

// deterministic speckle — same face every dinner
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- proportions

const HOLE_RX = 2.55, HOLE_RY = 0.6;  // tucked just behind the lip roll
const PLATE = { nu: 144, nv: 40 };

// planar skin-texture projection shared by every skinned part
const uvOf = (x, y) => [(x + 8) / 16, (y + 6.5) / 20];

// Hairline: high forehead, receded temples, dropping down past the ears.
function hairlineY(x) {
  const ax = Math.abs(x);
  let y = 7.8 + 0.02 * x * x + 1.5 * g1(ax - 3.6, 1.1);
  y -= 6.5 * sstep(4.9, 6.3, ax); // side hair above the ears
  return y;
}

// Salt-and-pepper stubble lives on the jaw, chin and upper lip.
function stubbleMask(x, y) {
  const ax = Math.abs(x);
  let m = sstep(0.25, -0.8, y) * (1 - sstep(-4.2, -5.2, y));
  m = Math.max(m, 0.8 * g1(y - 1.05, 0.38) * (1 - sstep(1.9, 2.9, ax)));
  return m;
}

// ----------------------------------------------------- the structural skull
// Depth (z, toward the guest) of the face surface at (x, y): the front of a
// head ellipsoid with every landmark sculpted in.

function headDepth(x, y) {
  const ax = Math.abs(x);
  const ex = x / 7.4;
  const ey = (y - 4.0) / (y > 4.0 ? 10.6 : 11.8); // longer jaw than crown
  let z = 0.9 + 5.5 * Math.sqrt(Math.max(0.02, 1 - ex * ex - ey * ey));

  // brow ridge over the sockets, heavier toward the glabella
  z += 0.30 * g1(y - 6.35, 0.58) * (1 - sstep(3.0, 4.2, ax));
  // orbital sockets
  z -= 0.58 * g2(ax - 2.1, y - 5.0, 1.2, 0.88);
  // cheekbones, and the hollow of the cheek under them
  z += 0.38 * g2(ax - 3.7, y - 3.1, 1.35, 1.15);
  z -= 0.22 * g2(ax - 3.2, y + 0.4, 1.25, 1.5);
  // nasolabial folds
  z -= 0.16 * g2(ax - 2.45, y - 0.45, 0.32, 1.3);
  // philtrum + fuller lip rolls above and below the mouth
  z -= 0.12 * g1(x, 0.22) * g1(y - 1.0, 0.4);
  z += 0.2 * g1(y - 0.78, 0.35) * (1 - sstep(1.7, 2.7, ax));
  z += 0.18 * g1(y + 0.95, 0.32) * (1 - sstep(1.6, 2.5, ax));
  // chin boss, mentolabial crease, jawline mass
  z += 0.9 * g2(x, y + 2.6, 1.3, 1.2);
  z -= 0.24 * g1(y + 1.55, 0.36) * g1(x, 1.7);
  z += 0.22 * g2(ax - 4.0, y + 2.0, 1.7, 1.5);
  // temple hollows
  z -= 0.2 * g2(ax - 4.9, y - 6.4, 1.3, 1.6);
  // a soft dorsum bed for the nose mesh to sit into
  z += 0.30 * g2(x, y - 3.4, 0.85, 1.7);
  return z;
}

// One ring sample of the head plate: th around the mouth, v hole → outline.
function plateSample(th, v, out) {
  let cx = Math.cos(th), cy = Math.sin(th);
  cx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.85);
  cy = Math.sign(cy) * Math.pow(Math.abs(cy), 0.9);
  const ease = Math.pow(v, 1.15);
  // the head outline: temples and cheeks wide, jaw tapering to the chin
  let ox, oy;
  if (cy >= 0) {
    ox = cx * (6.7 - 1.2 * cy * cy);
    oy = cy * 12.4;
  } else {
    ox = cx * (6.7 - 2.9 * Math.pow(-cy, 1.15));
    oy = cy * 5.45;
  }
  const x = lerp(cx * HOLE_RX, ox, ease);
  const y = lerp(cy * HOLE_RY, oy, ease);
  let z = lerp(6.32, headDepth(x, y), sstep(0.02, 0.14, v));
  z -= 2.2 * sstep(0.86, 1.0, v) ** 2; // the silhouette turns away
  return out.set(x, y, z);
}

// ------------------------------------------------------------ skin texture
// Broad tone lives in vertex colors; this map carries the pores, blotches
// and faint lines that make skin read as skin under the key light.

function skinTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d2a184';
  ctx.fillRect(0, 0, 512, 512);

  // mottled warm blotches
  for (let i = 0; i < 90; i++) {
    const x = rng() * 512, y = rng() * 512, r = 14 + rng() * 60;
    const warm = rng() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? 'rgba(214, 142, 104, 0.10)' : 'rgba(226, 192, 158, 0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // pores
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(122, 72, 50, ${0.03 + rng() * 0.05})`;
    ctx.beginPath();
    ctx.arc(rng() * 512, rng() * 512, 0.5 + rng() * 1.1, 0, 7);
    ctx.fill();
  }
  // faint creases
  ctx.strokeStyle = 'rgba(140, 86, 62, 0.05)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const x = rng() * 512, y = rng() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 70, y + 12 + rng() * 18, x + (rng() - 0.5) * 90, y + 26 + rng() * 30);
    ctx.stroke();
  }
  // forehead furrows — three faint worry lines
  ctx.strokeStyle = 'rgba(146, 92, 66, 0.16)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const wy = 6.7 + i * 0.55;
    const [, v0] = uvOf(0, wy);
    const cy = (1 - v0) * 512;
    const [u0] = uvOf(-3.1, 0), [u1] = uvOf(3.1, 0);
    ctx.beginPath();
    ctx.moveTo(u0 * 512, cy + 4);
    ctx.quadraticCurveTo(256, cy - 7 - i, u1 * 512, cy + 4);
    ctx.stroke();
  }
  // salt-and-pepper stubble, painted where the mask says beard
  for (let i = 0; i < 9000; i++) {
    const wx = (rng() - 0.5) * 13, wy = -6 + rng() * 8.2;
    const m = stubbleMask(wx, wy);
    if (m * 0.95 < rng()) continue;
    const [u, v] = uvOf(wx, wy);
    const salt = rng() < 0.3;
    ctx.fillStyle = salt
      ? `rgba(214, 214, 218, ${0.25 + rng() * 0.3})`
      : `rgba(58, 52, 48, ${0.3 + rng() * 0.35})`;
    ctx.beginPath();
    ctx.arc(u * 512, (1 - v) * 512, 0.5 + rng() * 0.9, 0, 7);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// -------------------------------------------------------------- head plate

function buildPlateGeometry(rng) {
  const { nu, nv } = PLATE;
  const count = (nv + 1) * nu;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const weights = new Float32Array(count);
  const p = new THREE.Vector3();

  for (let iv = 0; iv <= nv; iv++) {
    const v = iv / nv;
    for (let iu = 0; iu < nu; iu++) {
      const th = (iu / nu) * Math.PI * 2;
      plateSample(th, v, p);
      const k = iv * nu + iu;
      positions[k * 3] = p.x; positions[k * 3 + 1] = p.y; positions[k * 3 + 2] = p.z;
      [uvs[k * 2], uvs[k * 2 + 1]] = uvOf(p.x, p.y);

      const x = p.x, y = p.y, ax = Math.abs(x);

      // ---- vertex color = baked AO + complexion, multiplied over the map
      let ao = 1;
      ao -= 0.32 * g2(ax - 2.1, y - 5.0, 1.2, 0.9);            // sockets
      ao -= 0.15 * g1(y - 5.75, 0.5) * (1 - sstep(3.2, 4.4, ax)); // under the brow
      ao -= 0.22 * g2(x, y - 1.3, 0.8, 0.5);                   // under the nose
      ao -= 0.14 * g2(ax - 2.45, y - 0.45, 0.38, 1.3);         // nasolabial
      ao -= 0.18 * g1(y + 1.55, 0.42) * g1(x, 1.7);            // mentolabial
      ao -= 0.10 * g2(ax - 3.2, y + 0.4, 1.3, 1.5);            // cheek hollow
      ao -= 0.45 * g2(ax - 2.05, y - 6.15, 1.0, 0.4);          // brow-hair shadow
      ao -= 0.30 * sstep(0.86, 1.0, v);                        // silhouette
      ao -= 0.28 * sstep(-4.4, -5.4, y);                       // under the chin
      ao = Math.max(ao, 0.25);

      const flush = clamp(
        0.45 * g2(ax - 3.4, y - 2.4, 1.7, 1.5) + 0.3 * g1(y + 2.6, 1.0) * g1(x, 1.6),
        0, 1
      );
      let r = ao * (1 + 0.10 * flush);
      let g = ao * (1 - 0.05 * flush);
      let b = ao * (1 - 0.10 * flush);

      // grey-flecked stubble
      const stub = stubbleMask(x, y);
      if (stub > 0.01) {
        const fleck = stub * (0.5 + 0.5 * rng());
        const tone = ao * (0.74 + 0.12 * rng());
        r = lerp(r, tone * 0.96, 0.5 * fleck);
        g = lerp(g, tone * 0.95, 0.5 * fleck);
        b = lerp(b, tone, 0.5 * fleck);
      }
      // scalp under the hair clumps
      const hair = sstep(hairlineY(x) - 0.5, hairlineY(x) + 0.7, y);
      if (hair > 0) {
        const fleck = 0.07 + 0.08 * rng();
        r = lerp(r, fleck, hair);
        g = lerp(g, fleck, hair);
        b = lerp(b, fleck * 1.1, hair);
      }
      // a warm vermilion ring against the lip roll
      const vm = 1 - sstep(0.02, 0.1, v);
      r = lerp(r, 0.95, vm * 0.7);
      g = lerp(g, 0.6, vm * 0.7);
      b = lerp(b, 0.56, vm * 0.7);

      colors[k * 3] = r; colors[k * 3 + 1] = g; colors[k * 3 + 2] = b;

      // chin and jawline ride the mandible, fading toward the ears
      weights[k] = sstep(0.3, -0.9, y) * (1 - 0.75 * sstep(3.0, 6.5, ax));
    }
  }

  const indices = [];
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = iv * nu + iu;
      const b = iv * nu + (iu + 1) % nu;
      const c = a + nu, d = b + nu;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.userData.base = positions.slice();
  geo.userData.jawWeights = weights;
  return geo;
}

// --------------------------------------------------------------------- nose
// A deformed sphere, so the tip genuinely overhangs and the nostrils sit on
// real underside geometry — a heightfield can't do that.

function buildNoseGeometry() {
  const geo = new THREE.SphereGeometry(1, 44, 32);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const uvs = geo.attributes.uv;
  const p = new THREE.Vector3();
  const CENTER = new THREE.Vector3(0, 2.95, 6.02);

  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const sx = p.x, sy = p.y, sz = p.z;
    const ny = (sy + 1) / 2;                  // 0 base … 1 radix
    const frontW = sstep(-0.25, 0.45, sz);
    const alar = g1(ny - 0.24, 0.16);

    // narrow bony bridge widening into the alar flare
    let X = sx * (0.55 - 0.2 * sstep(0.45, 0.95, ny));
    X *= 1 + 0.8 * alar * frontW;
    const Y = sy * 1.85;
    // bulbous tip in front, flattened back bedded into the face
    let Z = sz >= 0
      ? sz * (0.6 + 0.45 * g1(ny - 0.3, 0.22))
      : sz * 0.32;
    Z += 0.5 * (1 - ny) * frontW;             // the nose leans out as it descends
    Z -= 0.8 * g1(ny - 0.02, 0.13) * frontW;  // and tucks back under to the lip

    pos.setXYZ(i, X, Y, Z);

    // colors: nostril shadow under the base, alar crease, a weathered tip
    let r = 1, g = 1, b = 1;
    const under = (1 - frontW * 0.4) * sstep(0.3, 0.05, ny) * sstep(-0.2, -0.75, sy * Math.sign(1));
    const nostril = sstep(0.22, 0.06, ny) * sstep(0.15, 0.55, sz) * g1(Math.abs(sx) - 0.45, 0.28);
    const crease = g1(Math.abs(sx) - 0.92, 0.16) * g1(ny - 0.22, 0.12);
    const shade = clamp(1 - 0.75 * nostril - 0.35 * crease - 0.25 * sstep(0.25, 0.02, ny), 0.2, 1);
    r *= shade; g *= shade; b *= shade;
    const flush = 0.5 * g1(ny - 0.3, 0.2) * frontW;
    r *= 1 + 0.12 * flush; g *= 1 - 0.04 * flush; b *= 1 - 0.10 * flush;
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;

    // planar UVs in world space so the skin map continues off the cheeks
    const [u, vv] = uvOf(X + CENTER.x, Y + CENTER.y);
    uvs.setXY(i, u, vv);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.userData.center = CENTER;
  return geo;
}

// --------------------------------------------------------------------- eyes

function irisTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  // sclera corner (the disc edge blends into the white ball behind it)
  ctx.fillStyle = '#f2efe9';
  ctx.fillRect(0, 0, 128, 128);
  // iris — steel grey-blue, darker limbal ring (painted cool to survive
  // the warm candlelight)
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 46);
  g.addColorStop(0.0, '#b8cdd9');
  g.addColorStop(0.55, '#7e96a8');
  g.addColorStop(0.85, '#4d6275');
  g.addColorStop(1.0, '#26323c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(64, 64, 46, 0, 7); ctx.fill();
  // radial striations
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    ctx.strokeStyle = i % 2 ? 'rgba(28, 36, 42, 0.35)' : 'rgba(170, 184, 192, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 13, 64 + Math.sin(a) * 13);
    ctx.lineTo(64 + Math.cos(a + 0.06) * 44, 64 + Math.sin(a + 0.06) * 44);
    ctx.stroke();
  }
  // pupil + painted catch-light
  ctx.fillStyle = '#0a0c0e';
  ctx.beginPath(); ctx.arc(64, 64, 15, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255, 252, 244, 0.85)';
  ctx.beginPath(); ctx.arc(50, 48, 7, 0, 7); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildEye(side, lidMat, irisTex) {
  const group = new THREE.Group();
  const socketZ = headDepth(2.1 * side, 5.0) - 0.12;
  group.position.set(2.08 * side, 5.0, socketZ);

  // the ball — wet white
  const ballMat = new THREE.MeshPhysicalMaterial({
    color: 0xfaf7f0, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.12,
    envMapIntensity: 0.25, // the warm env turns whites amber — keep it low
  });
  const eye = new THREE.Group(); // rotates to look
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 26, 18), ballMat);
  eye.add(ball);
  const iris = new THREE.Mesh(
    new THREE.CircleGeometry(0.24, 24),
    new THREE.MeshPhysicalMaterial({
      map: irisTex, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1,
      envMapIntensity: 0.2,
    })
  );
  iris.position.z = 0.52; // proud of the ball — no z-fighting at distance
  eye.add(iris);
  group.add(eye);

  // lids — sphere caps on pivots; the upper one blinks
  const upper = new THREE.Group();
  const upperCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 26, 10, 0, Math.PI * 2, 0, 0.95), lidMat
  );
  upper.add(upperCap);
  upper.rotation.x = 0.35;
  group.add(upper);

  const lower = new THREE.Group();
  const lowerCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.595, 26, 8, 0, Math.PI * 2, Math.PI - 0.78, 0.78), lidMat
  );
  lower.add(lowerCap);
  lower.rotation.x = -0.3;
  group.add(lower);

  return { group, eye, upper, lower, side };
}

// --------------------------------------------------------------------- hair
// Salt-and-pepper clumps: one curved tapered card, a few hundred instances
// combed back over the scalp, down past the temples, and two brow tufts.

const HAIR_PALETTE = [
  [0xd8d8da, 0.24], [0x9b9b9f, 0.30], [0x4c4c50, 0.30],
  [0xf0f0f2, 0.06], [0x2f2f33, 0.10],
];
function pickHairColor(rng, out) {
  let t = rng();
  for (const [hex, w] of HAIR_PALETTE) {
    t -= w;
    if (t <= 0) return out.setHex(hex);
  }
  return out.setHex(0x9b9b9f);
}

function clumpGeometry() {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 7);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y + 0.5; // 0 root … 1 tip
    const w = lerp(1, 0.15, t);
    v.x *= w;
    v.z = -0.42 * t * t + 0.06 * Math.sin(t * Math.PI) + 0.05 * v.x * v.x;
    v.x += 0.06 * Math.sin(t * 9);
    pos.setXYZ(i, v.x, t, v.z); // root at y=0
  }
  geo.computeVertexNormals();
  return geo;
}

function buildHair(rng) {
  const COUNT = 430;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.68, clearcoat: 0.25, clearcoatRoughness: 0.45,
    sheen: 0.5, sheenColor: new THREE.Color(0xcfd2d8), envMapIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(clumpGeometry(), mat, COUNT);
  mesh.frustumCulled = false;

  const p = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const n = new THREE.Vector3(), dir = new THREE.Vector3();
  const xa = new THREE.Vector3(), za = new THREE.Vector3();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const col = new THREE.Color();
  const basis = new THREE.Matrix4();

  let placed = 0;
  let guard = 0;
  while (placed < COUNT - 22 && guard++ < 6000) {
    // sample the plate in its own coordinates so clumps sit on the surface
    const th = (0.5 + (rng() - 0.5) * 1.3) * Math.PI; // the visible upper arc
    const v = 0.45 + rng() * 0.52;
    plateSample(th, v, p);
    if (p.y < hairlineY(p.x) - 0.4) continue;
    // side hair stays past the temples — never over the face
    if (p.y < 6.2 && Math.abs(p.x) < 5.2) continue;

    // surface normal from finite differences
    plateSample(th + 0.015, v, pa).sub(p);
    plateSample(th, Math.min(v + 0.01, 0.99), pb).sub(p);
    n.crossVectors(pa, pb).normalize();
    if (n.z < 0) n.negate();

    // combed back and to the sides; temple hair lies downward
    const sideF = sstep(6.2, 3.2, p.y);
    dir.set(
      Math.sign(p.x) * (0.3 + 0.4 * sideF) + (rng() - 0.5) * 0.3,
      lerp(0.8, -0.9, sideF) + (rng() - 0.5) * 0.3,
      -0.45
    ).normalize();
    dir.addScaledVector(n, 0.3).normalize();

    za.copy(n).addScaledVector(dir, -n.dot(dir)).normalize();
    xa.crossVectors(dir, za).normalize();
    basis.makeBasis(xa, dir, za);
    q.setFromRotationMatrix(basis);
    s.set(0.8 + rng() * 0.9, 1.5 + rng() * 1.4, 1);
    m.compose(pa.copy(p).addScaledVector(n, 0.05), q, s);
    mesh.setMatrixAt(placed, m);
    mesh.setColorAt(placed, pickHairColor(rng, col));
    placed++;
  }

  // brow tufts — pepper-heavy, swept outward along the brow arc
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const bx = side * (1.1 + t * 2.0);
      const by = 6.2 + Math.sin(t * Math.PI) * 0.3 - t * 0.25;
      const bz = headDepth(bx, by) + 0.08;
      dir.set(side * 1, 0.12 - t * 0.3, 0.18).normalize();
      n.set(side * 0.15, 0.35, 1).normalize();
      za.copy(n).addScaledVector(dir, -n.dot(dir)).normalize();
      xa.crossVectors(dir, za).normalize();
      basis.makeBasis(xa, dir, za);
      q.setFromRotationMatrix(basis);
      s.set(0.65 + rng() * 0.3, 0.7 + rng() * 0.35, 1);
      m.compose(p.set(bx, by, bz), q, s);
      mesh.setMatrixAt(placed, m);
      col.setHex(rng() < 0.75 ? 0x3c3a38 : 0x9b9b9f); // mostly pepper, some salt
      mesh.setColorAt(placed, col);
      placed++;
    }
  }
  // park any unused instances out of sight
  for (let i = placed; i < COUNT; i++) {
    m.compose(p.set(0, -999, 0), q.identity(), s.set(0.001, 0.001, 0.001));
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ============================================================== buildGuestFace

export function buildGuestFace() {
  const rng = mulberry32(20260612);
  const group = new THREE.Group();

  const skinTex = skinTexture(rng);
  const skinMat = new THREE.MeshPhysicalMaterial({
    map: skinTex, vertexColors: true,
    roughness: 0.62, clearcoat: 0.08, clearcoatRoughness: 0.5,
    sheen: 0.3, sheenColor: new THREE.Color(0xffd6c0), envMapIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  const lidMat = new THREE.MeshPhysicalMaterial({
    color: 0xc99577, map: skinTex,
    roughness: 0.6, clearcoat: 0.08, clearcoatRoughness: 0.5,
    envMapIntensity: 0.3, side: THREE.DoubleSide,
  });

  // the head plate
  const plateGeo = buildPlateGeometry(rng);
  const plate = new THREE.Mesh(plateGeo, skinMat);
  plate.frustumCulled = false;
  group.add(plate);

  // the nose
  const noseGeo = buildNoseGeometry();
  const nose = new THREE.Mesh(noseGeo, skinMat);
  nose.position.copy(noseGeo.userData.center);
  group.add(nose);
  // nostril openings — two dark plugs under the alae
  const nostrilMat = new THREE.MeshPhysicalMaterial({ color: 0x221008, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const plug = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), nostrilMat);
    plug.scale.set(0.18, 0.11, 0.15);
    plug.position.set(0.44 * side, 1.75, 6.3); // tucked up under the alae
    plug.rotation.x = 0.6;
    group.add(plug);
  }

  // eyes
  const irisTex = irisTexture();
  const eyes = [buildEye(-1, lidMat, irisTex), buildEye(1, lidMat, irisTex)];
  for (const e of eyes) group.add(e.group);

  // hair
  group.add(buildHair(rng));

  // neck and collar below the chin
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 2.7, 3.6, 20, 1, true),
    new THREE.MeshPhysicalMaterial({ color: 0x8a6750, roughness: 0.75, envMapIntensity: 0.15 })
  );
  neck.scale.z = 0.7;
  neck.position.set(0, -6.6, 3.3);
  group.add(neck);
  const collar = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 6.5),
    new THREE.MeshPhysicalMaterial({ color: 0x2b3038, roughness: 0.95, side: THREE.DoubleSide })
  );
  collar.position.set(0, -6.9, 4.3);
  collar.rotation.x = -0.35;
  group.add(collar);

  // candlelight from the guest's side + a cool fill to shape the features
  // (physical falloff — intensities are candela at ~6 units range)
  const glow = new THREE.PointLight(0xffd9b8, 55, 18, 2);
  glow.position.set(0, 1.4, 11.5);
  group.add(glow);
  const fill = new THREE.PointLight(0x9fb6d8, 18, 16, 2);
  fill.position.set(-4.5, 3.5, 10);
  group.add(fill);

  group.visible = false;

  // ------------------------------------------------------------- animation
  const pivotY = MOUTH.jawPivot.y, pivotZ = MOUTH.jawPivot.z;
  let lastJaw = -1;
  let blinkTimer = 1.2;
  let blinkT = -1; // -1 idle, else 0..1 through the blink
  const lookDir = new THREE.Vector3();
  let yaw = 0, pitch = 0;

  function deformPlate(jaw) {
    if (Math.abs(jaw - lastJaw) < 0.0006) return;
    lastJaw = jaw;
    const pos = plateGeo.attributes.position;
    const arr = pos.array;
    const base = plateGeo.userData.base;
    const weights = plateGeo.userData.jawWeights;
    for (let i = 0; i < pos.count; i++) {
      const w = weights[i];
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      if (w < 0.001) {
        arr[i * 3] = bx; arr[i * 3 + 1] = by; arr[i * 3 + 2] = bz;
        continue;
      }
      const ang = jaw * w;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dy = by - pivotY, dz = bz - pivotZ;
      arr[i * 3] = bx;
      arr[i * 3 + 1] = pivotY + dy * ca - dz * sa;
      arr[i * 3 + 2] = pivotZ + dy * sa + dz * ca;
    }
    pos.needsUpdate = true;
    plateGeo.computeVertexNormals();
  }

  return {
    group,
    plateGeo,

    // dt is real time; jaw in radians, cough 0..1, look is a world point.
    update(dt, { jaw = 0, cough = 0, look = null } = {}) {
      deformPlate(jaw);

      // blinking: random idle blinks, plus a hard squint with every cough
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkT < 0) {
        blinkT = 0;
        blinkTimer = 1.6 + Math.random() * 2.8;
      }
      let blinkEnv = 0;
      if (blinkT >= 0) {
        blinkT += dt / 0.24;
        blinkEnv = Math.sin(Math.min(blinkT, 1) * Math.PI);
        if (blinkT >= 1) blinkT = -1;
      }
      const closure = Math.max(blinkEnv, 0.8 * cough);

      // the eyes track whatever is flying at them
      if (look) {
        lookDir.copy(look).sub(eyes[0].group.position).normalize();
        const ty = clamp(Math.atan2(lookDir.x, lookDir.z), -0.42, 0.42);
        const tp = clamp(-Math.asin(clamp(lookDir.y, -1, 1)) + 0.05, -0.3, 0.24);
        const k = 1 - Math.exp(-dt * 9);
        yaw += (ty - yaw) * k;
        pitch += (tp - pitch) * k;
      }
      for (const e of eyes) {
        e.eye.rotation.set(pitch, yaw, 0);
        e.upper.rotation.x = 0.35 + 1.05 * closure;
        e.lower.rotation.x = -0.3 - 0.28 * closure;
      }
    },
  };
}
