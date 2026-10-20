/**
 * 설명회 데모의 가짜 서버 — 실제 화면 코드가 부르는 /api 요청을 예시 데이터(data.js)로 답한다.
 * 응답 모양은 backend 의 graph.py · coverage.py · similar.py · routers/search.py 와 같다(바뀌면 여기도 맞춘다).
 * 저장하는 요청은 없다. 모르는 주소는 404 'demo_not_available'.
 */
import {
  ENTRIES, FILES, FILE_BY_ID, HULL_BY_NO, MODEL_FILES, PEOPLE_NAMES, TARGETS, TEXT_PAIRS, ZONES,
} from './data.js';

const SIG_KEYS = ['property', 'material', 'load'];
const DOC_RANK = { uses: 3, rrev: 2, text: 1 };
const WEIGHTS = { size: 0.3, scale: 0.2, mix: 0.2, sec: 0.2, tag: 0.1 };
const MAX_RESULTS = 10;
const MAX_MEMBERS = 30;

const models = (e) => e.files.filter((f) => f.kind === 'model');
const reports = (e) => e.files.filter((f) => f.kind === 'report');
const usedHulls = () => [...new Set(ENTRIES.flatMap((e) => e.hulls))].sort();

/* ── 문서 관계(32): 사용한 모델 · 본문 비슷함 ── */
function docPairs() {
  const pairs = new Map();
  const put = (a, b, kind, files, score = null, from = null) => {
    if (a === b) return;
    const [x, y] = a.pk < b.pk ? [a, b] : [b, a];
    const key = `${x.pk}|${y.pk}`;
    let p = pairs.get(key);
    if (!p) {
      p = { a: x, b: y, type: kind, files, score, count: 0, kinds: { uses: 0, rrev: 0, text: 0 } };
      if (from) p.from = from;
      pairs.set(key, p);
    }
    p.count += 1;
    p.kinds[kind] += 1;
    if (DOC_RANK[kind] > DOC_RANK[p.type]) {
      Object.assign(p, { type: kind, files, score });
      delete p.from;
      if (from) p.from = from;
    }
  };
  for (const f of FILES) {
    if (f.kind !== 'report') continue;
    for (const m of f.uses || []) if (m && m.entry !== f.entry) put(f.entry, m.entry, 'uses', [f.name, m.name], null, f.entry);
  }
  for (const [x, y, score] of TEXT_PAIRS) put(x.entry, y.entry, 'text', [x.name, y.name], score);
  return [...pairs.values()];
}

/* ── 모델 관계(12): 같은 형상 서명 ── */
function modelPairs() {
  const byGeom = new Map();
  for (const f of MODEL_FILES) {
    if (!byGeom.has(f.sigs.geometry)) byGeom.set(f.sigs.geometry, []);
    byGeom.get(f.sigs.geometry).push(f);
  }
  const pairs = new Map();
  for (const group of byGeom.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        let [a, b] = [group[i], group[j]];
        if (a.entry === b.entry) continue;
        if (a.entry.pk > b.entry.pk) [a, b] = [b, a];
        const differs = SIG_KEYS.filter((k) => a.sigs[k] !== b.sigs[k]);
        const key = `${a.entry.pk}|${b.entry.pk}`;
        let p = pairs.get(key);
        if (!p) { p = { a: a.entry, b: b.entry, count: 0, type: null }; pairs.set(key, p); }
        p.count += 1;
        if (p.type == null || (!differs.length && p.type !== 'dup') || (differs.length && p.type === 'geom' && differs.length < p.differs.length)) {
          Object.assign(p, { type: differs.length ? 'geom' : 'dup', differs, files: [a.name, b.name] });
        }
      }
    }
  }
  return [...pairs.values()];
}

function graph() {
  const hulls = usedHulls();
  const nReports = FILES.filter((f) => f.kind === 'report').length;
  return {
    entries: ENTRIES.map((e) => ({
      id: e.id, title: e.title, confirmed_at: e.confirmed_at, hulls: e.hulls, zones: e.zones,
      targets: e.target ? [e.target] : [], free: e.free, files: e.files.length, revisions: e.revisions || [],
      models: models(e).length, reports: reports(e).length, report_revisions: e.report_revisions || [],
    })),
    hulls: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.ship_type ?? null])),
    hull_kinds: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.kind ?? null])),
    hull_sizes: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.size ?? null])),
    pairs: modelPairs().map((p) => ({ a: p.a.id, b: p.b.id, type: p.type, differs: p.differs, files: p.files, count: p.count })),
    doc_pairs: docPairs().map((p) => ({ ...p, a: p.a.id, b: p.b.id, ...(p.from ? { from: p.from.id } : {}) })),
    unsigned_models: 0,
    truncated: false,
    doc_index: { reports: nReports, indexed: nReports, vectors: nReports, available: true },
  };
}

