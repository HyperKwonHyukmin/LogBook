/**
 * 73 — 선박 지도 3D 장면.
 * 유리 같은 선체(가장자리만 빛나는 프레넬 셰이더 + 늑골 선) 안에 구역을 칸(격실)으로 넣고, 칸을 자료 건수 색으로 빛나게 한다.
 * 선체는 단면(바닥, 빌지 원호, 옆판)을 길이 방향으로 이어 만든다(L 280 × B 46 × D 26 m, 구상 선수, 올라간 선수 갑판, 트랜섬).
 * 칸의 범위는 lib/shipZones.COMPARTMENTS 한 곳. 고른 구역은 카메라가 다가가고 나머지는 흐려진다.
 * 그리기는 필요할 때만(조작, 전환 중, 자동 회전 중) — 가만히 있으면 돌지 않는다.
 * API: createShipScene({ canvas, overlay, onPick, onHover }) → { setCounts, select, setView, setAutoRotate, resize, dispose }
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COMPARTMENTS, FUNNEL, HOUSE, SHIP_ZONES, heatColor } from '../../lib/shipZones.js';

export const SHIP = { L: 280, B: 46, D: 26 };
const { L, B, D } = SHIP;
const HB = B / 2;
const RB = 5;                       // 빌지 반지름(m)
const STATIONS = 160;
const SKIN = 1.1;                   // 칸과 겉판 사이 틈(m)
const BACKGROUND = 0x0E1A2B;        // viewer
const EDGE = 0x9CC2F5;
const SELECT = 0x6BE8C1;            // brand-mint — 고른 구역 테두리
const FOV = 30;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── 선형 ────────────────────────────────────────────────────────────────
/** 갑판 높이 — 선수 쪽이 올라간다. */
const depthAt = (x) => D * (1 + 0.1 * smooth(0.9, 1, x));
/** 바닥 높이 — 선미 쪽만 올라간다. */
const keelAt = (x) => (x < 0.13 ? 0.48 * D * ((0.13 - x) / 0.13) ** 2 : 0);
/** 반폭 비율(1 = 평행부). 선수는 위로 갈수록 덜 좁아지고(플레어), 선미는 아래만 좁아져 트랜섬을 남긴다. zf = 그 단면 높이 비율. */
function breadth(x, zf) {
  let f = 1;
  if (x > 0.74) f *= 1 - clamp01((x - 0.74) / 0.26) ** (1.4 + 2 * zf);
  if (x < 0.24) {
    const t = clamp01((0.24 - x) / 0.24);
    f *= 1 - t ** 1.7 * (1 - 0.84 * smooth(0.3, 0.95, zf));
  }
  return Math.max(0, f);
}
/** 길이 방향 밀림(m) — 선수 위쪽은 앞으로 기울고, 아래쪽은 구상 선수로 내밀고, 선미 위쪽은 뒤로 나온다. */
function shiftAt(x, zf) {
  const nose = clamp01((x - 0.9) / 0.1) ** 2;
  const rake = 0.03 * L * smooth(0.3, 1, zf) * nose;
  const bulb = 0.02 * L * Math.exp(-(((zf - 0.26) / 0.16) ** 2)) * nose;
  const overhang = x < 0.05 ? -0.014 * L * smooth(0.45, 1, zf) * (1 - x / 0.05) : 0;
  return rake + bulb + overhang;
}
/** 기준 반단면(가운데 바닥 → 빌지 → 옆판 → 갑판 끝), 단위 m. */
const BASE_HALF = (() => {
  const pts = [];
  for (let i = 0; i <= 5; i += 1) pts.push([(HB - RB) * (i / 5), 0]);
  for (let i = 1; i <= 8; i += 1) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 8);
    pts.push([HB - RB + RB * Math.cos(a), RB + RB * Math.sin(a)]);
  }
  for (let i = 1; i <= 10; i += 1) pts.push([HB, RB + (D - RB) * (i / 10)]);
  return pts;
})();
/** 그 자리(x)의 반단면: [{ y, z, zf }] 바닥 가운데 → 갑판 끝. */
function stationHalf(x) {
  const zk = keelAt(x); const dx = depthAt(x);
  return BASE_HALF.map(([y0, z0]) => {
    const z = zk + (z0 * (dx - zk)) / D;
    const zf = z / dx;
    return { y: y0 * breadth(x, zf), z, zf };
  });
}
/** 반단면에서 높이 z 의 반폭. */
function widthAt(half, z) {
  if (z <= half[0].z) { let y = 0; for (const p of half) { if (p.z - half[0].z < 1e-6) y = p.y; } return y; }
  for (let k = 0; k < half.length - 1; k += 1) {
    const a = half[k]; const b = half[k + 1];
    if (b.z > a.z && z >= a.z && z <= b.z) return a.y + ((b.y - a.y) * (z - a.z)) / (b.z - a.z);
  }
  return half[half.length - 1].y;
}

