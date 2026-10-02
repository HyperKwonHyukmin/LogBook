/**
 * BDF 3D 뷰어 엔진(설계 §7.3) — three.js 는 이 파일 한 곳에만 둔다.
 *
 * WorkBench `HiTessWorkBench/frontend/src/components/analysis/FeModelViewer.jsx` 와
 * `utils/feModelCamera.js` 에서 이식했다.
 *  · 온디맨드 렌더: 상시 루프를 돌리지 않고 카메라·표시 상태가 바뀔 때만 한 프레임 그린다.
 *    OrbitControls 의 damping 도 끈다(조작이 끝나는 즉시 화면이 멎어야 온디맨드가 성립한다).
 *  · 카메라에 붙인 조명: 시점을 돌려도 면 밝기가 변하지 않는다.
 *  · 조작: 왼쪽 회전, 가운데 확대, 오른쪽 이동, zoomToCursor.
 *  · webglcontextlost 복구.
 *  · ⚠ StrictMode 함정: dispose 에서 예약된 프레임 번호를 반드시 0 으로 되돌린다. StrictMode(dev) 는
 *    effect 를 setup→cleanup→setup 으로 두 번 돌리는데, 0 으로 돌리지 않으면 이후 requestRender() 가
 *    'if (frame) return' 에 걸려 영원히 한 프레임도 예약하지 않는다(캔버스가 비어 보인다).
 *
 * 계약(ModelViewer 와 테스트의 가짜 엔진이 같은 모양을 쓴다):
 *   setModel(geometry, { edges }) · setGroupVisible(pid, visible) · setEdges(visible)
 *   setMarkers({ rbe2, rbe3, conm2, spc }) · setView(presetId) · fit() · pickAt(clientX, clientY) → 순번|null
 *   highlight(index|null) · dispose()
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeFrame, VIEW_PRESETS } from '../../lib/viewFrame.js';
import { decodePick } from '../../lib/modelGeometry.js';
import { MARKER_COLORS } from '../../lib/pidPalette.js';

const BACKGROUND = 0x0e1a2b;          // 토큰 viewer
const MARKER_SIZES = { conm2: 8, spc: 7 };
const HIGHLIGHT = 0xffffff;
const PICK_SIZE = 5;
const UP = new THREE.Vector3(0, 0, 1);

function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => m.dispose());
  });
}

/** GPU 에 올린 뒤 CPU 쪽 배열을 버린다(피킹 기하는 다시 읽지 않는다). this = BufferAttribute. */
function dropArray() {
  this.array = null;
}

/** 공유 위치 속성 + 인덱스로 만든 기하. */
function indexedGeometry(positionAttr, index) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', positionAttr);
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

