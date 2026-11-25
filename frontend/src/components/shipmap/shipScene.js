/**
 * 73 — 선박 지도 3D 장면. 코드로 만든 단순 선체(치수 L 280 × B 46 × D 26 m)에 구역을 겉판 색으로 칠한다.
 * 선체는 단면(바닥, 빌지 원호, 옆판)을 길이 방향으로 이어 만들고, 선수는 좁히며 앞으로 기울이고,
 * 선미는 바닥을 올려 트랜섬으로 끝낸다. 겉판 한 칸이 어느 구역인지는 lib/shipZones.hullZoneAt 이 정한다.
 * 그리기는 필요할 때만(조작, 색 바꾸기) — 관계 지도처럼 계속 돌지 않는다.
 * API: createShipScene({ canvas, overlay, onPick }) → { setCounts, select, setView, resize, dispose }
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FUNNEL, HOUSE, SHIP_ZONES, heatColor, heatInk, hullZoneAt } from '../../lib/shipZones.js';

export const SHIP = { L: 280, B: 46, D: 26 };
const { L, B, D } = SHIP;
const HB = B / 2;
const RB = 5;                       // 빌지 반지름(m)
const STATIONS = 140;
const BACKGROUND = 0xF5F8FD;        // n-50
const LINE = 0x90959C;              // n-400
const SELECT_GLOW = 0x6BE8C1;       // brand-mint
const HOVER_GLOW = 0x7F97B8;        // brand-ring
const FOV = 32;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** 바닥 높이(D 비율) — 선미 쪽만 올라간다. */
const keelRise = (x) => (x < 0.13 ? 0.48 * ((0.13 - x) / 0.13) ** 2 : 0);

/** 반폭 비율(1 = 평행부). 선수는 위로 갈수록 덜 좁아지고(플레어), 선미는 아래만 좁아져 트랜섬을 남긴다. */
function breadth(x, zn) {
  let f = 1;
  if (x > 0.74) f *= 1 - clamp01((x - 0.74) / 0.26) ** (1.4 + 2 * zn);
  if (x < 0.24) {
    const t = clamp01((0.24 - x) / 0.24);
    const w = 0.84 * smooth(0.3, 0.95, zn);
    f *= 1 - t ** 1.7 * (1 - w);
  }
  return Math.max(0, f);
}

/** 반단면(가운데 바닥 → 빌지 → 옆판 → 갑판 끝), 단위 m. */
function halfSection() {
  const pts = [];
  for (let i = 0; i <= 5; i += 1) pts.push([(HB - RB) * (i / 5), 0]);
  for (let i = 1; i <= 7; i += 1) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 7);
    pts.push([HB - RB + RB * Math.cos(a), RB + RB * Math.sin(a)]);
  }
  for (let i = 1; i <= 10; i += 1) pts.push([HB, RB + (D - RB) * (i / 10)]);
  return pts;
}

/** 선체 격자: P[i][j] (i 길이 방향, j 좌현 갑판 끝 → 바닥 → 우현 갑판 끝). 우현이 -y(기본 시점 쪽). */
function hullGrid() {
  const half = halfSection();
  const sec = [...half.slice(1).reverse().map(([y, z]) => [y, z]), ...half.map(([y, z]) => [-y, z])];
  const P = [];
  const xs = [];
  for (let i = 0; i <= STATIONS; i += 1) {
    const x = i / STATIONS;
    xs.push(x);
    const zk = keelRise(x) * D;
    P.push(sec.map(([y0, z0]) => {
      const z = zk + z0 * (D - zk) / D;
      const zn = z / D;
      const nose = clamp01((x - 0.9) / 0.1) ** 2;
      // 선수: 위쪽은 앞으로 기울고(rake), 아래쪽은 구상 선수(bulb)로 내민다
      const rake = 0.03 * L * smooth(0.3, 1, zn) * nose;
      const bulb = 0.02 * L * Math.exp(-(((zn - 0.26) / 0.16) ** 2)) * nose;
      const overhang = x < 0.05 ? -0.014 * L * smooth(0.45, 1, zn) * (1 - x / 0.05) : 0;
      return new THREE.Vector3(x * L + rake + bulb + overhang, y0 * breadth(x, zn), z);
    }));
  }
  return { P, xs, mid: half.length - 1 };
}

