/**
 * 설명회 데모(docs/demo) 예시 데이터 — 결정적 난수라 빌드할 때마다 같다. 실제 운영 데이터가 아니다.
 *
 * 모양은 실제 DB 를 흉내 낸다: 호선(PLM 선종·크기급) · 자료(호선·구역·대상·태그) · 파일(BDF 판·보고서 판) ·
 * BDF 특징(크기·요소 수·구성·단면·형상 서명) · 해석 검증 · 보고서가 사용한 모델 · 보고서 본문 유사도.
 * 서버 응답(/api/graph · /api/coverage · /api/similar · /api/search)은 mockApi.js 가 이 값으로 만든다.
 *
 * '쌓였을 때'를 보이는 것이 목적이라 지금 운영 자료보다 훨씬 많다(호선 30척 · 자료 약 400건 · 파일 약 1,100개).
 */

function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261020);
const pick = (a) => a[Math.floor(R() * a.length)];
const between = (a, b) => a + (b - a) * R();
const chance = (p) => R() < p;
const logN = (lo, hi) => Math.round(Math.exp(between(Math.log(lo), Math.log(hi))));
const pad = (n, w = 2) => String(n).padStart(w, '0');

/* ── 호선(PLM) ── kind = 선종(ship_kind), cap = 용량, raw = PLM 선형 원문 ── */
const SHIP_ROWS = [
  // LNG 운반선 174K — 자매선이 많아 표준 설계 재사용이 잘 드러난다
  ...['3204', '3266', '3370', '3496', '3542', '3611', '3702', '3820', '3901', '3955'].map((no) => [no, 'LNG', '174K']),
  ...['3988', '4012'].map((no) => [no, 'LNG', '200K']),
  ...['2981', '3455', '3688', '3912'].map((no) => [no, 'VLCC', '300K']),
  ...['3115', '3412', '3577'].map((no) => [no, 'C/V', '24000TEU']),
  ...['3745', '3866'].map((no) => [no, 'C/V', '13000TEU']),
  ...['3781', '3842', '3970'].map((no) => [no, 'LPG', '91K']),
  ...['3512', '3933'].map((no) => [no, 'PCTC', '7000']),
  ...['3321', '3856'].map((no) => [no, 'FPSO', null]),
  ['3640', 'FSRU', '170K'],
  ['3975', 'B/C', '180K'],
];
export const HULLS = SHIP_ROWS.map(([no, kind, cap], i) => ({
  no, kind, cap,
  raw: cap ? `${cap}-${kind}` : kind,
  ship_type: cap ? `${cap} ${kind}` : kind,
  size: cap ? `${cap}급 ${kind}` : null,
  // 오래된 호선일수록 자료가 많다(번호 순 = 대략 계약 순)
  maturity: 0.95 - (Number(no) - 2981) / 1400 + between(-0.08, 0.08),
  idx: i,
}));
const HULL = Object.fromEntries(HULLS.map((h) => [h.no, h]));

/* ── 구역(위치) · 대상(구조물) ── 통제 어휘 기본 목록(backend vocab.DEFAULTS) + 40 의 Unit · Truss ── */
export const ZONES = ['선수부', '선미부', '화물창', '기관실', '거주구', '상갑판', '이중저'];
export const TARGETS = ['전선 모델', '블록', '계류 의장품', '크레인 받침', '래싱 브리지', '해치 커버', '레이더 마스트',
  '연돌', '장비 받침', '권상 러그', '타', 'Unit', 'Truss'];