function geometryFrom(positions, normals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}
const creased = (positions, angle = Math.PI / 5) => { const g = toCreasedNormals(geometryFrom(positions), angle); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };
const pushTri = (out, a, b, c) => out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
const pushQuad = (out, a, b, c, d) => { pushTri(out, a, b, c); pushTri(out, a, c, d); };
function pushBox(out, x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  out.push(...g.attributes.position.array);
  g.dispose();
}

/** 겉판(유리) — 선체 옆과 바닥, 트랜섬. 법선은 격자에서 바로 구해 매끈하게. 갑판 끝과 용골 선도 같이 돌려준다. */
function buildShell() {
  const P = [];
  for (let i = 0; i <= STATIONS; i += 1) {
    const x = i / STATIONS;
    const half = stationHalf(x);
    const pt = (p, s) => new THREE.Vector3(x * L + shiftAt(x, p.zf), s * p.y, p.z);
    P.push([...half.slice(1).reverse().map((p) => pt(p, 1)), ...half.map((p) => pt(p, -1))]);
  }
  const ni = P.length; const nj = P[0].length; const mid = BASE_HALF.length - 1;
  const at = (i, j) => P[Math.max(0, Math.min(ni - 1, i))][Math.max(0, Math.min(nj - 1, j))];
  const N = P.map((row, i) => row.map((p, j) => {
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(at(i + 1, j), at(i - 1, j)), new THREE.Vector3().subVectors(at(i, j + 1), at(i, j - 1)));
    if (n.lengthSq() < 1e-12) n.set(p.x > L / 2 ? 1 : -1, 0, 0);
    n.normalize();
    if (n.dot(new THREE.Vector3(0, p.y, p.z - D * 0.55)) < 0 && Math.abs(p.y) > 0.01) n.negate();
    return n;
  }));
  const pos = []; const nor = [];
  const v = (i, j) => { const p = P[i][j]; const n = N[i][j]; pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); };
  for (let i = 0; i < ni - 1; i += 1) {
    for (let j = 0; j < nj - 1; j += 1) { v(i, j); v(i + 1, j); v(i + 1, j + 1); v(i, j); v(i + 1, j + 1); v(i, j + 1); }
  }
  for (let k = 0; k < mid; k += 1) {   // 트랜섬
    for (const p of [P[0][mid - k], P[0][mid + k], P[0][mid + k + 1], P[0][mid - k], P[0][mid + k + 1], P[0][mid - k - 1]]) {
      pos.push(p.x, p.y, p.z); nor.push(-1, 0, 0);
    }
  }
  // 갑판 판(상갑판 구역) — 겉판보다 조금 안쪽
  const deck = [];
  const inset = (p) => new THREE.Vector3(p.x, p.y * 0.985, p.z + 0.05);
  for (let i = 0; i < ni - 1; i += 1) pushQuad(deck, inset(P[i][0]), inset(P[i][nj - 1]), inset(P[i + 1][nj - 1]), inset(P[i + 1][0]));
  // 윤곽선: 갑판 끝 양쪽, 용골, 트랜섬 둘레, 흘수선
  const seg = [];
  const poly = (pts) => { for (let k = 0; k < pts.length - 1; k += 1) seg.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z); };
  poly(P.map((r) => r[0])); poly(P.map((r) => r[nj - 1])); poly(P.map((r) => r[mid])); poly(P[0]);
  const water = [];
  const draft = D * 0.6;
  for (const s of [1, -1]) {
    const line = [];
    for (let i = 0; i <= STATIONS; i += 1) {
      const x = i / STATIONS; const half = stationHalf(x);
      if (keelAt(x) > draft) continue;
      line.push(new THREE.Vector3(x * L + shiftAt(x, draft / depthAt(x)), s * widthAt(half, draft), draft));
    }
    for (let k = 0; k < line.length - 1; k += 1) water.push(line[k].x, line[k].y, line[k].z, line[k + 1].x, line[k + 1].y, line[k + 1].z);
  }
  const shell = geometryFrom(pos, nor); shell.computeBoundingSphere();
  return { shell, deck: creased(deck, Math.PI / 3), outline: geometryFrom(seg), water: geometryFrom(water) };
}

