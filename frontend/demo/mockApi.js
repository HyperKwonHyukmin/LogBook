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
  const targetCount = new Map();
  const entries = ENTRIES.map((e) => {
    e.zones.forEach((z) => zoneCount.set(z, (zoneCount.get(z) || 0) + 1));
    if (e.target) targetCount.set(e.target, (targetCount.get(e.target) || 0) + 1);
    const ms = models(e);
    const states = ms.map((m) => m.solve).filter(Boolean);
    const solve = !ms.length ? null : states.includes('pass') ? 'pass'
      : (states.length === ms.length && states.every((s) => s === 'fail')) ? 'fail' : 'none';
    return {
      id: e.id, title: e.title,
      rows: [...e.hulls.map((h) => `h:${h}`), ...(e.no_hull ? ['c:공용'] : [])],
      zones: e.zones, target: e.target || null, models: ms.length, reports: reports(e).length,
      doc_linked: linkedModels.has(e.pk), model_linked: linkedDocs.has(e.pk), solve,
      needs_fix: ms.length > 0 && !e.hulls.length && !e.no_hull, unsigned: false,
      uploaded_by: e.uploaded_by, uploader_name: PEOPLE_NAMES[e.uploaded_by] || null, confirmed_at: e.confirmed_at,
    };
  });
  const hulls = usedHulls();
  return {
    entries,
    hulls: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.ship_type ?? null])),
    hull_kinds: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.kind ?? null])),
    hull_sizes: Object.fromEntries(hulls.map((h) => [h, HULL_BY_NO[h]?.size ?? null])),
    zones: [...zoneCount.keys()].sort((a, b) => zoneCount.get(b) - zoneCount.get(a) || a.localeCompare(b)),
    targets: [...targetCount.keys()].sort((a, b) => targetCount.get(b) - targetCount.get(a) || a.localeCompare(b)),   // 44
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


/* ── 문서 화면(21·22) — 본문 검색 · 위치 발췌 · 미리보기 · 근거 요약 ──
 * backend report_index/search.py 의 규칙을 줄여 옮겼다: 검색어(모든 단어 · 하나 이상 · 문구), 제목·자료 정보 + 본문 조각,
 * 쪽·슬라이드 위치 발췌(강조 위치), 의미 추천(같은 대상의 다른 보고서를 관련 후보로). 근거 요약은 LLM 대신 미리 만든 예시.
 */
const REPORTS = FILES.filter((f) => f.kind === 'report');
const NONE_TYPE = '__none__';
// 의미 추천에서 '가까운' 대상 — 같은 국부 강도 문제를 다루는 구조물끼리
const NEAR = { '계류 의장품': ['권상 러그', '장비 받침'], '권상 러그': ['계류 의장품', '블록'], '래싱 브리지': ['해치 커버'],
  '해치 커버': ['래싱 브리지'], '레이더 마스트': ['연돌'], '연돌': ['레이더 마스트'], '크레인 받침': ['장비 받침'],
  '장비 받침': ['크레인 받침'], 'Unit': ['Truss'], 'Truss': ['Unit'], '블록': ['권상 러그'] };
