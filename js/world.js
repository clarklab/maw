// MAW — the world beyond the lips. A terrace over the Adriatic: white
// tablecloth in the foreground, sun glitter on the sea, hazy islands, a
// terracotta town stacked on the far shore. Seen almost entirely through
// a chewing mouth, so it's built to read photographically at a distance:
// haze, glare, and warm light over geometry.

import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ----------------------------------------------------------------- sky dome

function buildSky() {
  const cv = canvas(64, 512);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#1e4d8f');   // zenith
  g.addColorStop(0.35, '#4a7ec0');
  g.addColorStop(0.52, '#8fb6dd');
  g.addColorStop(0.62, '#cfe0e9');  // horizon haze
  g.addColorStop(0.70, '#e8e3d4');  // warm band over the sea
  g.addColorStop(1.0, '#b8c9d2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  return sky;
}

// --------------------------------------------------------------------- sea

const SEA_VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SEA_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uCamPos;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHaze;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;

    // layered moving normal perturbation
    float n = 0.0;
    n += noise(p * 0.08 + vec2(t * 0.18, t * 0.07)) * 0.6;
    n += noise(p * 0.23 - vec2(t * 0.11, t * 0.21)) * 0.3;
    n += noise(p * 0.71 + vec2(t * 0.34, -t * 0.18)) * 0.15;
    float nx = noise(p * 0.31 + vec2(t * 0.2, 0.0)) - 0.5;
    float nz = noise(p * 0.31 + vec2(0.0, t * 0.17)) - 0.5;
    vec3 N = normalize(vec3(nx * 0.55, 1.0, nz * 0.55));

    vec3 V = normalize(uCamPos - vWorld);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    // base water: deep blue, greener in the "shallows" noise patches
    vec3 base = mix(uDeep, uShallow, n * 0.35);
    // sky reflection via fresnel
    base = mix(base, uHaze * 1.06, fres * 0.75);

    // sun glitter path
    vec3 H = normalize(V + normalize(uSunDir));
    float spec = pow(max(dot(N, H), 0.0), 240.0);
    float sparkle = step(0.86, noise(p * 2.3 + t * 0.5));
    base += vec3(1.0, 0.93, 0.78) * spec * (1.4 + sparkle * 2.6);

    // distance haze toward the horizon
    float d = length(uCamPos - vWorld);
    base = mix(base, uHaze, smoothstep(60.0, 330.0, d));

    gl_FragColor = vec4(base, 1.0);
  }