/** 선체 안의 칸 하나 — 그 범위의 단면을 겉판에서 조금 들여 이어 만든 덩어리(양 끝은 격벽). */
function buildCompartment({ x: [x0, x1], z: [z0, z1] }) {
  const n = Math.max(3, Math.round((x1 - x0) * 110));
  const K = 9;
  const rings = [];
  for (let i = 0; i <= n; i += 1) {
    const x = x0 + ((x1 - x0) * i) / n;
    const half = stationHalf(x); const dx = depthAt(x); const zk = keelAt(x);
    const za = Math.max(z0 * D, zk) + SKIN * 0.7;
    const zb = Math.max(za + 0.3, (z1 >= 1 ? dx : z1 * D) - SKIN * 0.7);
    const side = [];
    for (let k = 0; k <= K; k += 1) {
      const z = za + ((zb - za) * k) / K;
      side.push(new THREE.Vector3(x * L + shiftAt(x, z / dx), -Math.max(0.06, widthAt(half, z) - SKIN), z));
    }
    rings.push([...side, ...side.slice().reverse().map((p) => new THREE.Vector3(p.x, -p.y, p.z))]);
  }
  const out = []; const M = rings[0].length;
  for (let i = 0; i < n; i += 1) {
    for (let m = 0; m < M; m += 1) pushQuad(out, rings[i][m], rings[i + 1][m], rings[i + 1][(m + 1) % M], rings[i][(m + 1) % M]);
  }
  const cap = (ring, flip) => {
    for (let k = 0; k < K; k += 1) {
      const q = [ring[k], ring[k + 1], ring[M - 2 - k], ring[M - 1 - k]];
      if (flip) q.reverse();
      pushQuad(out, ...q);
    }
  };
  cap(rings[0], false); cap(rings[n], true);
  return creased(out);
}

function buildHouse() {
  const out = [];
  const x0 = HOUSE.x[0] * L; const x1 = HOUSE.x[1] * L; const w = HOUSE.halfWidth * HB;
  pushBox(out, x0, x1, -w, w, D + 0.1, D + 11);
  pushBox(out, x0 + 0.01 * L, x1 - 0.004 * L, -w * 0.82, w * 0.82, D + 11, D + 15.4);
  pushBox(out, x1 - 0.042 * L, x1, -HB * 1.02, HB * 1.02, D + 15.4, D + 18.2);   // 선교와 날개
  pushBox(out, x1 - 0.036 * L, x1 - 0.008 * L, -w * 0.5, w * 0.5, D + 18.2, D + 19.2);
  return creased(out, Math.PI / 6);
}

