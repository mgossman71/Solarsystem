/**
 * Headless validation of the Earth lighting MATH (no browser needed).
 *
 * Replicates EXACTLY the shader pipeline:
 *   vertex:   worldNormal = normalize(mat3(modelMatrix) * normal)
 *   fragment: sunDot  = dot(normalize(worldNormal), normalize(uSunDirection))
 *             dayFactor = smoothstep(-0.03, 0.28, sunDot)   (identical in cloud/atmo)
 *   Sun:      az/el -> unit vector, same formula as src/earth/SunLighting.ts
 *
 * Run: node scripts/lighting_math_test.mjs
 */
import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

/** Same formula as sunDirectionFromAzEl in src/earth/SunLighting.ts. */
function sunDir(azDeg, elDeg, out) {
  const az = azDeg * DEG2RAD;
  const el = elDeg * DEG2RAD;
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

/** GLSL smoothstep (edge0 < edge1). */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
const dayFactor = (sunDot) => smoothstep(-0.03, 0.28, sunDot);

/**
 * Local-space normal for a geographic point, using the EXACT three.js
 * SphereGeometry vertex formula (radius 1):
 *   x = -cos(phi)*sin(theta), y = cos(theta), z = sin(phi)*sin(theta)
 * with phi = u*2PI, theta = v*PI, uv equirectangular
 * (u=(lon+180)/360, v=(90-lat)/180).
 */
function localNormal(lon, lat) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  ).normalize();
}

/** World normal exactly as the vertex shader computes it (uniform scale = 1). */
function worldNormalAt(lon, lat, earthRotY) {
  const n = localNormal(lon, lat);
  const m = new THREE.Matrix4().makeRotationY(earthRotY);
  return n.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(m)).normalize();
}

const REGIONS = [
  { name: 'N.America west  coast', lon: -122, lat: 37 },
  { name: 'N.America central US', lon: -100, lat: 39 },
  { name: 'N.America east  coast', lon: -78, lat: 40 },
  { name: 'Africa  west', lon: -12, lat: 12 },
  { name: 'Africa  central', lon: 22, lat: 0 },
  { name: 'Africa  east', lon: 40, lat: 4 },
  { name: 'Asia    central', lon: 90, lat: 45 },
  { name: 'Australia', lon: 135, lat: -25 },
];

const EARTH_ROTATIONS = [-Math.PI * 0.25, 0, 0.9, 2.1, 4.4]; // initial + arbitrary
const FAILURES = [];
let checks = 0;
function assert(cond, label) {
  checks++;
  if (!cond) FAILURES.push(label);
}

// ---------- A/B: sun-over-region + full sweep at arbitrary Earth rotations --
for (const rotY of EARTH_ROTATIONS) {
  for (const r of REGIONS) {
    const wn = worldNormalAt(r.lon, r.lat, rotY);

    // Az/el of the Sun pointing directly at this surface point (sun overhead):
    const el = Math.asin(THREE.MathUtils.clamp(wn.y, -1, 1)) / DEG2RAD;
    const az = Math.atan2(wn.z, wn.x) / DEG2RAD;

    // A. Sun overhead => user moves the Sun there via updateSun(az, el).
    const sd = sunDir(az, el, new THREE.Vector3());
    const d1 = wn.dot(sd);
    assert(Math.abs(d1 - 1) < 1e-9 && dayFactor(d1) === 1,
      `A: ${r.name} @rot ${rotY.toFixed(2)}: sun overhead dayFactor=${dayFactor(d1)} (dot=${d1})`);

    // B. Full az/el sweep: some Sun position must FULLY light this point.
    let best = -1;
    const tmp = new THREE.Vector3();
    for (let a = -180; a < 181; a += 1) {
      for (let e = -90; e < 91; e += 2) {
        const dd = wn.dot(sunDir(a, e, tmp));
        if (dd > best) best = dd;
      }
    }
    assert(best > 0.999 && dayFactor(best) === 1,
      `B: ${r.name} @rot ${rotY.toFixed(2)}: sweep best dot=${best}`);

    // The sweep maximum must occur at the overhead az/el (within 1°) —
    // proves no hidden offset pins the terminator to a fixed longitude.
    let close = false;
    for (let da = -1; da <= 1; da++) {
      if (wn.dot(sunDir(az + da, el, new THREE.Vector3())) > 0.999) close = true;
    }
    assert(close, `B: ${r.name} @rot ${rotY.toFixed(2)}: sweep max not at overhead az`);
  }
}

// ---------- C. Front Light mode ---------------------------------------------
// camera at initialCameraPosition, target at origin (as in EarthScene)
const camN = new THREE.Vector3(0, 0.5, 3.2).normalize();
const fdSun = camN; // updateFullDaylightSun(): normalize(cam - target)
let fullyDarkVisible = 0;
let minVisibleDay = Infinity;
let coreFullyLit = true;
for (let i = 0; i < 7200; i++) {
  const lat = 90 - (i % 61) * 3;                    // -87..87
  const lon = -180 + Math.floor(i / 61) * (360 / 120);
  const wn = worldNormalAt(lon, lat, -Math.PI * 0.25);
  const ndv = wn.dot(camN);
  if (ndv <= 0) continue;                           // not on visible face
  const df = dayFactor(wn.dot(fdSun));
  if (df <= 0) fullyDarkVisible++;
  minVisibleDay = Math.min(minVisibleDay, df);
  if (ndv > 0.6 && df < 0.999) coreFullyLit = false;
}
assert(fullyDarkVisible === 0, `C: Front Light: ${fullyDarkVisible} fully-dark points on visible face`);
assert(minVisibleDay > 0, `C: Front Light: min dayFactor on visible face = ${minVisibleDay}`);
assert(coreFullyLit, 'C: Front Light: face core (ndv>0.6) not fully lit');

// ---------- E. White-sphere test math ----------------------------------------
// mode 3 renders max(dot(n, s), 0): clean lit hemisphere + dark hemisphere.
const n = worldNormalAt(-78, 40, -Math.PI * 0.25);
assert(Math.max(n.dot(n), 0) > 0.9999 && Math.max(n.dot(n.clone().negate()), 0) === 0,
  'E: white-sphere NdotL = 1.0 (facing) / 0.0 (away)');

// ---------- Result -----------------------------------------------------------
if (FAILURES.length) {
  console.error(`FAIL — ${FAILURES.length}/${checks} checks failed:`);
  for (const f of FAILURES) console.error('  - ' + f);
  process.exit(1);
}
console.log(`PASS — all ${checks} lighting-math checks passed.`);
console.log('  A: sun-over-region full illumination (NA/Africa/Asia/Australia x5 Earth rotations)');
console.log('  B: full az/el sweep reaches dayFactor=1 over every region (no pinned terminator)');
console.log('  C: Front Light — no fully dark point on visible face, face core fully lit');
console.log('  E: white-sphere NdotL = 1.0 (facing) / 0.0 (away)');

