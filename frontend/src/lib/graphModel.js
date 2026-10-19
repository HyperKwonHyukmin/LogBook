/**
 * 관계 지도(25) — /api/graph 응답을 지도용 모델로 바꾸는 순수 함수.
 *
 * 점은 두 종류다. 기준 점(호선·구역·선종·크기급·자유 태그 값 하나)과 자료 점(확정 Entry 하나).
 * 고른 기준(pivot)의 값마다 기준 점이 생기고 자료가 그 둘레에 앉는다. 기준 값이 없는 자료는 '○○ 없음' 점 하나로 모은다.
 * 기준 점끼리의 굵은 곡선(aggregate) = 두 기준에 함께 등록된 자료 + 형상만 같은 BDF 쌍 + 똑같은 BDF 쌍
 * (+ 32 문서 관계: 사용한 모델 · 같은 보고서의 다른 판 · 본문 비슷함).
 *
 * 32 — 자료 사이 선은 두 층이다. 모델 층(pairs: geom·dup)과 문서 층(docPairs: uses·rrev·text).
 * 보기 층(layer: model | doc | all)에 따라 pairsOf 가 고른다 — 보고서만 있는 자료도 문서 층으로 이어진다.
 */
// 29 — 프로젝트 기준은 없앴다. 35 — 선종(LNG·VLCC)·크기급(174K급 LNG = 용량 + 선종)은 자료의 호선들에서 모은다.
// 용량만으로는 묶지 않는다 — 단위가 선종마다 다르다(LNG m³ · VLCC/B·C DWT · CNTR TEU). 같은 174K 라도 선종이 다르면 다른 크기급.
export const GROUP = { hull: '호선', zone: '구역', kind: '선종', size: '크기급', free: '자유 태그' };
export const JOSA = { hull: '이', zone: '이', kind: '이', size: '이', free: '가' };
export const PIVOTS = ['hull', 'zone', 'kind', 'size'];
export const GROUP_KEYS = ['hull', 'zone', 'kind', 'size', 'free'];
const FIELD = { hull: 'hulls', zone: 'zones', free: 'free' };
/** 자료의 기준 값 — 선종·크기급은 호선마다의 값을 겹치지 않게 모은다(호선 순서 = 주 호선 먼저). */
function valuesOf(e, g, kinds, sizes) {
  if (g === 'kind' || g === 'size') {
    const of = g === 'kind' ? kinds : sizes;
    return [...new Set((e.hulls || []).map((h) => of[h]).filter(Boolean))];
  }
  return e[FIELD[g]] || [];
}
export const DIFF_LABEL = { property: '물성', material: '재료', load: '하중' };
export const LAYERS = ['model', 'doc', 'all'];
export const PAIR_LABEL = {
  geom: '형상만 같음', dup: '똑같은 BDF', uses: '사용한 모델', rrev: '보고서 다른 판', text: '본문 비슷함',
};
const DOC_TYPES = ['uses', 'rrev', 'text'];
export const isDocPair = (p) => DOC_TYPES.includes(p.type);
/** 늘 그리는 선(예외·정리 신호) — 나머지는 초점에 닿을 때·올렸을 때·'늘 보기'. */
export const isLoudPair = (p) => p.type === 'dup' || p.type === 'rrev';
export const pairsOf = (model, layer = 'all') => (layer === 'model' ? model.pairs
  : layer === 'doc' ? model.docPairs : [...model.pairs, ...model.docPairs]);
/** 모델 없이 보고서만 있는 자료 — 지도에서 속이 빈 점. */
export const isReportOnly = (e) => !e.raw.models && e.raw.reports > 0;

// 자료 점 색(해석 종류·선종) — 많은 값 8개만 색을 주고 나머지는 회색
export const PALETTE = ['#4B78C2', '#2F8A74', '#BE6A3E', '#8065B5', '#AE5279', '#8A7A2E', '#3E8FA8', '#9A5B3C'];
export const OTHER_COLOR = '#9AA1AB';