// 대상마다: 모델 종류(형상 생성) · 놓이는 구역(없으면 위치 없는 모델) · 선종별 빈도 · 표준 설계 재사용 여부
const TARGET_SPEC = {
  '전선 모델': { geom: 'global', zones: [], p: 0.55, std: false },
  '블록': { geom: 'plate', zones: ['화물창', '선수부', '선미부', '기관실', '이중저'], p: 0.9, std: false, many: 3 },
  '계류 의장품': { geom: 'fitting', zones: ['선수부', '선미부', '상갑판'], p: 0.85, std: true, many: 2 },
  '크레인 받침': { geom: 'frame', zones: ['상갑판'], p: 0.45, std: true, kinds: ['LNG', 'FPSO', 'FSRU', 'B/C', 'LPG'] },
  '래싱 브리지': { geom: 'frame', zones: ['상갑판', '화물창'], p: 0.95, std: true, kinds: ['C/V'], many: 2 },
  '해치 커버': { geom: 'plate', zones: ['화물창'], p: 0.9, std: true, kinds: ['C/V', 'B/C'] },
  '레이더 마스트': { geom: 'mast', zones: ['거주구'], p: 0.7, std: true },
  '연돌': { geom: 'plate', zones: ['거주구', '선미부'], p: 0.4, std: false },
  '장비 받침': { geom: 'frame', zones: ['기관실', '상갑판'], p: 0.6, std: false, many: 2 },
  '권상 러그': { geom: 'fitting', zones: ['화물창', '거주구'], p: 0.5, std: true },
  '타': { geom: 'plate', zones: ['선미부'], p: 0.35, std: false },
  'Unit': { geom: 'module', zones: [], p: 0.5, std: true, kinds: ['LNG', 'FPSO', 'FSRU', 'LPG'], many: 2 },
  'Truss': { geom: 'frame', zones: [], p: 0.55, std: true },
};

const PEOPLE = [
  ['A476854', '권혁민'], ['A102311', '김도윤'], ['A215507', '이서준'], ['A330918', '박지호'], ['A441203', '최민재'],
  ['A512776', '정하은'], ['A623104', '강예린'], ['A734450', '윤시우'], ['A845019', '장태현'], ['A956382', '임수빈'],
  ['B101772', '한지민'], ['B212068', '오세훈'], ['B323597', '서유나'], ['B434120', '문가람'],
];
export const PEOPLE_NAMES = Object.fromEntries(PEOPLE);
const FREE_TAGS = ['피로', '좌굴', '진동', 'GMU', 'Truss 자동', '선급 승인', '설계 변경', '하중 갱신', 'WorkBench'];

/* ── BDF 특징(선례 찾기·썸네일) ── */
const SECTIONS = {
  frame: ['L 100x100x10', 'L 130x130x12', 'L 150x90x12', 'H 200x200x8x12', 'H 300x300x10x15', 'BOX 200x200x10', 'PIPE 114.3x6', 'T 250x90x10x15'],
  plate: ['t8', 't10', 't12', 't14', 't16', 't20', 'FB 150x12', 'L 150x90x12', 'T 300x100x11x16'],
  fitting: ['t16', 't20', 't25', 't30', 'FB 200x15', 'PIPE 216.3x8'],
  module: ['H 200x200x8x12', 'H 300x300x10x15', 'H 400x200x8x13', 'PIPE 165.2x7', 'BOX 250x250x12', 't8', 't10', 't12'],
  mast: ['PIPE 165.2x7', 'PIPE 216.3x8', 'PIPE 114.3x6', 'L 100x100x10', 'L 75x75x9', 't10', 't12'],
  global: ['t12', 't14', 't16', 't18', 't20', 't22', 'L 250x90x10', 'T 450x150x11x20', 'FB 200x15'],
};
const DIMS = { frame: [[8, 30], [4, 14], [1.4, 4]], plate: [[8, 24], [6, 18], [2, 6]], fitting: [[0.8, 3], [0.6, 2], [0.4, 1.6]],
  module: [[12, 34], [9, 24], [7, 18]], mast: [[2, 4.5], [2, 4], [9, 26]], global: [[230, 340], [32, 60], [20, 32]] };
const ELEMS = { frame: [600, 6000], plate: [4000, 52000], fitting: [800, 9000], module: [3500, 36000], mast: [500, 3800], global: [120000, 420000] };
const MIX = { frame: [0.9, 0.0, 0.07, 0.03], plate: [0.22, 0.74, 0.03, 0.01], fitting: [0.05, 0.9, 0.04, 0.01],
  module: [0.58, 0.36, 0.04, 0.02], mast: [0.93, 0.03, 0.03, 0.01], global: [0.18, 0.8, 0.015, 0.005] };