/* ── 갖춤 현황(26) ── */
function coverage() {
  const linkedModels = new Set();   // 다른 자료의 문서가 이 자료의 모델을 '사용한 모델'로 연결
  const linkedDocs = new Set();     // 이 자료의 문서가 다른 자료의 모델과 연결
  for (const f of FILES) {
    if (f.kind !== 'report') continue;
    for (const m of f.uses || []) {
      if (m && m.entry !== f.entry) { linkedModels.add(m.entry.pk); linkedDocs.add(f.entry.pk); }
    }
  }
  const zoneCount = new Map();
  const entries = ENTRIES.map((e) => {
    e.zones.forEach((z) => zoneCount.set(z, (zoneCount.get(z) || 0) + 1));
    const ms = models(e);
    const states = ms.map((m) => m.solve).filter(Boolean);
    const solve = !ms.length ? null : states.includes('pass') ? 'pass'
      : (states.length === ms.length && states.every((s) => s === 'fail')) ? 'fail' : 'none';
    return {
      id: e.id, title: e.title,
      rows: [...e.hulls.map((h) => `h:${h}`), ...(e.no_hull ? ['c:공용'] : [])],
      zones: e.zones, models: ms.length, reports: reports(e).length,
      doc_linked: linkedModels.has(e.pk), model_linked: linkedDocs.has(e.pk), solve,
      needs_fix: ms.length > 0 && !e.hulls.length && !e.no_hull, unsigned: false,
      uploaded_by: e.uploaded_by, uploader_name: PEOPLE_NAMES[e.uploaded_by] || null, confirmed_at: e.confirmed_at,
    };
  });
  const hulls = usedHulls();
  return {
    entries,
    hulls: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.ship_type ?? null])),
    zones: [...zoneCount.keys()].sort((a, b) => zoneCount.get(b) - zoneCount.get(a) || a.localeCompare(b)),
    truncated: false,
  };
}