function palette(entries, key) {
  const counts = new Map();
  for (const e of entries) if (e[key]) counts.set(e[key], (counts.get(e[key]) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PALETTE.length);
  const color = new Map(top.map(([k], i) => [k, PALETTE[i]]));
  const items = top.map(([k, n]) => ({ label: k, color: color.get(k), count: n }));
  const rest = entries.filter((e) => !color.has(e[key])).length;
  if (rest) items.push({ label: '기타·없음', color: OTHER_COLOR, count: rest });
  return { colorOf: (e) => color.get(e[key]) || OTHER_COLOR, items };
}

export function buildModel(data) {
  const ships = data?.hulls || {};
  const kinds = data?.hull_kinds || {};
  const sizes = data?.hull_sizes || {};
  const hubs = new Map();
  const hub = (g, v) => {
    const id = `${g}:${v}`;
    let h = hubs.get(id);
    if (!h) {
      h = { id, g, label: v, hub: true, cnt: 0 };
      if (g === 'hull') h.ship = ships[v] || null;
      hubs.set(id, h);
    }
    return h;
  };
  const entries = (data?.entries || []).map((e) => {
    const n = { id: `e:${e.id}`, eid: e.id, label: e.title || e.id, raw: e, atype: e.analysis_type || null,
      ship: e.hulls?.[0] ? ships[e.hulls[0]] || null : null, of: {} };
    for (const g of GROUP_KEYS) {
      n.of[g] = valuesOf(e, g, kinds, sizes).map((v) => hub(g, v));
      n.of[g].forEach((h) => { h.cnt += 1; });
    }
    return n;
  });
  const NONE = {};
  for (const g of PIVOTS) {
    NONE[g] = { id: `${g}:__none`, g, label: `${GROUP[g]} 없음`, hub: true, none: true,
      cnt: entries.filter((e) => !e.of[g].length).length };
  }
  const byEid = new Map(entries.map((e) => [e.eid, e]));
  const link = (p) => ({ ...p, a: byEid.get(p.a), b: byEid.get(p.b), from: p.from ? byEid.get(p.from) : undefined });
  const pairs = (data?.pairs || []).map(link).filter((p) => p.a && p.b);
  const docPairs = (data?.doc_pairs || []).map(link).filter((p) => p.a && p.b);
  const byId = new Map([...hubs.values(), ...Object.values(NONE), ...entries].map((n) => [n.id, n]));
  return {
    entries, hubs, NONE, pairs, docPairs, byId,
    colors: { atype: palette(entries, 'atype'), ship: palette(entries, 'ship') },
    unsigned: data?.unsigned_models || 0, truncated: !!data?.truncated,
    docIndex: data?.doc_index || null,
  };
}

export const isMember = (e, h) => (h.none ? !e.of[h.g].length : e.of[h.g].includes(h));
export const parentsOf = (model, e, pivot) => (e.of[pivot].length ? e.of[pivot] : [model.NONE[pivot]]);
export const primaryOf = (model, e, pivot) => e.of[pivot][0] || model.NONE[pivot];
export const membersOf = (model, h) => model.entries.filter((e) => isMember(e, h));
export const pivotHubs = (model, pivot) => {
  const hs = [...model.hubs.values()].filter((h) => h.g === pivot && h.cnt > 0);
  if (model.NONE[pivot].cnt) hs.push(model.NONE[pivot]);
  return hs;
};

/** 기준 점 사이 관계 — {a, b, c(합), span, geom, dup, uses, rrev, text}. 같은 기준 안의 자료 쌍은 세지 않는다. */
export function aggregate(model, pivot, layer = 'all') {
  const m = new Map();
  const add = (a, b, kind) => {
    if (a === b) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}|${y.id}`;
    const v = m.get(key) || { a: x, b: y, c: 0, span: 0, geom: 0, dup: 0, uses: 0, rrev: 0, text: 0 };
    v.c += 1; v[kind] += 1; m.set(key, v);
  };
  for (const e of model.entries) {
    const ps = e.of[pivot];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) add(ps[i], ps[j], 'span');
  }
  for (const p of pairsOf(model, layer)) add(primaryOf(model, p.a, pivot), primaryOf(model, p.b, pivot), p.type);
  return [...m.values()];
}

// ── 설명 문장 ──
export const diffWords = (d) => `${d.map((x) => DIFF_LABEL[x] || x).join('·')}${d.length === 1 ? '만' : '이'}`;
export const diffShort = (d) => (d?.length ? `${diffWords(d)} 다름` : '모두 같음');
export const aggText = (a) => [a.span && `함께 등록 ${a.span}`,
  ...['geom', 'dup', 'uses', 'rrev', 'text'].map((t) => a[t] && `${PAIR_LABEL[t]} ${a[t]}`)]
  .filter(Boolean).join(' · ');

export function explainAgg(a, pivot) {
  const lines = [`${a.a.label} ↔ ${a.b.label} · 관계 ${a.c}건`];
  if (a.span) lines.push(`· 두 ${GROUP[pivot]}에 함께 등록된 자료 ${a.span}건`);
  if (a.geom) lines.push(`· 형상이 같은 BDF ${a.geom}쌍 — 한쪽 모델을 가져다 물성·하중을 바꿔 다시 푼 경우`);
  if (a.dup) lines.push(`· 똑같은 BDF ${a.dup}쌍 — 업로드에서 막히는 경우인데 예외로 들어옴`);
  if (a.uses) lines.push(`· 보고서가 다른 자료의 모델을 사용 ${a.uses}건`);
  if (a.rrev) lines.push(`· 같은 보고서의 다른 판이 다른 자료에 ${a.rrev}건`);
  if (a.text) lines.push(`· 본문이 비슷한 보고서 ${a.text}쌍`);
  return lines.join('\n');
}

const pct = (x) => `${Math.round(x * 100)}%`;

export function explainPair(model, p, pivot) {
  const tag = (e) => `${e.eid}(${primaryOf(model, e, pivot).label})`;
  const files = p.files?.length === 2 ? `\n${p.files[0]} ↔ ${p.files[1]}` : '';
  const more = p.count > 1 ? `\n같은 형상의 파일 쌍 ${p.count}개 중 하나입니다.` : '';
  if (p.type === 'uses') {
    const rep = p.from || p.a, mod = rep === p.a ? p.b : p.a;
    return `${tag(rep)}의 보고서가 ${tag(mod)}의 모델을 사용했습니다.${files ? `
${p.files[0]} → ${p.files[1]}` : ''}`
      + `${p.count > 1 ? `
두 자료 사이 문서 관계 ${p.count}건 중 하나입니다.` : ''}`;
  }
  if (p.type === 'rrev') {
    const why = p.score != null ? `본문이 ${pct(p.score)} 겹칩니다` : '이름이 같은 계열입니다(본문 색인 전)';
    return `${tag(p.a)}, ${tag(p.b)} 두 자료에 같은 보고서의 다른 판이 있습니다 — ${why}.${files}
`
      + '같은 일의 개정본이면 한 자료로 모아 판으로 두는 것이 좋습니다.';
  }
  if (p.type === 'text') {
    return `${tag(p.a)}, ${tag(p.b)} 두 자료의 보고서는 본문 내용이 비슷합니다(의미 유사도 ${p.score?.toFixed(2) ?? '—'}).${files}
`
      + '같은 주제의 다른 검토일 수 있습니다 — 추천 수준이니 원문으로 확인해 주세요.';
  }
  if (p.type === 'dup') {
    return `${tag(p.a)}, ${tag(p.b)} 두 자료에 똑같은 BDF가 있습니다.${files}\n`
      + '같은 BDF는 업로드에서 막히는데 강제 업로드나 이전 자료로 들어왔습니다. 하나로 정리할지 확인해 주세요.';
  }
  return `${tag(p.a)}, ${tag(p.b)} 두 자료의 BDF는 형상이 같고 ${diffWords(p.differs || [])} 다릅니다.${files}${more}`;
}

/** 보고서 판 한 단계 요약 — '쪽 3곳 바뀜 · 쪽 +2 · 본문 82% 같음'. 색인 전이면 null. */
export function stepText(st) {
  if (!st) return null;
  const parts = [];
  if (st.changed) parts.push(`쪽 ${st.changed}곳 바뀜`);
  if (st.added || st.removed) parts.push(`쪽 ${st.added ? `+${st.added}` : ''}${st.added && st.removed ? ' ' : ''}${st.removed ? `−${st.removed}` : ''}`);
  if (st.overlap != null) parts.push(`본문 ${pct(st.overlap)} 같음`);
  return parts.length ? parts.join(' · ') : '바뀐 쪽 없음';
}

export function hubTip(h) {
  if (h.g === 'hull' && !h.none) return `${h.label}${h.ship ? ` · ${h.ship}` : ''} · 자료 ${h.cnt}건`;
  return `${h.none ? h.label : `${GROUP[h.g]} ${h.label}`} · 자료 ${h.cnt}건`;
}

/** 찾기 — 기준 점(지금 기준 먼저) → 다른 기준 → 자료 순. */
export function searchNodes(model, q, pivot) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const all = [...model.hubs.values(), ...model.entries];
  const hit = all.filter((n) => n.label.toLowerCase().includes(s) || (n.eid && n.eid.toLowerCase().includes(s)));
  const rank = (n) => (n.hub ? (n.g === pivot ? 0 : 1) : 2);
  return hit.sort((a, b) => rank(a) - rank(b));
}