let sigSeq = 0;
function makeGeom(geom) {
  const d = DIMS[geom].map(([a, b]) => +between(a, b).toFixed(2)).sort((a, b) => b - a);
  const elems = logN(...ELEMS[geom]);
  const m = MIX[geom].map((v) => Math.max(0, v + between(-0.05, 0.05)));
  const s = m.reduce((a, b) => a + b, 0);
  const pool = SECTIONS[geom];
  const n = Math.min(pool.length, 3 + Math.floor(R() * 4));
  const sections = [...pool].sort(() => R() - 0.5).slice(0, n).sort();
  return { geom, sig: `G${++sigSeq}`, dims: d, elems, mix: m.map((v) => +(v / s).toFixed(4)), sections,
    nodes: Math.round(elems * between(0.9, 1.25)), seed: Math.floor(R() * 1e6) };
}
/** 같은 설계를 다시 쓴 모델 — 형상 서명은 같고 크기·요소 수는 그대로, 하중·물성만 바뀐다. */
const variant = (g) => ({ ...g, seed: g.seed });

/* ── 자료 만들기 ── */
export const ENTRIES = [];   // { pk, id, title, hulls, no_hull, zones, target, free, uploaded_by, confirmed_at, files: [] }
export const FILES = [];     // { id, entry, name, kind, model?, solve?, rev? }
let ePk = 0;
let fId = 1000;
let eSeq = 1180;

function dateFor(h) {
  // 오래된 호선(maturity 큼)일수록 이른 날짜. 2023-01 ~ 2026-10
  const base = 2023 + Math.min(3, Math.floor((1 - (h?.maturity ?? 0.5)) * 3.4 + R() * 0.9));
  const mo = 1 + Math.floor(R() * (base === 2026 ? 10 : 12));
  return `${base}-${pad(mo)}`;
}

function addEntry({ hulls = [], no_hull = false, zones = [], target = null, free = [], title, date, uploader }) {
  const pk = ++ePk;
  const e = { pk, id: `E${pad(++eSeq, 6)}`, title, hulls, no_hull, zones, target, free,
    uploaded_by: uploader || pick(PEOPLE)[0], confirmed_at: date, files: [] };
  ENTRIES.push(e);
  return e;
}

function addModel(e, name, geomObj, { solve, sigs } = {}) {
  const f = { id: ++fId, entry: e, name, kind: 'model', model: geomObj,
    solve: solve ?? (chance(0.72) ? 'pass' : chance(0.35) ? 'fail' : null),
    // 같은 설계를 다시 쓴 모델은 하중이 늘 다르고, 물성·재료는 가끔 다르다(관계 지도의 '형상만 같음 — 하중 다름')
    sigs: sigs || { geometry: geomObj.sig, property: `P${geomObj.sig}-${chance(0.4) ? 1 : 0}`,
      material: chance(0.12) ? 'M2' : 'M1', load: `L${Math.floor(R() * 1e6)}` } };
  e.files.push(f);
  FILES.push(f);
  return f;
}

function addReport(e, name, extra = {}) {
  const f = { id: ++fId, entry: e, name, kind: 'report', ...extra };
  e.files.push(f);
  FILES.push(f);
  return f;
}

const STANDARD = new Map();   // `${선종}|${크기}|${대상}|${n}` → 표준 설계 형상
function standardFor(h, target, n) {
  const key = `${h.kind}|${h.cap}|${target}|${n}`;
  if (!STANDARD.has(key)) STANDARD.set(key, makeGeom(TARGET_SPEC[target].geom));
  return STANDARD.get(key);
}

const titleOf = (hullNos, zones, target, tail) => [hullNos.join('·'), ...zones, target, tail].filter(Boolean).join(' · ');