const DOC_TYPES = ['해석 보고서', '연구 보고서', '시험 보고서', '기술 검토', '지침', '발표자료', '회의자료', '계산서', '기타'];
const DOC_GROUPS = [
  { key: 'report', label: '보고서', values: ['해석 보고서', '연구 보고서', '시험 보고서', '기술 검토', '지침'] },
  { key: 'presentation', label: '발표자료', values: ['발표자료', '회의자료'] },
  { key: 'other', label: '기타', values: ['계산서', '기타', NONE_TYPE] },
];
const norm = (t) => String(t || '').normalize('NFKC').toLowerCase();
const docTypeOf = (f) => (f.docType ? [f.docType, false] : /\.pptx?$/i.test(f.name) ? ['발표자료', true] : [null, false]);
const scopeOf = (e) => (e.hulls.length ? 'hull' : e.no_hull ? 'reference' : 'unclassified');
const relatedModels = (f) => {
  const out = new Map();
  for (const m of f.uses || []) {
    if (m) out.set(m.id, { file_id: m.id, name: m.name, relation: m.entry === f.entry ? 'same_entry' : 'explicit', entry_id: m.entry.id });
  }
  for (const m of models(f.entry)) if (!out.has(m.id)) out.set(m.id, { file_id: m.id, name: m.name, relation: 'same_entry', entry_id: f.entry.id });
  return [...out.values()];
};
const metaText = (f) => norm([f.name, f.entry.title, docTypeOf(f)[0], ...f.entry.hulls, ...(f.entry.free || [])].join(' '));
function queryTerms(q, mode) {
  const t = norm(q).trim();
  if (!t) return [];
  if (mode === 'phrase') return [t];
  return [...t.matchAll(/"([^"\n]+)"|([^\s"]+)/g)].map((m) => m[1] || m[2]);
}
/** 발췌 — 첫 일치 앞뒤로 자르고, 일치한 낱말 위치를 준다(화면 highlightParts 와 같은 셈, 한글은 코드 포인트 = 글자). */
function snippetOf(text, terms) {
  const chars = Array.from(text);
  const low = norm(text);
  let first = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  const start = Math.max(0, first < 0 ? 0 : first - 40);
  const piece = chars.slice(start, start + 150).join('');
  const lp = norm(piece);
  const marks = [];
  for (const t of terms) {
    let i = lp.indexOf(t);
    while (i >= 0) { marks.push([i, i + t.length]); i = lp.indexOf(t, i + t.length); }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else merged.push([...m]);
  }
  const lead = start > 0 ? 1 : 0;
  return { text: (lead ? '…' : '') + piece + (start + 150 < chars.length ? '…' : ''),
    highlights: merged.map(([a, b]) => [a + lead, b + lead]) };
}
function reportItem(f) {
  const [type, auto] = docTypeOf(f);
  return { file_id: f.id, name: f.name, entry_id: f.entry.id, entry_title: f.entry.title, hulls: f.entry.hulls,
    no_hull: f.entry.no_hull, scope: scopeOf(f.entry), document_type: type, document_type_auto: auto,
    model_count: relatedModels(f).length, posted_at: `${f.created || f.entry.confirmed_at}T09:00:00`,
    snippets: [], index_state: null, match_type: null, score: 0, can_edit: false };
}
function listReports(p) {
  const q = p.get('q') || '';
  const mode = p.get('mode') || 'and';
  const hybrid = p.get('retrieval') === 'hybrid';
  const terms = queryTerms(q, mode);
  const sort = p.get('sort') || (terms.length ? 'relevance' : 'recent');
  const limit = Number(p.get('limit') || 50);
  const offset = Number(p.get('offset') || 0);
  const want = { scope: p.getAll('scope').filter(Boolean), document_type: p.getAll('document_type').filter(Boolean),
    model: p.getAll('model').filter(Boolean) };
  let rows = REPORTS.map((f) => ({ f, item: reportItem(f) }));
  if (terms.length) {
    const hit = [];
    for (const r of rows) {
      const meta = metaText(r.f);
      const chunks = r.f.chunks || [];
      const has = (t) => meta.includes(t) || chunks.some((c) => norm(c.text).includes(t));
      const n = terms.filter(has).length;
      if (mode === 'or' ? n === 0 : n < terms.length) continue;
      const found = chunks.filter((c) => terms.some((t) => norm(c.text).includes(t)));
      Object.assign(r.item, { match_type: 'keyword', score: n + found.length * 0.1,
        snippets: found.slice(0, 3).map((c) => ({ file_id: r.f.id, name: r.f.name, locator: c.locator, ...snippetOf(c.text, terms) })) });
      hit.push(r);
    }
    let semantic = [];
    if (hybrid) {
      // 의미 추천 — 키워드에 안 걸렸지만 같은·가까운 대상을 다룬 보고서(실제는 벡터 유사도 임계값 이상)
      const targets = new Set(hit.slice(0, 20).flatMap((r) => [r.f.entry.target, ...(NEAR[r.f.entry.target] || [])]).filter(Boolean));
      const got = new Set(hit.map((r) => r.f.id));
      semantic = rows.filter((r) => !got.has(r.f.id) && targets.has(r.f.entry.target)).slice(0, 10).map((r, i) => {
        const c = (r.f.chunks || [])[0];
        Object.assign(r.item, { match_type: 'semantic', score: 0.82 - i * 0.02,
          snippets: c ? [{ file_id: r.f.id, name: r.f.name, locator: c.locator, ...snippetOf(c.text, []) }] : [] });
        return r;
      });
    }
    rows = [...hit, ...semantic];
  }
  const facetOf = (r) => ({ scope: r.item.scope, document_type: r.item.document_type || NONE_TYPE, model: r.item.model_count ? 'yes' : 'no' });
  const passes = (r, skip) => Object.entries(want).every(([k, vs]) => k === skip || !vs.length || vs.includes(facetOf(r)[k]));
  const passed = rows.filter((r) => passes(r));
  if (sort === 'title') passed.sort((a, b) => a.item.name.localeCompare(b.item.name));
  else if (sort === 'recent') passed.sort((a, b) => b.item.posted_at.localeCompare(a.item.posted_at));
  else passed.sort((a, b) => (a.item.match_type !== 'keyword') - (b.item.match_type !== 'keyword') || b.item.score - a.item.score);
  const count = (key) => {
    const c = {};
    for (const r of rows.filter((x) => passes(x, key))) { const v = facetOf(r)[key]; c[v] = (c[v] || 0) + 1; }
    return c;
  };
  const types = count('document_type');
  const out = {
    total: passed.length, items: passed.slice(offset, offset + limit).map((r) => r.item),
    scopes: count('scope'),
    document_types: Object.fromEntries(Object.entries(types).map(([k, v]) => [k === NONE_TYPE ? '' : k, v])),
    applied: Object.fromEntries(Object.entries(want).filter(([, v]) => v.length)),
    index_available: true, document_type_options: DOC_TYPES, document_type_groups: DOC_GROUPS,
  };
  if (terms.length) {
    Object.assign(out, { keyword_total: passed.filter((r) => r.item.match_type === 'keyword').length,
      semantic_total: passed.filter((r) => r.item.match_type === 'semantic').length, semantic_available: true,
      semantic_error: null, semantic_limit: 10, semantic_exhaustive: false });
  }
  return out;
}
function reportCatalog(fileId) {
  const f = FILE_BY_ID.get(fileId);
  if (!f || f.kind !== 'report') return [404, { detail: 'report_not_found' }];
  const [type, auto] = docTypeOf(f);
  return [200, { file_id: f.id, entry_id: f.entry.id, entry_title: f.entry.title, scope: scopeOf(f.entry), hulls: f.entry.hulls,
    document_type: type, document_type_auto: auto, can_edit: false, version: 1, related_models: relatedModels(f) }];
}
function fileOut(f) {
  const slides = /\.pptx?$/i.test(f.name);
  return { id: f.id, name: f.name, rel_path: `files/${f.name}`, kind: f.kind, size: 180000 + (f.id % 97) * 41000,
    location: 'vault', drm_encrypted: false,
    extract: f.kind === 'report' ? { state: 'done', error: null, summary: {
      title: f.name.replace(/\.\w+$/, ''), author: f.author, created: f.created,
      count: (f.chunks || []).filter((c) => !c.locator.startsWith('notes')).length, unit: slides ? 'slide' : 'paragraph',
      slide_titles: f.titles || [] } } : null };
}
function entryOut(id) {
  const e = ENTRIES.find((x) => x.id === id);
  if (!e) return [404, { detail: 'entry_not_found' }];
  return [200, { entry_id: e.id, title: e.title, status: 'confirmed', hulls: e.hulls.map((h) => ({ hull_no: h })),
    vault_unc: `\\\\storage.hpc.hd.com\\999_LogBook\\vault\\${(e.confirmed_at || '2026').slice(0, 4)}\\${e.id}`,
    files: e.files.map(fileOut) }];
}
function fileText(fileId) {
  const f = FILE_BY_ID.get(fileId);
  if (!f) return [404, { detail: 'file_not_found' }];
  return [200, { state: 'done', error: null, summary: fileOut(f).extract?.summary || null, chunks: f.chunks || [] }];
}
/**
 * 근거 요약 — 데모에는 LLM 이 없어 그 보고서의 발췌문을 엮어 미리 만든 예시 답변을 준다.
 * 실제(/api/reports/answer)는 사내 Ollama 가 같은 발췌문만 근거로 답하고, 답 속 [S1] 번호가 준 발췌문인지 확인한다.
 */