function gridNormals(P) {
  const ni = P.length; const nj = P[0].length;
  const at = (i, j) => P[Math.max(0, Math.min(ni - 1, i))][Math.max(0, Math.min(nj - 1, j))];
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const out = new THREE.Vector3();
  return P.map((row, i) => row.map((p, j) => {
    a.subVectors(at(i + 1, j), at(i - 1, j));
    b.subVectors(at(i, j + 1), at(i, j - 1));
    const n = new THREE.Vector3().crossVectors(a, b);
    if (n.lengthSq() < 1e-12) n.set(p.x > L / 2 ? 1 : -1, 0, 0);
    n.normalize();
    out.set(0, p.y, p.z - D * 0.55);   // 바깥쪽(선체 가운데 축에서 멀어지는 쪽)으로 맞춘다
    if (n.dot(out) < 0 && Math.abs(p.y) > 0.01) n.negate();
    return n;
  }));
}

class Buf {
  constructor() { this.pos = []; this.nor = []; }
  tri(p1, n1, p2, n2, p3, n3) {
    for (const [p, n] of [[p1, n1], [p2, n2], [p3, n3]]) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); }
  }
  quad(a, na, b, nb, c, nc, d, nd) { this.tri(a, na, b, nb, c, nc); this.tri(a, na, c, nc, d, nd); }
  box(x0, x1, y0, y1, z0, z1) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.pos.push(...g.attributes.position.array); this.nor.push(...g.attributes.normal.array);
    g.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** 구역별 겉판 묶음과 테두리 선. */
function buildShip() {
  const { P, xs, mid } = hullGrid();
  const N = gridNormals(P);
  const bufs = Object.fromEntries(SHIP_ZONES.map((z) => [z.name, new Buf()]));
  const nj = P[0].length;
  for (let i = 0; i < P.length - 1; i += 1) {
    const xc = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < nj - 1; j += 1) {
      const zc = (P[i][j].z + P[i + 1][j].z + P[i][j + 1].z + P[i + 1][j + 1].z) / 4 / D;
      bufs[hullZoneAt(xc, zc)].quad(P[i][j], N[i][j], P[i + 1][j], N[i + 1][j], P[i + 1][j + 1], N[i + 1][j + 1], P[i][j + 1], N[i][j + 1]);
    }
  }
  // 트랜섬(선미 끝 면)
  const back = new THREE.Vector3(-1, 0, 0);
  for (let k = 0; k < mid; k += 1) {
    const a = P[0][mid - k]; const b = P[0][mid + k]; const c = P[0][mid + k + 1]; const d = P[0][mid - k - 1];
    bufs['선미부'].quad(a, back, b, back, c, back, d, back);
  }
  // 상갑판
  const up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < P.length - 1; i += 1) {
    bufs['상갑판'].quad(P[i][0], up, P[i][nj - 1], up, P[i + 1][nj - 1], up, P[i + 1][0], up);
  }
  // 거주구 — 본체와 양쪽으로 나온 선교 날개
  const hx0 = HOUSE.x[0] * L; const hx1 = HOUSE.x[1] * L; const top = HOUSE.z[1] * D;
  bufs['거주구'].box(hx0, hx1, -HOUSE.halfWidth * HB, HOUSE.halfWidth * HB, D, top - 1.6);
  bufs['거주구'].box(hx1 - 0.035 * L, hx1, -HB * 0.98, HB * 0.98, top - 1.6, top);
  bufs['거주구'].box(hx0 + 0.01 * L, hx1 - 0.01 * L, -HOUSE.halfWidth * HB * 0.9, HOUSE.halfWidth * HB * 0.9, top - 1.6, top + 0.8);
  // 타(선미부) — 선미 바닥 아래 판 하나
  bufs['선미부'].box(0.006 * L, 0.032 * L, -0.5, 0.5, D * 0.06, D * 0.5);

  // 선(단면 몇 개, 구역 경계 단면, 갑판 끝, 용골)
  const seg = [];
  const pushPolyline = (pts) => { for (let k = 0; k < pts.length - 1; k += 1) seg.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z); };
  for (let i = 0; i < P.length; i += 10) pushPolyline(P[i]);
  pushPolyline(P.map((r) => r[0])); pushPolyline(P.map((r) => r[nj - 1])); pushPolyline(P.map((r) => r[mid]));
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  return { geometries: Object.fromEntries(Object.entries(bufs).map(([k, b]) => [k, b.geometry()])), lines };
}