for (const h of HULLS) {
  for (const target of TARGETS) {
    const spec = TARGET_SPEC[target];
    if (spec.kinds && !spec.kinds.includes(h.kind)) continue;
    const reps = 1 + Math.floor(R() * ((spec.many || 1) + 1));   // 같은 대상을 여러 번(위치·하중 조건이 다른 모델)
    for (let k = 0; k < reps; k += 1) {
      if (!chance(Math.min(0.97, spec.p * (0.6 + h.maturity * 0.8)))) continue;
      // 구역·대상은 선택 칸(43) — 일부는 비워 둔다
      const zone = spec.zones.length ? pick(spec.zones) : null;
      const zones = zone && chance(0.93) ? [zone] : [];
      const tgt = chance(0.9) ? target : null;
      // 자매선 공동 해석(자료 하나에 호선 둘)
      const sister = chance(0.07) ? HULLS.find((o) => o !== h && o.kind === h.kind && o.cap === h.cap && R() < 0.5) : null;
      const hullNos = sister ? [h.no, sister.no] : [h.no];
      const tail = `M${pad(1 + Math.floor(R() * 12))}`;
      const free = chance(0.35) ? [pick(FREE_TAGS)] : [];
      const e = addEntry({ hulls: hullNos, zones, target: tgt, free, title: titleOf(hullNos, zones, tgt || target, tail), date: dateFor(h) });
      // BDF — 표준 설계(같은 선종·크기에서 다시 씀) 또는 새 설계
      const geo = spec.std && chance(0.62) ? variant(standardFor(h, target, k)) : makeGeom(spec.geom);
      const base = `${h.no}_${(tgt || target).replace(/\s/g, '')}_${tail}`;
      const revs = chance(0.22) ? 2 + Math.floor(R() * 2) : 1;
      for (let r = 0; r < revs; r += 1) {
        addModel(e, `${base}${r ? `_r${r}` : ''}.bdf`, r ? { ...geo, elems: Math.round(geo.elems * between(1, 1.15)) } : geo);
      }
      e.revisions = revs > 1 ? [{ count: revs, name: `${base}_r${revs - 1}.bdf` }] : [];
      // 보고서 — 대부분 하나, 일부는 판이 여럿, 일부는 없다(문서 없음 칸)
      if (chance(0.78)) {
        const rn = chance(0.2) ? 2 + Math.floor(R() * 2) : 1;
        const reps2 = [];
        for (let r = 0; r < rn; r += 1) {
          reps2.push(addReport(e, `${h.no} ${(tgt || target)} 강도 평가${r ? ` Rev.${r}` : ''}.pptx`, { uses: [e.files[0]], rev: r }));
        }
        if (rn > 1) {
          e.report_revisions = [{ count: rn, name: reps2[rn - 1].name,
            items: reps2.map((f, i) => ({ file_id: f.id, name: f.name, display: `R${i}`, is_latest: i === rn - 1 })),
            steps: reps2.slice(1).map(() => ({ changed: 1 + Math.floor(R() * 6), added: chance(0.4) ? 1 + Math.floor(R() * 3) : 0, removed: 0, overlap: +between(0.72, 0.94).toFixed(2) })) }];
        }
      }
    }
  }
}

// 똑같은 BDF 가 두 자료에 들어간 예외(업로드에서 막혔어야 할 것) — 몇 쌍
for (let i = 0; i < 4; i += 1) {
  const src = pick(FILES.filter((f) => f.kind === 'model' && f.entry.hulls.length && f.entry.target));
  const kindOf = (e) => HULL[e.hulls[0]]?.kind;
  // 같은 선종 · 같은 대상의 다른 자료에 같은 파일을 또 올린 경우(자매선 자료에 복사해 넣음)
  const other = pick(ENTRIES.filter((e) => e !== src.entry && e.hulls.length && e.target === src.entry.target
    && kindOf(e) === kindOf(src.entry) && e.files.some((f) => f.kind === 'model')) || [null]);
  if (!other) continue;
  const m = other.files.find((f) => f.kind === 'model');
  m.model = src.model;
  m.sigs = { ...src.sigs };
}