/* ── 선례 찾기(27) — backend similar.py 의 점수를 그대로 옮겼다 ── */
function features(f) {
  const g = f.model;
  const diag = Math.hypot(...g.dims) || 1e-6;
  return { dims: g.dims, elems: g.elems, nodes: g.nodes, density: diag / Math.sqrt(g.elems), mix: g.mix,
    sections: g.sections, sol: '101', sig: f.sigs.geometry };
}
function score(base, other) {
  const d = Math.sqrt(base.dims.reduce((s, a, i) => s + Math.log(Math.max(a, 0.05) / Math.max(other.dims[i], 0.05)) ** 2, 0));
  const size = Math.exp(-d);
  const scale = Math.exp(-(Math.abs(Math.log10(base.elems / other.elems)) * 1.4 + Math.abs(Math.log(base.density / other.density)) * 0.8));
  const dot = base.mix.reduce((s, a, i) => s + a * other.mix[i], 0);
  const norm = Math.hypot(...base.mix) * Math.hypot(...other.mix);
  const mix = norm ? Math.max(0, dot / norm) ** 3 : 0;
  const A = new Set(base.sections);
  const B = new Set(other.sections);
  const inter = [...A].filter((x) => B.has(x));
  const uni = new Set([...A, ...B]);
  const sec = uni.size ? inter.length / uni.size : 0;
  const tag = base.zone && (other.zones || []).includes(base.zone) ? 1 : 0;
  const raw = { size, scale, mix, sec, tag };
  const tw = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const weighted = Object.keys(raw).reduce((s, k) => s + raw[k] * WEIGHTS[k], 0) / tw;
  const shape = !!(base.sig && base.sig === other.sig);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { total: r4(shape ? 0.9 + 0.1 * weighted : weighted), shape,
    raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, r4(v)])), same_sections: inter.sort() };
}
function publicOf(f) {
  const e = f.entry;
  const ft = features(f);
  return { file_id: f.id, file_name: f.name, model_key: `k${f.id}`, entry_id: e.id, title: e.title, zones: e.zones,
    hulls: e.hulls, reports: reports(e).length, solve: f.solve, uploaded_by: e.uploaded_by,
    uploader_name: PEOPLE_NAMES[e.uploaded_by] || null, confirmed_at: e.confirmed_at,
    dims: ft.dims, elems: ft.elems, mix: ft.mix, sections: ft.sections, sol: ft.sol };
}
function findSimilar(base, excludeFile) {
  const best = new Map();
  for (const f of MODEL_FILES) {
    if (f.id === excludeFile) continue;
    const c = { ...features(f), zones: f.entry.zones };
    const s = score(base, c);
    const cur = best.get(f.entry.pk);
    if (!cur || s.total > cur[1].total) best.set(f.entry.pk, [f, s]);
  }
  const groups = new Map();
  for (const [f, s] of best.values()) {
    const k = f.sigs.geometry || `file:${f.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([f, s]);
  }
  const rows = [];
  for (const members of groups.values()) {
    members.sort((a, b) => b[1].total - a[1].total || (a[0].solve !== 'pass') - (b[0].solve !== 'pass'));
    const top = members[0][1].total;
    const near = members.filter((m) => m[1].total >= top - 0.03);
    const lead = [...near].sort((a, b) => (a[0].solve !== 'pass') - (b[0].solve !== 'pass')
      || (reports(a[0].entry).length === 0) - (reports(b[0].entry).length === 0) || b[1].total - a[1].total)[0];
    rows.push({ lead: publicOf(lead[0]), score: lead[1], best: top,
      members: members.slice(0, MAX_MEMBERS).map((m) => ({ ...publicOf(m[0]), total: m[1].total })), member_total: members.length });
  }
  rows.sort((a, b) => b.best - a.best);
  return { results: rows.slice(0, MAX_RESULTS), candidates: best.size, weights: WEIGHTS };
}
function similarToFile(fileId, zoneParam) {
  const f = FILE_BY_ID.get(fileId);
  if (!f || f.kind !== 'model') return [404, { detail: 'similar_base_not_found' }];
  const zone = zoneParam != null ? (zoneParam || null) : ([...f.entry.zones].sort()[0] || null);
  const base = { ...features(f), zone };
  return [200, {
    base: { name: f.name, file_id: f.id, model_key: `k${f.id}`, entry_id: f.entry.id, entry_title: f.entry.title, zone,
      dims: base.dims, elems: base.elems, mix: base.mix, sections: base.sections, sol: base.sol, missing_includes: [],
      has_signature: true },
    ...findSimilar(base, f.id),
  }];
}
/** 내 PC 의 BDF — 데모는 파일을 읽지 않고, 이름으로 고른 예시 모델을 조금 바꿔 기준으로 쓴다. */
function similarToUpload(name, zoneParam) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  const src = MODEL_FILES[Math.abs(h) % MODEL_FILES.length];
  const ft = features(src);
  const base = { ...ft, dims: ft.dims.map((d) => +(d * 1.07).toFixed(2)), elems: Math.round(ft.elems * 1.12), sig: null,
    zone: zoneParam || null };
  base.density = Math.hypot(...base.dims) / Math.sqrt(base.elems);
  return [200, {
    base: { name, file_id: null, model_key: null, entry_id: null, entry_title: null, zone: base.zone, dims: base.dims,
      elems: base.elems, mix: base.mix, sections: base.sections, sol: base.sol, missing_includes: [], has_signature: false },
    ...findSimilar(base, null),
  }];
}

/* ── 기준 BDF 고르기(ModelPicker) — /search?unit=file&kind=model ── */
function searchModels(params) {
  const q = (params.get('q') || '').trim().toLowerCase();
  const limit = Number(params.get('limit') || 30);
  const hit = MODEL_FILES.filter((f) => !q || [f.name, f.entry.title, f.entry.id, ...f.entry.hulls].some((s) => s.toLowerCase().includes(q)));
  return { total: hit.length, items: hit.slice(0, limit).map((f) => ({
    file_id: f.id, model_key: `k${f.id}`, hulls: f.entry.hulls, entry_title: f.entry.title, entry_id: f.entry.id,
    name: f.name, posted_at: `${f.entry.confirmed_at}-15`, entry_status: 'confirmed', model_state: 'done' })) };
}

/* ── 분류 목록 ── */
function vocab(kind) {
  const values = kind === 'target' ? TARGETS : ZONES;
  return { kind, other: '기타', terms: values.map((v, i) => ({ id: i + 1, value: v, active: true, count: 0, synonyms: [] })) };
}

/* ── 썸네일 — 모델 종류별 선 그림(SVG). 실제 앱은 변환기가 만든 PNG ── */
function thumbSvg(f) {
  const g = f?.model;
  const W = 320;
  const H = 200;
  let seed = g?.seed || 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const iso = (x, y, z) => [W / 2 + (x - y) * 0.87, H * 0.62 + (x + y) * 0.5 - z];
  const lines = [];
  const line = (a, b, c = '#7FB2E5', w = 1) => {
    const [x1, y1] = iso(...a);
    const [x2, y2] = iso(...b);
    lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="${w}"/>`);
  };
  const kind = g?.geom || 'frame';
  const box = (L, B, Hh, nx, ny, nz, c) => {
    for (let i = 0; i <= nx; i += 1) for (let k = 0; k <= nz; k += 1) line([-L / 2 + (L * i) / nx, -B / 2, (Hh * k) / nz], [-L / 2 + (L * i) / nx, B / 2, (Hh * k) / nz], c);
    for (let j = 0; j <= ny; j += 1) for (let k = 0; k <= nz; k += 1) line([-L / 2, -B / 2 + (B * j) / ny, (Hh * k) / nz], [L / 2, -B / 2 + (B * j) / ny, (Hh * k) / nz], c);
    for (let i = 0; i <= nx; i += 1) for (let j = 0; j <= ny; j += 1) line([-L / 2 + (L * i) / nx, -B / 2 + (B * j) / ny, 0], [-L / 2 + (L * i) / nx, -B / 2 + (B * j) / ny, Hh], c);
  };
  const n = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  if (kind === 'mast') {
    box(34, 34, 120, 1, 1, n(4, 7), '#9CC7F0');
    line([0, 0, 120], [0, 0, 150], '#E8A87C', 1.5);
  } else if (kind === 'module') box(120, 80, 70, n(3, 5), n(2, 4), n(2, 3), '#8EC5E8');
  else if (kind === 'global') {
    for (let i = 0; i <= 14; i += 1) line([-140 + i * 20, -30, 0], [-140 + i * 20, 30, 0], '#6FA3D6');
    box(280, 60, 40, 14, 3, 2, '#7FB2E5');
  } else if (kind === 'plate') box(130, 90, 46, n(5, 9), n(4, 7), 1, '#86BCE9');
  else if (kind === 'fitting') {
    box(70, 50, 24, 3, 2, 1, '#8FC2EC');
    line([0, 0, 24], [0, 0, 60], '#E8A87C', 3);
  } else box(160, 50, 30, n(5, 9), n(1, 2), 1, '#9CC7F0');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#0E1A2B"/>${lines.join('')}</svg>`;
}