/** 구역이 아닌 부분(그림만): 연돌, 마스트, 갑판 위 통로와 매니폴드, 크레인 기둥, 타와 프로펠러. */
function buildDetails() {
  const out = [];
  const fx0 = FUNNEL.x[0] * L; const fx1 = FUNNEL.x[1] * L; const fw = FUNNEL.halfWidth * HB;
  pushBox(out, fx0, fx1, -fw, fw, D, D + 19);
  pushBox(out, fx0 - 0.4, fx1 + 0.4, -fw - 0.4, fw + 0.4, D + 19, D + 21.3);
  pushBox(out, HOUSE.x[1] * L - 6.4, HOUSE.x[1] * L - 5.6, -0.4, 0.4, D + 19.2, D + 27);     // 레이더 마스트
  pushBox(out, HOUSE.x[1] * L - 7.6, HOUSE.x[1] * L - 4.4, -3.2, 3.2, D + 24.4, D + 24.8);
  const bowDeck = depthAt(0.955);
  pushBox(out, 0.955 * L - 0.4, 0.955 * L + 0.4, -0.4, 0.4, bowDeck, bowDeck + 13);            // 선수 마스트
  pushBox(out, 0.255 * L, 0.865 * L, -1.1, 1.1, D + 2.4, D + 2.9);                             // 갑판 가운데 통로
  for (let i = 0; i <= 10; i += 1) { const x = (0.255 + 0.061 * i) * L; pushBox(out, x - 0.25, x + 0.25, -0.25, 0.25, D, D + 2.4); }
  for (const x of [0.535, 0.55, 0.565]) pushBox(out, x * L - 0.5, x * L + 0.5, -HB * 0.96, HB * 0.96, D + 1.2, D + 2.2);   // 매니폴드
  for (const [x, s] of [[0.5, 1], [0.6, -1]]) {                                              // 크레인 기둥과 팔
    pushBox(out, x * L - 0.8, x * L + 0.8, s * 7 - 0.8, s * 7 + 0.8, D, D + 12);
    pushBox(out, x * L - 0.5, x * L + 12, s * 7 - 0.4, s * 7 + 0.4, D + 11, D + 11.8);
  }
  pushBox(out, 0.006 * L, 0.03 * L, -0.45, 0.45, D * 0.05, D * 0.5);                            // 타
  const prop = new THREE.CylinderGeometry(4.2, 4.2, 0.5, 24).toNonIndexed();
  prop.rotateZ(Math.PI / 2); prop.translate(0.04 * L, 0, D * 0.2);
  out.push(...prop.attributes.position.array); prop.dispose();
  const hub = new THREE.CylinderGeometry(0.9, 0.5, 3, 12).toNonIndexed();
  hub.rotateZ(Math.PI / 2); hub.translate(0.046 * L, 0, D * 0.2);
  out.push(...hub.attributes.position.array); hub.dispose();
  return creased(out, Math.PI / 6);
}