// 공용(호선 없음) — 표준 Truss · Unit · 권상 러그 같은 사내 표준 모델
for (const [target, n] of [['Truss', 5], ['Unit', 3], ['권상 러그', 3], ['계류 의장품', 2]]) {
  for (let k = 0; k < n; k += 1) {
    const e = addEntry({ no_hull: true, target, zones: [], free: ['표준'],
      title: `공용 · ${target} · 표준 ${String.fromCharCode(65 + k)}`, date: `202${3 + Math.floor(R() * 4)}-${pad(1 + Math.floor(R() * 9))}` });
    const geo = makeGeom(TARGET_SPEC[target].geom);
    addModel(e, `STD_${target.replace(/\s/g, '')}_${String.fromCharCode(65 + k)}.bdf`, geo, { solve: 'pass' });
    addReport(e, `표준 ${target} ${String.fromCharCode(65 + k)} 설계 지침.docx`, { uses: [e.files[0]], guide: true });
    e.revisions = [];
    // 표준을 가져다 쓴 호선 자료(같은 형상)
    for (const h of HULLS.filter(() => R() < 0.12)) {
      const u = addEntry({ hulls: [h.no], target, zones: [], title: titleOf([h.no], [], target, `표준 ${String.fromCharCode(65 + k)} 적용`), date: dateFor(h) });
      addModel(u, `${h.no}_${target.replace(/\s/g, '')}_STD${String.fromCharCode(65 + k)}.bdf`, variant(geo));
      u.revisions = [];
    }
  }
}

// 보고서만 있는 자료 — 여러 호선의 모델을 묶어 본 종합 검토서(문서 → 모델 '사용한 모델' 선)
const REVIEWS = [
  ['174K LNG 계류 의장품 표준화 검토', (e) => HULL[e.hulls[0]]?.kind === 'LNG' && HULL[e.hulls[0]]?.cap === '174K' && e.target === '계류 의장품'],
  ['컨테이너선 래싱 브리지 피로 종합', (e) => HULL[e.hulls[0]]?.kind === 'C/V' && e.target === '래싱 브리지'],
  ['레이더 마스트 진동 사례 모음', (e) => e.target === '레이더 마스트'],
  ['VLCC 블록 권상 해석 정리', (e) => HULL[e.hulls[0]]?.kind === 'VLCC' && (e.target === '블록' || e.target === '권상 러그')],
  ['FPSO Unit 해상 운송 검토', (e) => HULL[e.hulls[0]]?.kind === 'FPSO' && e.target === 'Unit'],
  ['Truss 자동 해석 결과 비교', (e) => e.target === 'Truss'],
  ['해치 커버 강도 기준 비교', (e) => e.target === '해치 커버'],
];
for (const [name, match] of REVIEWS) {
  const used = ENTRIES.filter((e) => match(e) && e.files.some((f) => f.kind === 'model')).slice(0, 9);
  if (!used.length) continue;
  const e = addEntry({ no_hull: !used[0].hulls.length, hulls: used[0].hulls.length ? [used[0].hulls[0]] : [],
    target: used[0].target, zones: [], free: ['종합 검토'], title: name, date: `2026-${pad(2 + Math.floor(R() * 8))}` });
  addReport(e, `${name}.docx`, { uses: used.map((u) => u.files.find((f) => f.kind === 'model')), review: used });
  e.revisions = [];
}

ENTRIES.sort((a, b) => (b.confirmed_at || '').localeCompare(a.confirmed_at || ''));

/* ── 파생: 보고서 본문 유사도(같은 대상·다른 호선 보고서끼리) ── */
export const TEXT_PAIRS = [];
{
  const reps = FILES.filter((f) => f.kind === 'report');
  const byTarget = new Map();   // 같은 대상 · 같은 선종 보고서끼리(다른 선종까지 이으면 지도가 엉킨다)
  for (const f of reps) {
    const t = `${f.entry.target || '기타'}|${HULL[f.entry.hulls[0]]?.kind || '공용'}`;
    if (!byTarget.has(t)) byTarget.set(t, []);
    byTarget.get(t).push(f);
  }
  for (const list of byTarget.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < Math.min(list.length, i + 4); j += 1) {
        if (list[i].entry === list[j].entry || !chance(0.18)) continue;
        TEXT_PAIRS.push([list[i], list[j], +between(0.62, 0.91).toFixed(3)]);
      }
    }
  }
}

