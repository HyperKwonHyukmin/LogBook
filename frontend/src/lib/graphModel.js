/**
 * 관계 지도(25) — /api/graph 응답을 지도용 모델로 바꾸는 순수 함수.
 *
 * 점은 두 종류다. 기준 점(호선·구역·자유 태그 값 하나)과 자료 점(확정 Entry 하나).
 * 고른 기준(pivot)의 값마다 기준 점이 생기고 자료가 그 둘레에 앉는다. 기준 값이 없는 자료는 '○○ 없음' 점 하나로 모은다.
 * 기준 점끼리의 굵은 곡선(aggregate) = 두 기준에 함께 등록된 자료 + 형상만 같은 BDF 쌍 + 똑같은 BDF 쌍.
 */
// 29 — 프로젝트 기준은 없앴다
export const GROUP = { hull: '호선', zone: '구역', free: '자유 태그' };
export const JOSA = { hull: '이', zone: '이', free: '가' };
export const PIVOTS = ['hull', 'zone'];
export const GROUP_KEYS = ['hull', 'zone', 'free'];
const FIELD = { hull: 'hulls', zone: 'zones', free: 'free' };
export const DIFF_LABEL = { property: '물성', material: '재료', load: '하중' };

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
      n.of[g] = (e[FIELD[g]] || []).map((v) => hub(g, v));
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
  const pairs = (data?.pairs || [])
    .map((p) => ({ ...p, a: byEid.get(p.a), b: byEid.get(p.b) }))
    .filter((p) => p.a && p.b);
  const byId = new Map([...hubs.values(), ...Object.values(NONE), ...entries].map((n) => [n.id, n]));
  return {
    entries, hubs, NONE, pairs, byId,
    colors: { atype: palette(entries, 'atype'), ship: palette(entries, 'ship') },
    unsigned: data?.unsigned_models || 0, truncated: !!data?.truncated,
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

/** 기준 점 사이 관계 — {a, b, c(합), span, geom, dup}. 같은 기준 안의 모델 쌍은 세지 않는다. */
export function aggregate(model, pivot) {
  const m = new Map();
  const add = (a, b, kind) => {
    if (a === b) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}|${y.id}`;
    const v = m.get(key) || { a: x, b: y, c: 0, span: 0, geom: 0, dup: 0 };
    v.c += 1; v[kind] += 1; m.set(key, v);
  };
  for (const e of model.entries) {
    const ps = e.of[pivot];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) add(ps[i], ps[j], 'span');
  }
  for (const p of model.pairs) add(primaryOf(model, p.a, pivot), primaryOf(model, p.b, pivot), p.type);
  return [...m.values()];
}

// ── 설명 문장 ──
export const diffWords = (d) => `${d.map((x) => DIFF_LABEL[x] || x).join('·')}${d.length === 1 ? '만' : '이'}`;
export const diffShort = (d) => (d?.length ? `${diffWords(d)} 다름` : '모두 같음');
export const aggText = (a) => [a.span && `함께 등록 ${a.span}`, a.geom && `형상만 같음 ${a.geom}`, a.dup && `똑같은 BDF ${a.dup}`]
  .filter(Boolean).join(' · ');

export function explainAgg(a, pivot) {
  const lines = [`${a.a.label} ↔ ${a.b.label} · 관계 ${a.c}건`];
  if (a.span) lines.push(`· 두 ${GROUP[pivot]}에 함께 등록된 자료 ${a.span}건`);
  if (a.geom) lines.push(`· 형상이 같은 BDF ${a.geom}쌍 — 한쪽 모델을 가져다 물성·하중을 바꿔 다시 푼 경우`);
  if (a.dup) lines.push(`· 똑같은 BDF ${a.dup}쌍 — 업로드에서 막히는 경우인데 예외로 들어옴`);
  return lines.join('\n');
}

export function explainPair(model, p, pivot) {
  const tag = (e) => `${e.eid}(${primaryOf(model, e, pivot).label})`;
  const files = p.files?.length === 2 ? `\n${p.files[0]} ↔ ${p.files[1]}` : '';
  const more = p.count > 1 ? `\n같은 형상의 파일 쌍 ${p.count}개 중 하나입니다.` : '';
  if (p.type === 'dup') {
    return `${tag(p.a)}, ${tag(p.b)} 두 자료에 똑같은 BDF가 있습니다.${files}\n`
      + '같은 BDF는 업로드에서 막히는데 강제 업로드나 이전 자료로 들어왔습니다. 하나로 정리할지 확인해 주세요.';
  }
  return `${tag(p.a)}, ${tag(p.b)} 두 자료의 BDF는 형상이 같고 ${diffWords(p.differs || [])} 다릅니다.${files}${more}`;
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