function reportAnswer(body) {
  const f = FILE_BY_ID.get((body?.file_ids || [])[0]);
  if (!f || !(f.chunks || []).length) return [422, { detail: 'no_indexed_sources' }];
  const cs = f.chunks.filter((c) => !c.locator.startsWith('notes')).map((c, i) => ({ id: `S${i + 1}`, file_id: f.id, name: f.name,
    entry_id: f.entry.id, locator: c.locator, text: c.text }));
  const lastLine = (c) => (c?.text || '').split('\n').slice(-1)[0];
  const body1 = (c) => lastLine(c).replace(/^[^:]{1,12}: ?/, '').replace(/\.$/, '');
  const by = (re) => cs.find((c) => re.test(c.text)) || cs[cs.length - 1];
  const purpose = cs[0];
  const result = by(/해석 결과|판정|공통 결과/);
  const end = by(/결론|권고/);
  const answer = [
    '[설명회 데모] 미리 만든 예시 답변입니다. 실제 LogBook 은 사내 LLM 이 아래 발췌문만 근거로 답을 만듭니다.',
    '',
    `목적: ${body1(purpose)}. [${purpose.id}]`,
    `주요 결과: ${body1(result)}. [${result.id}]`,
    `결론·제한사항: ${body1(end)}. [${end.id}]`,
  ].join('\n');
  const used = new Set([purpose.id, result.id, end.id]);
  return [200, { answer, citations: cs.filter((c) => used.has(c.id)), truncated: false,
    scope_note: '색인된 보고서의 선택된 발췌문을 근거로 생성한 답변입니다.' }];
}