// 최근 확정 순(기준 BDF 고르기 '최근 올린 BDF')
export const MODEL_FILES = FILES.filter((f) => f.kind === 'model')
  .sort((a, b) => (b.entry.confirmed_at || '').localeCompare(a.entry.confirmed_at || '') || b.id - a.id);
/** 선례 찾기 첫 화면의 기준 — 174K LNG 계류 의장품 표준 설계를 다시 쓴 모델(같은 설계가 여러 척에 있다). */
export const DEMO_SIMILAR_FILE = (() => {
  const cnt = new Map();
  for (const f of FILES) if (f.kind === 'model') cnt.set(f.sigs.geometry, (cnt.get(f.sigs.geometry) || 0) + 1);
  const pickFrom = FILES.filter((f) => f.kind === 'model' && f.entry.target === '계류 의장품' && HULL[f.entry.hulls[0]]?.cap === '174K')
    .sort((a, b) => cnt.get(b.sigs.geometry) - cnt.get(a.sigs.geometry));
  return pickFrom[0]?.id ?? FILES.find((f) => f.kind === 'model').id;
})();
export const FILE_BY_ID = new Map(FILES.map((f) => [f.id, f]));
export const HULL_BY_NO = HULL;

/* ── 보고서 본문(문서 화면 · 근거 요약) ──
 * 실제 색인처럼 슬라이드(slide:N) · 문단(paragraph:N) 조각으로 둔다. 숫자는 결정적 난수라 매번 같다.
 * 대상마다 쓰는 낱말(볼라드 SWL · 래싱 하중 · 크레인 SWL · 좌굴 · 피로 …)을 달리해 검색이 의미 있게 갈리게 한다.
 */