function funnelMesh() {
  const g = new Buf();
  const x0 = FUNNEL.x[0] * L; const x1 = FUNNEL.x[1] * L; const w = FUNNEL.halfWidth * HB;
  g.box(x0, x1, -w, w, FUNNEL.z[0] * D - 6, FUNNEL.z[1] * D);
  const body = new THREE.Mesh(g.geometry(), new THREE.MeshStandardMaterial({ color: 0xBDC3CA, roughness: 0.8 }));
  const capBuf = new Buf();
  capBuf.box(x0 - 0.3, x1 + 0.3, -w - 0.3, w + 0.3, FUNNEL.z[1] * D - 2.2, FUNNEL.z[1] * D);
  const cap = new THREE.Mesh(capBuf.geometry(), new THREE.MeshStandardMaterial({ color: 0x383C42, roughness: 0.8 }));
  const grp = new THREE.Group(); grp.add(body, cap);
  return grp;
}

const VIEWS = {
  iso: [0.42, -1, 0.5],
  side: [0, -1, 0.02],
  top: [0, -0.02, 1],
  bow: [0.9, -0.75, 0.35],
};
export const VIEW_ITEMS = [{ id: 'iso', label: '입체' }, { id: 'side', label: '측면' }, { id: 'top', label: '위' }, { id: 'bow', label: '선수 쪽' }];

const LABEL_BASE = 'pointer-events-auto absolute left-0 top-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-meta font-medium shadow-sm transition-colors duration-150 ease-out';