export function createViewerEngine(container) {
  const width0 = container.clientWidth || 800;
  const height0 = container.clientHeight || 500;

  // 렌더러 생성 실패(WebGL 없음)는 그대로 던진다 — 화면이 "3D 를 표시할 수 없습니다"로 받는다.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(width0, height0, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  // feModelCamera.createFeOrthographicCamera 와 같은 모양. 실제 범위는 setView 가 잡는다.
  const aspect0 = width0 / height0;
  const camera = new THREE.OrthographicCamera(-aspect0, aspect0, 1, -1, -100, 100);
  // ⚠ camera.up 은 늘 +Z 로 둔다. OrbitControls 는 생성 시점의 up 으로 회전 기준을 고정하므로,
  //   평면도에서 up 을 +Y 로 바꾸면 이후 회전이 엉뚱한 축을 돈다. 평면도의 ↑Y 는 setView 가
  //   카메라를 -Y 쪽으로 아주 조금 기울여 만든다.
  camera.up.copy(UP);

  // 조명은 카메라에 붙인다(주광·보조광) + 주변광.
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.4, 0.6, 1);
  const fill = new THREE.DirectionalLight(0xc8dcff, 0.6);
  fill.position.set(-0.7, -0.3, 0.4);
  camera.add(key, fill);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  let frame = 0;
  const renderFrame = () => {
    frame = 0;
    renderer.render(scene, camera);
  };
  const requestRender = () => {
    if (frame) return;
    frame = requestAnimationFrame(renderFrame);
  };

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.addEventListener('change', requestRender);

  // 모델 상태
  let geometry = null;
  let positionAttr = null;
  let modelRoot = null;                 // PID 묶음들
  const groupObjs = new Map();          // pid → { root, shell, edges, beams }
  const hiddenPids = new Set();
  let edgesOn = true;
  let markerRoot = null;
  const markerObjs = {};                // rbe2·rbe3·conm2·spc → Object3D
  let markerState = { rbe2: true, rbe3: true, conm2: true, spc: true };
  let highlightObj = null;
  let pick = null;                      // { scene, groups: Map(pid → Object3D), target }

  function viewSize() {
    return { w: container.clientWidth || 1, h: container.clientHeight || 1 };
  }

  function disposePick() {
    if (!pick) return;
    disposeTree(pick.scene);
    pick.target.dispose();
    pick = null;
  }

  /* ── 피킹 장면: 불러온 뒤 한가할 때 만든다. 그 전에 클릭이 오면 pickAt 이 바로 만든다. ── */
  let idleHandle = null;
  const hasIdle = typeof window.requestIdleCallback === 'function';
  function cancelIdlePick() {
    if (idleHandle == null) return;
    if (hasIdle) window.cancelIdleCallback(idleHandle); else clearTimeout(idleHandle);
    idleHandle = null;
  }

  // 브라우저의 WebGL 문맥 상한에 걸려 문맥을 잃으면 기본 동작은 '영구 정지'다. 복구되면 다시 그린다.
  const onContextLost = (e) => { e.preventDefault(); cancelAnimationFrame(frame); frame = 0; cancelIdlePick(); };
  // 피킹 기하는 올린 뒤 CPU 배열을 버렸으므로 문맥이 돌아오면 새로 만든다.
  const onContextRestored = () => {
    frame = 0;
    disposePick();
    if (geometry) scheduleIdlePick();
    requestRender();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function clearHighlight() {
    if (!highlightObj) return;
    scene.remove(highlightObj);
    disposeTree(highlightObj);
    highlightObj = null;
  }

  function clearModel() {
    cancelIdlePick();
    clearHighlight();
    disposePick();
    if (modelRoot) { scene.remove(modelRoot); disposeTree(modelRoot); modelRoot = null; }
    if (markerRoot) { scene.remove(markerRoot); disposeTree(markerRoot); markerRoot = null; }
    groupObjs.clear();
    hiddenPids.clear();
    for (const k of Object.keys(markerObjs)) delete markerObjs[k];
    geometry = null;
    positionAttr = null;
  }

  function applyFrame(dir, presetUp) {
    if (!geometry) return;
    const { w, h } = viewSize();
    const f = computeFrame({ dir, up: presetUp }, geometry.radius, w / h);
    camera.left = -f.halfWidth;
    camera.right = f.halfWidth;
    camera.top = f.halfHeight;
    camera.bottom = -f.halfHeight;
    camera.near = f.near;
    camera.far = f.far;
    camera.zoom = 1;
    camera.position.set(...f.position);
    // 시선이 Z 와 거의 나란하면(평면도) up=+Z 로는 화면 위쪽이 정해지지 않는다.
    // presetUp 반대쪽으로 아주 조금 물러서면 화면 위쪽이 presetUp 이 된다(→X·↑Y).
    const d = new THREE.Vector3(...dir).normalize();
    if (Math.abs(d.dot(UP)) > 0.999) {
      const tilt = new THREE.Vector3(...presetUp).normalize().multiplyScalar(-geometry.radius * 4e-3);
      camera.position.add(tilt);
    }
    camera.up.copy(UP);
    controls.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  function applyVisibility() {
    for (const [pid, o] of groupObjs) {
      const on = !hiddenPids.has(pid);
      o.root.visible = on;
      if (o.edges) o.edges.visible = edgesOn;
      const p = pick?.groups.get(pid);
      if (p) p.visible = on;
    }
    for (const [k, obj] of Object.entries(markerObjs)) obj.visible = !!markerState[k];
    requestRender();
  }

  function buildMarkers(g) {
    markerRoot = new THREE.Group();
    const lines = (k, index) => {
      if (!index.length) return;
      const obj = new THREE.LineSegments(indexedGeometry(positionAttr, index),
        new THREE.LineBasicMaterial({ color: MARKER_COLORS[k] }));
      obj.renderOrder = 2;
      markerObjs[k] = obj;
      markerRoot.add(obj);
    };
    const points = (k, index) => {
      if (!index.length) return;
      // 크기는 화면 고정(sizeAttenuation 끔) — 확대해도 점이 커지지 않는다.
      const obj = new THREE.Points(indexedGeometry(positionAttr, index),
        new THREE.PointsMaterial({ color: MARKER_COLORS[k], size: MARKER_SIZES[k], sizeAttenuation: false }));
      obj.renderOrder = 3;
      markerObjs[k] = obj;
      markerRoot.add(obj);
    };
    lines('rbe2', g.rigid.rbe2);
    lines('rbe3', g.rigid.rbe3);
    points('conm2', g.masses);
    points('spc', g.spcs);
    scene.add(markerRoot);
  }

  /** 피킹 장면 — 인덱스를 풀어 쓴 삼각형·선분에 요소 순번 색을 칠한다. */
  function buildPick() {
    const pscene = new THREE.Scene();
    const groups = new Map();
    const pos = geometry.positions;
    const meshMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
      // 선분이 면에 묻히지 않게 면을 살짝 뒤로 민다(화면 장면과 같은 규칙).
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false });
    const fill = (index, elemOf, perElem) => {
      const n = index.length;
      const p = new Float32Array(n * 3);
      const c = new Uint8Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        const v = index[i];
        const o = i * 3;
        p[o] = pos[v * 3];
        p[o + 1] = pos[v * 3 + 1];
        p[o + 2] = pos[v * 3 + 2];
        // encodePick 과 같은 셈(요소 순번+1 → 24비트 RGB). 꼭짓점마다 배열을 만들지 않게 풀어 쓴다.
        const id = elemOf[(i / perElem) | 0] + 1;
        c[o] = id & 255;
        c[o + 1] = (id >> 8) & 255;
        c[o + 2] = (id >> 16) & 255;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3).onUpload(dropArray));
      // 정규화 Uint8 — 셰이더가 바이트/255 를 그대로 받아 왕복이 정확하다.
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3, true).onUpload(dropArray));
      // ⚠ 배열을 버리기 전에 경계 구를 미리 세어 둔다. three r184 는 렌더 정렬 때 geometry 를
      // 올린(=배열을 버린) 다음 computeBoundingSphere() 를 부르므로, 여기서 안 세 두면
      // "Cannot read properties of null" 로 쉘 피킹이 통째로 실패한다(E2E 실측).
      geo.computeBoundingSphere();
      return geo;
    };
    const add = (root, obj) => {
      // 배열을 버린 뒤에는 경계 구를 셀 수 없다. 5×5 만 그리므로 시야 절두체 잘라 내기는 끈다
      // (끄지 않으면 미리 올리기 때 화면 밖 묶음이 올라가지 않는다).
      obj.frustumCulled = false;
      root.add(obj);
    };
    for (const grp of geometry.groups) {
      const root = new THREE.Group();
      if (grp.shell.length) add(root, new THREE.Mesh(fill(grp.shell, grp.shellElem, 3), meshMat));
      if (grp.beams.length) add(root, new THREE.LineSegments(fill(grp.beams, grp.beamElem, 2), lineMat));
      root.visible = !hiddenPids.has(grp.pid);
      groups.set(grp.pid, root);
      pscene.add(root);
    }
    const target = new THREE.WebGLRenderTarget(PICK_SIZE, PICK_SIZE, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    pick = { scene: pscene, groups, target };
  }

  /** (x, y) CSS 픽셀 둘레 PICK_SIZE 칸만 피킹 대상에 그리고 픽셀을 읽는다. */
  function renderPick(x, y, w, h) {
    const half = (PICK_SIZE - 1) / 2;
    const prevColorSpace = renderer.outputColorSpace;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const buf = new Uint8Array(PICK_SIZE * PICK_SIZE * 4);
    try {
      camera.updateMatrixWorld();
      camera.setViewOffset(w, h, x - half, y - half, PICK_SIZE, PICK_SIZE);
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(pick.target);
      renderer.clear();
      renderer.render(pick.scene, camera);
      renderer.readRenderTargetPixels(pick.target, 0, 0, PICK_SIZE, PICK_SIZE, buf);
    } finally {
      renderer.setRenderTarget(null);
      renderer.outputColorSpace = prevColorSpace;
      renderer.setClearColor(prevClear, prevAlpha);
      camera.clearViewOffset();
    }
    return buf;
  }

  /** 피킹 장면을 한 번 그려 GPU 에 올린다 — 올리면 CPU 배열이 버려져 메모리가 준다. */
  function warmPick() {
    if (!pick || renderer.getContext().isContextLost()) return;
    const saved = [...pick.groups.values()].map((obj) => obj.visible);
    for (const obj of pick.groups.values()) obj.visible = true;
    try {
      const { w, h } = viewSize();
      renderPick(0, 0, w, h);
    } finally {
      [...pick.groups.values()].forEach((obj, i) => { obj.visible = saved[i]; });
    }
  }

  function scheduleIdlePick() {
    cancelIdlePick();
    const run = () => {
      idleHandle = null;
      if (!geometry || pick) return;
      buildPick();
      warmPick();
    };
    idleHandle = hasIdle ? window.requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200);
  }

  /** 요소 순번 → 그 요소의 절점 순번(묶음 표에서 찾는다). */
  function elementNodes(index) {
    for (const grp of geometry.groups) {
      for (let k = 0; k < grp.beamElem.length; k += 1) {
        if (grp.beamElem[k] === index) return { kind: 'beam', nodes: [grp.beams[k * 2], grp.beams[k * 2 + 1]] };
      }
      for (let t = 0; t < grp.shellElem.length; t += 1) {
        if (grp.shellElem[t] !== index) continue;
        const a = grp.shell[t * 3]; const b = grp.shell[t * 3 + 1]; const c = grp.shell[t * 3 + 2];
        // 사각형은 (a,b,c)·(a,c,d) 두 삼각형으로 이어져 있다.
        if (t + 1 < grp.shellElem.length && grp.shellElem[t + 1] === index) {
          return { kind: 'shell', nodes: [a, b, c, grp.shell[(t + 1) * 3 + 2]] };
        }
        return { kind: 'shell', nodes: [a, b, c] };
      }
    }
    return null;
  }

  const onResize = () => {
    if (!container.clientWidth || !container.clientHeight) return;
    const { w, h } = viewSize();
    // computeFrame 과 같은 규칙: 짧은 쪽 반폭을 유지한다(넓은 화면은 세로, 좁은 화면은 가로).
    // resizeFeOrthographicCamera 처럼 세로만 유지하면 좁은 화면에서 모델 옆이 잘린다.
    const aspect = w / h;
    const keep = Math.max(Math.min((camera.right - camera.left) / 2, (camera.top - camera.bottom) / 2), 1e-9);
    const cx = (camera.right + camera.left) / 2;
    const cy = (camera.top + camera.bottom) / 2;
    const hw = aspect >= 1 ? keep * aspect : keep;
    const hh = aspect >= 1 ? keep : keep / aspect;
    camera.left = cx - hw;
    camera.right = cx + hw;
    camera.top = cy + hh;
    camera.bottom = cy - hh;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    requestRender();
  };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  resizeObserver?.observe(container);

  // 창을 배율이 다른 모니터로 옮기면 devicePixelRatio 가 바뀐다 — resolution 질의로 따라간다.
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDprChange);
    dprQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    dprQuery?.addEventListener?.('change', onDprChange);
  }
  function onDprChange() {
    watchDpr();
    renderer.setPixelRatio(pixelRatio());
    onResize();
  }
  watchDpr();

  requestRender();

  return {
    setModel(g, { edges = true } = {}) {
      clearModel();
      geometry = g;
      edgesOn = edges;
      positionAttr = new THREE.BufferAttribute(g.positions, 3);
      modelRoot = new THREE.Group();
      for (const grp of g.groups) {
        const root = new THREE.Group();
        const color = new THREE.Color(grp.color);
        const o = { root, shell: null, edges: null, beams: null };
        if (grp.shell.length) {
          // flatShading — 법선 속성 없이 화면 미분으로 면 법선을 구한다(메모리 절약, 요소 면이 또렷하다).
          o.shell = new THREE.Mesh(indexedGeometry(positionAttr, grp.shell), new THREE.MeshLambertMaterial({
            color, side: THREE.DoubleSide, flatShading: true,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          }));
          root.add(o.shell);
        }
        if (grp.edges.length) {
          o.edges = new THREE.LineSegments(indexedGeometry(positionAttr, grp.edges), new THREE.LineBasicMaterial({
            color: color.clone().multiplyScalar(0.45), transparent: true, opacity: 0.55,
          }));
          o.edges.renderOrder = 1;
          root.add(o.edges);
        }
        if (grp.beams.length) {
          o.beams = new THREE.LineSegments(indexedGeometry(positionAttr, grp.beams),
            new THREE.LineBasicMaterial({ color }));
          root.add(o.beams);
        }
        groupObjs.set(grp.pid, o);
        modelRoot.add(root);
      }
      scene.add(modelRoot);
      buildMarkers(g);
      applyVisibility();
      applyFrame(VIEW_PRESETS.iso.dir, VIEW_PRESETS.iso.up);
      scheduleIdlePick();
    },

    setGroupVisible(pid, visible) {
      if (visible) hiddenPids.delete(pid); else hiddenPids.add(pid);
      applyVisibility();
    },

    setEdges(visible) {
      edgesOn = !!visible;
      applyVisibility();
    },

    setMarkers(state) {
      markerState = { ...markerState, ...state };
      applyVisibility();
    },

    setView(presetId) {
      const p = VIEW_PRESETS[presetId] || VIEW_PRESETS.iso;
      applyFrame(p.dir, p.up);
    },

    fit() {
      if (!geometry) return;
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() === 0) { applyFrame(VIEW_PRESETS.iso.dir, VIEW_PRESETS.iso.up); return; }
      dir.normalize();
      // 평면도 근처에서는 지금 화면 위쪽(카메라 Y 축)을 기울임 기준으로 쓴다.
      const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      applyFrame(dir.toArray(), screenUp.toArray());
    },

    pickAt(clientX, clientY) {
      if (!geometry || geometry.total === 0) return null;
      if (!pick) { cancelIdlePick(); buildPick(); }
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(Math.round(rect.width), 1);
      const h = Math.max(Math.round(rect.height), 1);
      const x = Math.floor(clientX - rect.left);
      const y = Math.floor(clientY - rect.top);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      const half = (PICK_SIZE - 1) / 2;
      const buf = renderPick(x, y, w, h);
      // 가운데에서 가장 가까운, 빈 곳이 아닌 픽셀
      let best = null;
      let bestD = Infinity;
      for (let py = 0; py < PICK_SIZE; py += 1) {
        for (let px = 0; px < PICK_SIZE; px += 1) {
          const o = (py * PICK_SIZE + px) * 4;
          const idx = decodePick(buf[o], buf[o + 1], buf[o + 2]);
          if (idx === null || idx >= geometry.total) continue;
          const d = (px - half) ** 2 + (py - half) ** 2;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      requestRender();
      return best;
    },

    highlight(index) {
      clearHighlight();
      if (index == null || !geometry) { requestRender(); return; }
      const found = elementNodes(index);
      if (!found) { requestRender(); return; }
      const pos = geometry.positions;
      const at = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      const group = new THREE.Group();
      const ring = found.kind === 'shell'
        ? found.nodes.flatMap((v, i) => [...at(v), ...at(found.nodes[(i + 1) % found.nodes.length])])
        : [...at(found.nodes[0]), ...at(found.nodes[1])];
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
      // 다른 요소에 가려지지 않게 깊이 검사를 끄고 맨 위에 그린다.
      const line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: HIGHLIGHT, depthTest: false }));
      line.renderOrder = 10;
      group.add(line);
      if (found.kind === 'beam') {
        const ptGeo = new THREE.BufferGeometry();
        ptGeo.setAttribute('position', new THREE.Float32BufferAttribute([...at(found.nodes[0]), ...at(found.nodes[1])], 3));
        const pts = new THREE.Points(ptGeo, new THREE.PointsMaterial({
          color: HIGHLIGHT, size: 7, sizeAttenuation: false, depthTest: false,
        }));
        pts.renderOrder = 11;
        group.add(pts);
      }
      highlightObj = group;
      scene.add(group);
      requestRender();
    },

    dispose() {
      cancelAnimationFrame(frame);
      // ⚠ 반드시 0 으로 되돌린다(머리 주석의 StrictMode 함정).
      frame = 0;
      resizeObserver?.disconnect();
      dprQuery?.removeEventListener?.('change', onDprChange);
      dprQuery = null;
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      clearModel();
      disposeTree(scene);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