const ME = { employee_id: 'A476854', name: '설명회 데모', department: '구조시스템연구실', level: 2, wb_admin: false, status: 'active' };

let cache = null;
const cached = () => {
  if (!cache) cache = { graph: graph(), coverage: coverage() };
  return cache;
};

function route(method, url) {
  const u = new URL(url, 'http://demo.local');
  const path = u.pathname.replace(/^\/api/, '');
  const p = u.searchParams;
  if (path === '/auth/me') return [200, ME];
  if (path === '/graph') return [200, cached().graph];
  if (path === '/coverage') return [200, cached().coverage];
  if (path === '/similar' && method === 'GET') return similarToFile(Number(p.get('file_id')), p.has('zone') ? p.get('zone') : null);
  if (path === '/similar/bdf' && method === 'POST') return similarToUpload(p.get('name') || 'model.bdf', p.get('zone'));
  if (path === '/search') return [200, searchModels(p)];
  if (path === '/vocab') return [200, vocab(p.get('kind'))];
  const thumb = path.match(/^\/files\/(\d+)\/thumb\.png$/);
  if (thumb) return [200, new Blob([thumbSvg(FILE_BY_ID.get(Number(thumb[1])))], { type: 'image/svg+xml' })];
  return [404, { detail: 'demo_not_available' }];
}

/** window.fetch 를 감싼다 — /api 로 가는 요청만 가짜 서버가 받는다. */
export function installMockApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api')) return real(input, init);
    const [status, body] = route((init.method || 'GET').toUpperCase(), url);
    await new Promise((r) => setTimeout(r, 60));   // 실제처럼 잠깐 기다린다(스켈레톤이 한 번 보인다)
    if (body instanceof Blob) return new Response(body, { status, headers: { 'Content-Type': body.type } });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

export { DEMO_SIMILAR_FILE } from './data.js';

export const DEMO_STATS = {
  hulls: usedHulls().length,
  entries: ENTRIES.length,
  files: FILES.length,
  models: MODEL_FILES.length,
};