const ME = { employee_id: 'A476854', name: '설명회 데모', department: '구조시스템연구실', level: 2, wb_admin: false, status: 'active' };

let cache = null;
const cached = () => {
  if (!cache) cache = { graph: graph(), coverage: coverage() };
  return cache;
};

const bodyOf = (init) => { try { return JSON.parse(init?.body || 'null'); } catch { return null; } };

function route(method, url, init) {
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
  if (path === '/reports' && method === 'GET') return [200, listReports(p)];
  if (path === '/reports/index-status') {
    const n = REPORTS.length;
    return [200, { total: n, ready: n, pending: 0, failed: 0, partial: 0, stale: 0, missing: 0,
      last_updated: '2026-10-20T06:00:00+00:00', embedding_available: true, embedding_ready: n, index_available: true }];
  }
  if (path === '/reports/answer' && method === 'POST') return reportAnswer(bodyOf(init));
  const cat = path.match(/^\/reports\/(\d+)\/catalog$/);
  if (cat && method === 'GET') return reportCatalog(Number(cat[1]));
  const ent = path.match(/^\/entries\/([^/]+)$/);
  if (ent && method === 'GET') return entryOut(decodeURIComponent(ent[1]));
  const txt = path.match(/^\/files\/(\d+)\/text$/);
  if (txt) return fileText(Number(txt[1]));
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
    const [status, body] = route((init.method || 'GET').toUpperCase(), url, init);
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
  reports: FILES.filter((f) => f.kind === 'report').length,
};