const LOAD_WORDS = {
  '계류 의장품': ['볼라드 SWL', '계류줄 파단 하중(MBL)', 'OCIMF 지침'],
  '래싱 브리지': ['래싱 하중', '컨테이너 적재 하중', '횡동요 가속도'],
  '크레인 받침': ['크레인 SWL', '선회 모멘트', '동적 계수 1.3'],
  '레이더 마스트': ['풍하중', '고유 진동수', '기관 가진'],
  '해치 커버': ['화물 하중', '해수 압력', '처짐 한도'],
  '블록': ['블록 권상 하중', '러그 위치', '자중'],
  '권상 러그': ['권상 하중', '러그 판 두께', '와이어 각도'],
  '장비 받침': ['장비 자중', '진동 하중', '볼트 반력'],
  '연돌': ['풍하중', '배기 온도', '열팽창'],
  '타': ['타 직압력', '타두재 모멘트', '선속'],
  'Unit': ['해상 운송 가속도', '리프팅 하중', '설치 하중'],
  'Truss': ['자중', '작업 하중', '좌굴'],
  '전선 모델': ['정수 중 굽힘 모멘트', '파랑 하중', '종강도'],
};
const CLASSES = ['DNV', 'ABS', 'LR', 'BV', 'KR'];
const fix1 = (v) => (Math.round(v * 100) / 100).toFixed(2);
/** 받침이 있으면 a, 없으면 b(한글이 아니면 b) — '의장품과', '마스트와' */
const josa = (word, a, b) => {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  return word + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b);
};
for (const f of FILES) {
  if (f.kind !== 'report') continue;
  const e = f.entry;
  const h = HULL[e.hulls[0]];
  const tgt = e.target || '구조';
  const words = LOAD_WORDS[tgt] || ['설계 하중', '자중', '작업 하중'];
  const allow = pick([175, 235, 245, 275, 315]);
  const use = between(0.62, 0.98);
  const stress = Math.round(allow * use);
  const buckle = between(0.55, 0.95);
  const cls = pick(CLASSES);
  const zone = e.zones[0] ? `${e.zones[0]} ` : '';
  const ship = h ? `${h.no}호선(${h.ship_type})` : '공용 표준';
  const weak = use > 0.9;
  f.author = PEOPLE_NAMES[e.uploaded_by] || '구조시스템연구실';
  f.created = `${e.confirmed_at}-${pad(5 + Math.floor(R() * 20))}`;
  if (f.review) {
    // 종합 검토서(문단 단위) — 여러 자료의 결과를 모아 비교한다
    const rows = f.review.map((u) => `${u.hulls[0] || '공용'}호선 ${u.title.split(' · ').slice(1).join(' · ')}: 사용률 ${fix1(between(0.6, 0.97))}`);
    f.docType = '기술 검토';
    f.chunks = [
      { locator: 'paragraph:1', text: `${e.title}. 목적: 여러 호선에서 반복된 ${tgt} 해석 결과를 한데 모아 설계 기준과 반복 문제를 정리한다.` },
      { locator: 'paragraph:2', text: `검토 대상 자료 ${f.review.length}건. ${rows.slice(0, 5).join('. ')}.` },
      { locator: 'paragraph:3', text: `공통 결과: ${words[0]} 조건이 지배 하중이며, 사용률이 0.9 를 넘는 사례는 대부분 ${zone || '보강재 끝단 '}응력 집중부에서 나왔다. 보강재 끝단 형상을 표준 상세로 바꾸면 사용률이 평균 0.12 낮아졌다.` },
      { locator: 'paragraph:4', text: `권고: 같은 선종 후속선은 표준 설계를 그대로 쓰되, ${words[1]} 값이 바뀌면 다시 해석한다. 피로 평가는 이 검토 범위가 아니며 별도 보고서로 다룬다.` },
    ];
    continue;
  }
  if (f.guide) {
    f.docType = '지침';
    f.chunks = [
      { locator: 'paragraph:1', text: `${f.name.replace('.docx', '')}. 적용 범위: 사내 표준 ${tgt} 상세의 해석 모델 구성·하중·판정 기준.` },
      { locator: 'paragraph:2', text: `모델: 보 요소와 쉘 요소를 함께 쓰고, 경계조건은 갑판 접합부 절점 고정. ${josa(words.join(' · '), '을', '를')} 하중 조건으로 둔다.` },
      { locator: 'paragraph:3', text: `판정: 허용 응력 ${allow} MPa(${cls} 규칙), 좌굴 사용률 1.0 이하. 사용률 0.9 이상이면 보강 검토를 권한다.` },
    ];
    continue;
  }
  f.docType = null;   // .pptx — 문서 분류 '발표자료'로 자동 추정(서버와 같다)
  f.titles = ['목적', '해석 모델', '하중 조건', '해석 결과', '결론 및 제한사항'];
  f.chunks = [
    { locator: 'slide:1', text: `${ship} ${zone}${tgt} 강도 평가${f.rev ? ` (Rev.${f.rev})` : ''}\n목적: ${words[0]} 조건에서 ${josa(tgt, '과', '와')} 지지 구조의 강도를 확인한다. 적용 규칙 ${cls}.` },
    { locator: 'slide:2', text: `해석 모델: ${f.uses?.[0]?.name || 'BDF'}\n요소 ${(f.uses?.[0]?.model?.elems || logN(2000, 40000)).toLocaleString('ko-KR')}개(보·쉘), 경계조건은 갑판 접합부 고정. SOL 101 선형 정적 해석.` },
    { locator: 'slide:3', text: `하중 조건: LC1 ${words[0]}, LC2 ${words[1]}, LC3 ${words[2]}. 하중 계수 1.0(사용 하중) 기준.` },
    { locator: 'slide:4', text: `해석 결과: 최대 von Mises 응력 ${stress} MPa (허용 응력 ${allow} MPa), 사용률 ${fix1(use)}. 좌굴 사용률 ${fix1(buckle)}.${weak ? ' 사용률 0.9 초과 — 보강재 끝단 응력 집중.' : ''}` },
    { locator: 'slide:5', text: `결론: ${weak ? `보강재 끝단에 브래킷을 추가하는 보강안을 제안한다(보강 후 사용률 ${fix1(use - 0.14)}).` : '모든 하중 조건에서 허용 기준을 만족한다.'} 제한사항: 피로·진동은 이 보고서 범위가 아니다.` },
    { locator: 'notes:4', text: `발표자 노트: 최대 응력 위치는 ${zone || ''}${tgt} 하부 보강재 끝단. ${weak ? '설계팀에 보강 요청함.' : '추가 조치 없음.'}` },
  ];
}