`;

function buildSea(sunDir) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uCamPos: { value: new THREE.Vector3() },
      uDeep: { value: new THREE.Color(0x0e3a5c) },
      uShallow: { value: new THREE.Color(0x1d6b76) },
      uHaze: { value: new THREE.Color(0xcfe0e9) },
    },
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(800, 700), mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -6.5, 180);
  return sea;
}

// ----------------------------------------------------------------- terrain

// A soft ridge of island, displaced and hazed by distance fog.
function buildIsland(rng, w, h, d) {
  const geo = new THREE.PlaneGeometry(w, h, 42, 10);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / w + 0.5;
    const y = pos.getY(i) / h + 0.5;
    const ridge =
      Math.sin(x * Math.PI) ** 1.4 *
      (0.55 + 0.45 * Math.sin(x * 19 + rng() * 9) * Math.sin(x * 7.3 + rng() * 5));
    pos.setZ(i, 0);
    pos.setY(i, (y - 0.08) * h * Math.max(0.06, ridge) - h * 0.45);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0x47564a });
  const m = new THREE.Mesh(geo, mat);
  m.position.z = d;
  return m;
}

// ------------------------------------------------------------------- town

// Distant Dalmatian town: stacked stone houses, terracotta roofs, campanile.
function buildTown(rng) {
  const group = new THREE.Group();
  const wallColors = [0xd9cdb4, 0xcfc0a4, 0xe2d6bd, 0xc8b89a];
  const roofColors = [0xa65a3a, 0x96492c, 0xb06844, 0x8e4226];

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.82, 0.5, 4);

  for (let i = 0; i < 60; i++) {
    const w = 2.5 + rng() * 4, hgt = 2.5 + rng() * 6, dpt = 2.5 + rng() * 3;
    const x = 36 + rng() * 55 + (rng() - 0.5) * 8;
    const z = 95 + rng() * 50;
    const y = -6 + rng() * 9 * (1 - (x - 36) / 70); // stacked up the hill

    const house = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({
      color: wallColors[(rng() * wallColors.length) | 0],
    }));
    house.scale.set(w, hgt, dpt);
    house.position.set(x, y + hgt / 2, z);
    group.add(house);

    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({
      color: roofColors[(rng() * roofColors.length) | 0],
    }));
    roof.scale.set(w * 0.78, 1.6 + rng(), dpt * 0.78);
    roof.position.set(x, y + hgt + 0.7, z);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
  }

  // campanile — the bell tower every Dalmatian town has
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xe5dac0 });
  const tower = new THREE.Mesh(wallGeo, towerMat);
  tower.scale.set(3.2, 17, 3.2);
  tower.position.set(58, 4.5, 112);
  group.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.5, 4), new THREE.MeshLambertMaterial({ color: 0x8e4226 }));
  spire.position.set(58, 15.4, 112);
  spire.rotation.y = Math.PI / 4;
  group.add(spire);

  return group;
}

// ----------------------------------------------------------------- terrace

// The dinner table right outside the lips: linen, a plate, a glass of wine.
// Food that escapes the mouth lands here, to everyone's horror.
function buildTable() {
  const group = new THREE.Group();

  const linen = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 22, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xf1ebdd, roughness: 0.9 })
  );
  // soft cloth undulation
  const lp = linen.geometry.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    lp.setZ(i, 0.12 * Math.sin(lp.getX(i) * 0.8) * Math.sin(lp.getY(i) * 0.7));
  }
  linen.geometry.computeVertexNormals();
  linen.rotation.x = -Math.PI / 2;
  linen.position.set(0, -5.2, 16);
  linen.receiveShadow = true;
  group.add(linen);

  // plate
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 2.6, 0.35, 36),
    new THREE.MeshStandardMaterial({ color: 0xfaf7f0, roughness: 0.25, metalness: 0.02 })
  );
  plate.position.set(-2.5, -5.0, 13.5);
  group.add(plate);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(3.1, 0.16, 10, 40),
    new THREE.MeshStandardMaterial({ color: 0x4a6c8c, roughness: 0.3 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-2.5, -4.82, 13.5);
  group.add(rim);

  // wine glass (cheated transparency — no transmission on mobile)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.16,
    roughness: 0.05, clearcoat: 1, envMapIntensity: 2,
    depthWrite: false,
  });
  const wineMat = new THREE.MeshStandardMaterial({ color: 0x5c0f1e, roughness: 0.1 });
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), glassMat);
  bowl.rotation.x = Math.PI;
  bowl.position.set(4.6, -3.0, 14.5);
  const wine = new THREE.Mesh(new THREE.SphereGeometry(0.92, 16, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.3), wineMat);
  wine.rotation.x = Math.PI;
  wine.position.copy(bowl.position);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.9, 8), glassMat);
  stem.position.set(4.6, -4.2, 14.5);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.08, 16), glassMat);
  foot.position.set(4.6, -5.1, 14.5);
  group.add(bowl, wine, stem, foot);

  return group;
}

// ------------------------------------------------------------------- gulls

function buildGulls() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a4148, side: THREE.DoubleSide, fog: false });
  const gulls = [];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.PlaneGeometry(1.6, 0.34, 4, 1);
    const gull = new THREE.Mesh(geo, mat);
    const r = 60 + Math.random() * 70;
    gulls.push({
      mesh: gull,
      r,
      a: Math.random() * Math.PI * 2,
      speed: 0.06 + Math.random() * 0.05,
      y: 16 + Math.random() * 22,
      flap: Math.random() * 10,
    });
    group.add(gull);
  }
  return { group, gulls };
}

// ------------------------------------------------------------- buildWorld

export function buildWorld(scene, sunDir) {
  let seed = 977;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  scene.fog = new THREE.Fog(0xcfe0e9, 60, 380);

  const group = new THREE.Group();
  scene.add(group);

  group.add(buildSky());

  const sea = buildSea(sunDir);
  group.add(sea);

  // sun disc — bright enough to bloom
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(14, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff4d8, fog: false })
  );
  sun.material.color.multiplyScalar(1);
  sun.position.copy(sunDir).multiplyScalar(380);
  sun.lookAt(0, 0, 0);
  group.add(sun);

  // halo
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(34, 32),
    new THREE.MeshBasicMaterial({ color: 0xfdf0d2, transparent: true, opacity: 0.35, fog: false })
  );
  halo.position.copy(sunDir).multiplyScalar(376);
  halo.lookAt(0, 0, 0);
  group.add(halo);

  group.add(buildIsland(rng, 240, 26, 300).translateX(-90));
  group.add(buildIsland(rng, 170, 16, 250).translateX(60));
  const island3 = buildIsland(rng, 130, 10, 210);
  island3.translateX(-30);
  group.add(island3);

  group.add(buildTown(rng));
  group.add(buildTable());

  const { group: gullGroup, gulls } = buildGulls();
  group.add(gullGroup);

  // a slow white boat
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1, 1.6), new THREE.MeshLambertMaterial({ color: 0xf2efe6 }));
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.1), new THREE.MeshLambertMaterial({ color: 0xdcd5c2 }));
  cabin.position.y = 0.8;
  boat.add(hull, cabin);
  boat.position.set(-40, -6, 140);
  group.add(boat);

  let time = 0;
  return {
    group,
    update(dt, cameraPos) {
      time += dt;
      sea.material.uniforms.uTime.value = time;
      sea.material.uniforms.uCamPos.value.copy(cameraPos);
      boat.position.x += dt * 0.7;
      if (boat.position.x > 90) boat.position.x = -90;
      boat.position.y = -6 + Math.sin(time * 0.8) * 0.12;
      boat.rotation.z = Math.sin(time * 0.7) * 0.02;
      for (const g of gulls) {
        g.a += dt * g.speed;
        g.mesh.position.set(Math.cos(g.a) * g.r, g.y + Math.sin(g.a * 3) * 2, 130 + Math.sin(g.a) * g.r * 0.5);
        // wing flap — fold the plane's outer edges
        const flap = Math.sin(time * 7 + g.flap) * 0.5;
        g.mesh.rotation.set(0.3, g.a + Math.PI / 2, flap * 0.4);
      }
    },
  };
}