export function createShipScene({ canvas, overlay, onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });   // WebGL 이 없으면 여기서 던진다(화면이 잡는다)
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(BACKGROUND, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, L * 20);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3(L * 0.5, 0, D * 0.55);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.target.copy(target);
  controls.minDistance = L * 0.25;
  controls.maxDistance = L * 4;

  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xD3D9E0, 1.25));
  const sun = new THREE.DirectionalLight(0xFFFFFF, 1.35);
  sun.position.set(L * 0.2, -L * 0.8, L * 1.1);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xFFFFFF, 0.35);
  fill.position.set(L * 1.2, L * 0.6, L * 0.3);
  scene.add(fill);

  const floor = new THREE.GridHelper(L * 2.2, 22, 0xD3D9E0, 0xE0E5EC);
  floor.rotation.x = Math.PI / 2;
  floor.position.set(L * 0.5, 0, -6);
  scene.add(floor);

  const { geometries, lines } = buildShip();
  const meshes = {};
  for (const z of SHIP_ZONES) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xE6EBF2, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const m = new THREE.Mesh(geometries[z.name], mat);
    m.userData.zone = z.name;
    meshes[z.name] = m;
    scene.add(m);
  }
  const wire = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.45 }));
  scene.add(wire);
  const funnel = funnelMesh();
  scene.add(funnel);

  // 고른 구역 테두리
  let outline = null;
  const outlineMat = new THREE.LineBasicMaterial({ color: 0x13171C });

  // 이름표(HTML) — 구역마다 하나, 그릴 때마다 화면 자리로 옮긴다
  const labels = {};
  const anchors = {};
  for (const z of SHIP_ZONES) {
    const [ax, az, ay] = z.anchor;
    anchors[z.name] = new THREE.Vector3(ax * L, -ay * HB, az * D);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = LABEL_BASE;
    Object.assign(el.style, { position: 'absolute', left: '0px', top: '0px', whiteSpace: 'nowrap' });   // 자리 잡기는 스타일 묶음에 기대지 않는다
    el.addEventListener('click', () => onPick?.(z.name));
    el.addEventListener('pointerenter', () => { hover = z.name; paint(); });
    el.addEventListener('pointerleave', () => { if (hover === z.name) { hover = null; paint(); } });
    overlay?.appendChild(el);
    labels[z.name] = el;
  }

  let counts = {}; let max = 0; let selected = null; let hover = null; let frame = 0;
  const v = new THREE.Vector3();

  function placeLabels() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    for (const z of SHIP_ZONES) {
      const el = labels[z.name];
      v.copy(anchors[z.name]).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.display = visible ? '' : 'none';
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }
  function draw() { frame = 0; renderer.render(scene, camera); placeLabels(); }
  function requestDraw() { if (!frame) frame = requestAnimationFrame(draw); }

  function paint() {
    for (const z of SHIP_ZONES) {
      const n = counts[z.name] || 0;
      const m = meshes[z.name].material;
      m.color.set(heatColor(n, max));
      const glow = z.name === selected ? SELECT_GLOW : z.name === hover ? HOVER_GLOW : 0x000000;
      m.emissive.set(glow);
      m.emissiveIntensity = z.name === selected ? 0.35 : z.name === hover ? 0.3 : 0;
      const el = labels[z.name];
      const on = z.name === selected;
      el.className = `${LABEL_BASE} ${on ? 'border-n-900 bg-n-900 text-n-0' : n ? 'border-n-200 bg-n-0 text-n-900 hover:border-n-400' : 'border-n-200 bg-n-0/85 text-n-500 hover:border-n-400'}`;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.setAttribute('aria-label', `${z.name}: 자료 ${n}건`);
      el.innerHTML = '';
      const sw = document.createElement('span');
      sw.setAttribute('aria-hidden', 'true');
      sw.className = 'inline-block h-2.5 w-2.5 rounded-[3px] border border-n-0/60';
      sw.style.background = heatColor(n, max);
      const name = document.createElement('span'); name.textContent = z.name;
      const num = document.createElement('b'); num.className = 'tabular-nums font-semibold'; num.textContent = String(n);
      el.append(sw, name, num);
    }
    canvas.style.cursor = hover ? 'pointer' : '';
    if (outline) { scene.remove(outline); outline.geometry.dispose(); outline = null; }
    if (selected && meshes[selected]) {
      outline = new THREE.LineSegments(new THREE.EdgesGeometry(meshes[selected].geometry, 35), outlineMat);
      scene.add(outline);
    }
    requestDraw();
  }

  // 누르기(끌기와 구분 — 4px 안에서 떼면 고른다)와 올리기
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(Object.values(meshes), false)[0];
    return hit ? hit.object.userData.zone : null;
  };
  let down = null;
  const onDown = (ev) => { down = [ev.clientX, ev.clientY]; };
  const onUp = (ev) => {
    if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 4) onPick?.(pickAt(ev));
    down = null;
  };
  const onMove = (ev) => {
    if (ev.buttons) return;
    const z = pickAt(ev);
    if (z !== hover) { hover = z; paint(); }
  };
  const onLeave = () => { if (hover) { hover = null; paint(); } };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  controls.addEventListener('change', requestDraw);

  function setView(id = 'iso') {
    const dir = new THREE.Vector3(...(VIEWS[id] || VIEWS.iso)).normalize();
    const aspect = camera.aspect || 1;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const halfW = L * 0.6; const halfH = id === 'top' ? B * 0.9 : D * 1.4;
    const dist = Math.max(halfW / (t * aspect), halfH / t) * ({ iso: 1.05, bow: 0.95 }[id] || 1.05);
    camera.position.copy(target).addScaledVector(dir, dist);
    controls.target.copy(target);
    controls.update();
    requestDraw();
  }

  function resize() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestDraw();
  }

  resize();
  setView('iso');
  paint();

  return {
    setCounts(next, nextMax) { counts = next || {}; max = nextMax || 0; paint(); },
    select(name) { selected = name || null; paint(); },
    setView,
    resize,
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      Object.values(labels).forEach((el) => el.remove());
      scene.traverse((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); });
      outlineMat.dispose();
      renderer.dispose();
    },
  };
}

export { heatInk };