/** 유리 겉판 — 정면은 거의 투명, 비스듬한 곳(윤곽)만 밝게. 늑골 자리에 가는 선. */
function shellMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(0x3D5F92) }, uRim: { value: new THREE.Color(0xB9D6FF) },
      uFade: { value: 1 }, uFrame: { value: 7 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uRim; uniform float uFade; uniform float uFrame;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float fx = vP.x / uFrame;
        float frame = 1.0 - smoothstep(0.0, 1.4, abs(fract(fx - 0.5) - 0.5) / max(fwidth(fx), 1e-5));
        float alpha = (0.045 + fres * 0.6 + frame * 0.085) * uFade;
        gl_FragColor = vec4(mix(uColor, uRim, fres), alpha);
        #include <colorspace_fragment>
      }`,
  });
}

/** 바닥 격자 — 20 m 칸, 100 m 마다 굵은 선. 가운데서 멀어질수록 사라진다. */
function floorMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0x4A6A97) } },
    vertexShader: `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; varying vec2 vP;
      float grid(vec2 p, float cell) {
        vec2 g = abs(fract(p / cell - 0.5) - 0.5) / max(fwidth(p / cell), vec2(1e-5));
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float fade = 1.0 - smoothstep(0.12, 0.5, length(vP) / ${(L * 7).toFixed(1)});
        float a = (grid(vP, 20.0) * 0.16 + grid(vP, 100.0) * 0.22) * fade;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(74,122,196,0.42)'); grad.addColorStop(0.55, 'rgba(46,80,127,0.16)'); grad.addColorStop(1, 'rgba(14,26,43,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VIEWS = { iso: [0.46, -1, 0.46], side: [0, -1, 0.03], top: [0, -0.03, 1], bow: [0.92, -0.72, 0.34] };
// 이름표가 칸에서 떨어져 앉는 자리(화면 px) — 이음선으로 잇는다
const LABEL_OFFSET = {
  선미부: [-78, 44], 기관실: [-30, 96], 거주구: [-52, -66], 상갑판: [48, -84], 화물창: [8, 108], 이중저: [132, 92], 선수부: [72, 46],
};
const LABEL_BASE = 'pointer-events-auto inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-meta font-medium transition-colors duration-150 ease-out';

export function createShipScene({ canvas, overlay, onPick, onHover }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });   // WebGL 이 없으면 여기서 던진다(화면이 잡는다)
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));   // 번짐 후처리가 있어 1.5 배까지만
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 2, L * 30);
  camera.up.set(0, 0, 1);
  const HOME = new THREE.Vector3(L * 0.5, 0, D * 0.6);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.target.copy(HOME);
  controls.minDistance = L * 0.2;
  controls.maxDistance = L * 4;
  controls.autoRotateSpeed = 0.7;

  scene.add(new THREE.HemisphereLight(0xCFE2FF, 0x0B1626, 1.1));
  const sun = new THREE.DirectionalLight(0xFFFFFF, 1.5);
  sun.position.set(L * 0.3, -L * 0.8, L * 1.1);
  scene.add(sun);
  const back = new THREE.DirectionalLight(0x8FB4F0, 0.6);
  back.position.set(L * 1.1, L * 0.7, L * 0.2);
  scene.add(back);

  // 바닥: 배에서 멀어질수록 어둠에 잠기는 격자(선 굵기는 화면 기준이라 멀리서도 자글거리지 않는다) + 배 아래 은은한 빛
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L * 7, L * 7), floorMaterial());
  floor.position.set(L * 0.5, 0, -7);
  scene.add(floor);
  const glowMap = glowTexture();
  if (glowMap) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.9, B * 6.5),
      new THREE.MeshBasicMaterial({ map: glowMap, transparent: true, depthWrite: false, fog: false }));
    pool.position.set(L * 0.5, 0, -6.9);
    scene.add(pool);
  }

  // 선체와 칸
  const built = buildShell();
  const shellMat = shellMaterial();
  const shell = new THREE.Mesh(built.shell, shellMat);
  shell.renderOrder = 3;
  scene.add(shell);
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xA9C8F5, transparent: true, opacity: 0.75, fog: false });
  scene.add(new THREE.LineSegments(built.outline, outlineMat));
  const waterMat = new THREE.LineBasicMaterial({ color: 0x6BE8C1, transparent: true, opacity: 0.28, fog: false });
  scene.add(new THREE.LineSegments(built.water, waterMat));
  const detailMat = new THREE.MeshStandardMaterial({ color: 0x7C9CCB, emissive: 0x1B3E6E, emissiveIntensity: 0.6, roughness: 0.6,
    transparent: true, opacity: 0.5, fog: false });
  const details = new THREE.Mesh(buildDetails(), detailMat);
  details.renderOrder = 1;
  scene.add(details);

  /** 구역 → { meshes, edges, box, anchor, cur, to } */
  const zones = {};
  const pickables = [];
  const addPart = (name, geometry, deck = false) => {
    const z = zones[name] || (zones[name] = { meshes: [], edges: [], box: new THREE.Box3(), deck });
    const mat = new THREE.MeshStandardMaterial({ color: 0x2F5288, emissive: 0x2F5288, emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.08,
      transparent: true, opacity: 1, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.userData.zone = name;
    mesh.renderOrder = deck ? 2 : 0;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, deck ? 60 : 32),
      new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.5, fog: false }));
    scene.add(mesh, edge);
    z.meshes.push(mesh); z.edges.push(edge); pickables.push(mesh);
    geometry.computeBoundingBox();
    z.box.union(geometry.boundingBox);
  };
  for (const c of COMPARTMENTS) addPart(c.zone, buildCompartment(c));
  addPart('상갑판', built.deck, true);
  addPart('거주구', buildHouse());
  for (const z of SHIP_ZONES) {
    const zone = zones[z.name];
    zone.inside = z.inside;
    zone.center = zone.box.getCenter(new THREE.Vector3());
    zone.anchor = zone.center.clone();
    if (z.name === '상갑판') zone.anchor.set(L * 0.66, -HB * 0.5, D + 0.2);
    else if (z.name === '거주구') zone.anchor.z = zone.box.max.z - 2;
    else zone.anchor.y = -HB * 0.55;      // 보는 쪽(우현)으로 당겨 이음선이 칸 겉에서 시작하게
    zone.cur = { op: 0, glow: 0, edge: 0 };
    zone.to = { op: 0, glow: 0, edge: 0 };
  }
  const global = { cur: { shell: 1, detail: 0.5 }, to: { shell: 1, detail: 0.5 } };

  // 이름표(HTML)와 이음선(SVG)
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
  svg.setAttribute('aria-hidden', 'true');
  overlay?.appendChild(svg);
  const labels = {};
  let counts = {}; let max = 0; let selected = null; let hover = null;
  for (const z of SHIP_ZONES) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('stroke', '#8A9DB8'); line.setAttribute('stroke-width', '1');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '2.5'); dot.setAttribute('fill', '#DCEEFF');
    svg.append(line, dot);
    const el = document.createElement('button');
    el.type = 'button';
    Object.assign(el.style, { position: 'absolute', left: '0px', top: '0px', whiteSpace: 'nowrap' });   // 자리 잡기는 스타일 묶음에 기대지 않는다
    const sw = document.createElement('span'); sw.setAttribute('aria-hidden', 'true');
    sw.className = 'inline-block h-2.5 w-2.5 rounded-[3px]';
    const name = document.createElement('span'); name.textContent = z.name;
    const num = document.createElement('span'); num.className = 'font-mono font-medium';
    el.append(sw, name, num);
    el.addEventListener('click', () => onPick?.(z.name));
    el.addEventListener('pointerenter', () => setHover(z.name));
    el.addEventListener('pointerleave', () => { if (hover === z.name) setHover(null); });
    el.addEventListener('focus', () => setHover(z.name));
    el.addEventListener('blur', () => { if (hover === z.name) setHover(null); });
    overlay?.appendChild(el);
    labels[z.name] = { el, sw, num, line, dot };
  }

  // 후처리(은은한 번짐) — 만들지 못하면 그냥 그린다
  let composer = null; let bloom = null;
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.55, 0.72);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch { composer = null; }

  // ── 그리기와 전환 ───────────────────────────────────────────────────
  const v = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    for (const z of SHIP_ZONES) {
      const { el, line, dot } = labels[z.name];
      v.copy(zones[z.name].anchor).project(camera);
      const ax = ((v.x + 1) / 2) * w; const ay = ((1 - v.y) / 2) * h;
      const [dx, dy] = LABEL_OFFSET[z.name];
      const lx = Math.max(48, Math.min(w - 48, ax + dx)); const ly = Math.max(18, Math.min(h - 18, ay + dy));
      const visible = v.z < 1 && ax > -40 && ax < w + 40 && ay > -40 && ay < h + 40;
      el.style.display = visible ? '' : 'none';
      line.style.display = visible ? '' : 'none'; dot.style.display = visible ? '' : 'none';
      el.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%)`;
      line.setAttribute('x1', ax); line.setAttribute('y1', ay); line.setAttribute('x2', lx); line.setAttribute('y2', ly);
      dot.setAttribute('cx', ax); dot.setAttribute('cy', ay);
    }
  }
  function applyStyle() {
    for (const z of SHIP_ZONES) {
      const zone = zones[z.name];
      for (const m of zone.meshes) {
        m.material.opacity = zone.cur.op;
        m.material.depthWrite = zone.cur.op > 0.9;
        m.material.emissiveIntensity = zone.cur.glow;
      }
      for (const e of zone.edges) e.material.opacity = zone.cur.edge;
    }
    shellMat.uniforms.uFade.value = global.cur.shell;
    detailMat.opacity = global.cur.detail;
    outlineMat.opacity = 0.35 + 0.4 * global.cur.shell;
  }
  function draw() {
    applyStyle();
    if (composer) composer.render(); else renderer.render(scene, camera);
    placeLabels();
  }
  const anims = new Map();
  let frame = 0; let autoRotate = false;
  function tick(now) {
    frame = 0;
    let active = false;
    for (const [key, a] of anims) {
      const t = Math.min(1, (now - a.t0) / a.dur);
      a.apply(t >= 1 ? 1 : 1 - 2 ** (-9 * t));
      if (t >= 1) anims.delete(key); else active = true;
    }
    if (autoRotate) { controls.update(); active = true; }
    draw();
    if (active) frame = requestAnimationFrame(tick);
  }
  const requestDraw = () => { if (!frame) frame = requestAnimationFrame(tick); };
  function animate(key, dur, apply) {
    if (reducedMotion() || dur <= 0) { anims.delete(key); apply(1); requestDraw(); return; }
    anims.set(key, { t0: performance.now(), dur, apply });
    requestDraw();
  }

  /** 지금 상태(건수, 고른 구역, 올린 구역)에서 칸마다 가야 할 모습. */
  function restyle(dur = 320) {
    for (const z of SHIP_ZONES) {
      const zone = zones[z.name];
      const n = counts[z.name] || 0;
      const isSel = z.name === selected; const dim = !!selected && !isSel; const isHover = z.name === hover;
      const color = heatColor(n, max);
      for (const m of zone.meshes) { m.material.color.set(color); m.material.emissive.set(color); }
      for (const e of zone.edges) e.material.color.set(isSel ? SELECT : EDGE);
      let op = n ? (zone.deck ? 0.3 : 1) : 0.05;
      if (isSel) op = n ? (zone.deck ? 0.85 : 1) : 0.22;
      else if (dim) op *= zone.deck ? 0.2 : 0.14;
      zone.to.op = op;
      zone.to.glow = (n ? (zone.deck ? 0.22 : 0.36) : 0.1) + (isSel ? 0.1 : 0) + (isHover ? 0.16 : 0);
      zone.to.edge = isSel ? 1 : dim ? 0.14 : isHover ? 0.95 : n ? 0.5 : 0.42;
      zone.from = { ...zone.cur };
      const { el, sw, num } = labels[z.name];
      el.className = `${LABEL_BASE} ${isSel ? 'border-n-0 bg-n-0 text-navy-900'
        : `bg-navy-950/85 hover:border-on-navy-ring ${n ? 'border-navy-600 text-on-navy' : 'border-navy-700 text-on-navy-subtle'}`}`;
      el.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      el.setAttribute('aria-label', `${z.name}: 자료 ${n}건`);
      el.style.opacity = dim ? '0.55' : '1';
      sw.style.background = n ? color : 'transparent';
      sw.style.border = n ? 'none' : '1px dashed #8A9DB8';
      num.textContent = String(n);
    }
    const inside = selected && zones[selected]?.inside;
    global.to.shell = selected ? (inside ? 0.42 : 0.7) : 1;
    global.to.detail = selected ? 0.16 : 0.5;
    global.from = { ...global.cur };
    canvas.style.cursor = hover ? 'pointer' : '';
    const lerp = (a, b, t) => a + (b - a) * t;
    animate('style', dur, (t) => {
      for (const z of SHIP_ZONES) {
        const zone = zones[z.name];
        for (const k of ['op', 'glow', 'edge']) zone.cur[k] = lerp(zone.from[k], zone.to[k], t);
      }
      for (const k of ['shell', 'detail']) global.cur[k] = lerp(global.from[k], global.to[k], t);
    });
  }
  function setHover(name, point) {
    if (name === hover) { if (name) onHover?.(name, point || null); return; }
    hover = name;
    onHover?.(name, point || null);
    restyle(140);
  }

  // ── 카메라 ─────────────────────────────────────────────────────────
  let view = 'iso';
  const overviewDist = (id) => {
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const aspect = camera.aspect || 1;
    const halfW = L * 0.6; const halfH = id === 'top' ? B * 0.9 : D * 1.5;
    return Math.max(halfW / (t * aspect), halfH / t) * ({ iso: 1.22, bow: 1.0 }[id] || 1.16);
  };
  function flyTo(target, dir, dist, dur = 700) {
    const from = { target: controls.target.clone(), dir: camera.position.clone().sub(controls.target), dist: 0 };
    from.dist = from.dir.length(); from.dir.normalize();
    const to = { target: target.clone(), dir: (dir || from.dir).clone().normalize(), dist };
    const d = new THREE.Vector3();
    animate('camera', dur, (t) => {
      controls.target.lerpVectors(from.target, to.target, t);
      d.lerpVectors(from.dir, to.dir, t);
      if (d.lengthSq() < 1e-6) d.copy(to.dir);
      d.normalize();
      camera.position.copy(controls.target).addScaledVector(d, from.dist + (to.dist - from.dist) * t);
      camera.lookAt(controls.target);
      if (t >= 1) controls.update();
    });
  }
  /** 고른 구역이 있으면 그 칸으로 다가간 자리, 없으면 배 전체가 보이는 자리. dir 을 주면 그 방향에서 본다. */
  function focus(dir = null, dur = 700) {
    const zone = selected && zones[selected];
    if (!zone || zone.deck) { flyTo(HOME, dir, overviewDist(view), dur); return; }
    const size = zone.box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y * 1.6, size.z * 2.6);
    flyTo(zone.center, dir, Math.min(overviewDist(view), Math.max(L * 0.8, span * 1.5 + L * 0.5)), dur);
  }
  function setView(id = 'iso', dur = 700) {
    view = VIEWS[id] ? id : 'iso';
    focus(new THREE.Vector3(...VIEWS[view]), dur);
  }

  // 누르기(끌기와 구분 — 4px 안에서 떼면 고른다)와 올리기
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // 갑판 판은 얇게 비치는 덮개라, 그 아래 안쪽 칸이 같이 맞으면 안쪽 칸을 고른다(옆에서 볼 때). 위에서 곧장 내려다볼 때만 갑판
    const hits = ray.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const first = hits[0].object.userData.zone;
    if (first === '상갑판' && hits[1] && Math.abs(ray.ray.direction.z) < 0.5) return hits[1].object.userData.zone;
    return first;
  };
  let down = null;
  const onDown = (ev) => { down = [ev.clientX, ev.clientY]; anims.delete('camera'); };
  const onUp = (ev) => {
    if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 4) onPick?.(pickAt(ev));
    down = null;
  };
  const onMove = (ev) => { if (!ev.buttons) setHover(pickAt(ev), { x: ev.clientX, y: ev.clientY }); };
  const onLeave = () => setHover(null);
  const onWheel = () => anims.delete('camera');
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  controls.addEventListener('change', requestDraw);

  function resize() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer?.setPixelRatio(renderer.getPixelRatio());
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestDraw();
  }

  // 처음: 조금 멀리, 옆으로 돌아간 자리에서 들어온다
  resize();
  const startDir = new THREE.Vector3(...VIEWS.iso).normalize().applyAxisAngle(new THREE.Vector3(0, 0, 1), -0.6);
  camera.position.copy(HOME).addScaledVector(startDir, overviewDist('iso') * 1.35);
  camera.lookAt(HOME);
  controls.update();
  restyle(0);
  flyTo(HOME, new THREE.Vector3(...VIEWS.iso), overviewDist('iso'), 1300);

  return {
    setCounts(next, nextMax) { counts = next || {}; max = nextMax || 0; restyle(420); },
    select(name) {
      const next = name && zones[name] ? name : null;
      if (next === selected) return;
      selected = next;
      restyle(380);
      focus();   // 지금 보는 방향 그대로 다가가거나 물러난다
    },
    setView,
    setAutoRotate(on) { autoRotate = !!on; controls.autoRotate = autoRotate; if (autoRotate) anims.delete('camera'); requestDraw(); },
    resize,
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      anims.clear();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      controls.dispose();
      Object.values(labels).forEach((l) => l.el.remove());
      svg.remove();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
      });
      bloom?.dispose?.();
      composer?.dispose?.();
      renderer.dispose();
    },
  };
}
