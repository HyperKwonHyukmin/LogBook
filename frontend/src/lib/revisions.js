/**
 * 판(Revision) 묶음과 변경 요약(14) — 화면에 쓰는 순수 함수.
 * 서버: GET /api/entries/{id}/revisions(계열·인접 비교), GET|POST /api/files/{a}/diff/{b}(+ /detail).
 */

/** 비교 실패 이유 → 문구. */
export const DIFF_ERROR_TEXT = {
  file_missing: '원본 파일을 찾을 수 없습니다',
  drm: 'DRM 암호화 파일입니다',
  too_large: '모델이 너무 큽니다',
  model_not_ready: '모델 변환이 끝나지 않았습니다',
  memory_error: '메모리가 부족했습니다',
};

export function diffErrorText(error) {
  if (!error) return '알 수 없는 이유';
  const key = String(error).split(':')[0];
  return DIFF_ERROR_TEXT[key] || String(error);
}

const n = (v) => Number(v) || 0;
const fmt = (v) => n(v).toLocaleString('ko-KR');

/** 요약 → 짧은 칩 문구 목록. 예: ['요소 +120 −8', '두께 3건', '하중 변경']. 같으면 ['변경 없음']. */
export function diffChips(summary, max = 4) {
  if (!summary) return [];
  if (summary.identical) return ['변경 없음'];
  const out = [];
  const nd = summary.nodes || {};
  const el = summary.elements || {};
  const rg = summary.rigids || {};
  const pr = summary.properties || {};
  const mt = summary.materials || {};
  const lo = summary.loads || {};
  const ms = summary.mass || {};
  const ct = summary.control || {};
  if (n(el.added) || n(el.removed)) out.push(`요소 ${plusMinus(el.added, el.removed)}`);
  const elChanged = n(el.conn_changed) + n(el.card_changed) + n(el.other_changed);
  if (elChanged) out.push(`요소 변경 ${fmt(elChanged)}`);
  if (n(el.pid_changed)) out.push(`PID 변경 ${fmt(el.pid_changed)}`);
  if (n(nd.added) || n(nd.removed)) out.push(`절점 ${plusMinus(nd.added, nd.removed)}`);
  if (n(nd.moved)) out.push(`절점 이동 ${fmt(nd.moved)}`);
  if (n(rg.added) || n(rg.removed) || n(rg.indep_changed) || n(rg.dep_changed) || n(rg.other_changed)) out.push('강체 변경');
  if (n(pr.thickness)) out.push(`두께 ${fmt(pr.thickness)}건`);
  if (n(pr.section)) out.push(`단면 ${fmt(pr.section)}건`);
  const prOther = n(pr.added) + n(pr.removed) + n(pr.changed) - n(pr.thickness) - n(pr.section);
  if (prOther > 0) out.push(`속성 ${fmt(prOther)}건`);
  if (n(mt.added) + n(mt.removed) + n(mt.changed)) out.push(`재료 ${fmt(n(mt.added) + n(mt.removed) + n(mt.changed))}건`);
  if (n(lo.sets_changed)) out.push('하중 변경');
  if (n(lo.spc_added) + n(lo.spc_removed) + n(lo.spc_changed)) out.push('경계 변경');
  if (n(ms.added) + n(ms.removed) + n(ms.changed)) out.push('질량 변경');
  if (ct.changed || n(ct.other_added) + n(ct.other_removed)) out.push('해석 설정 변경');
  if (out.length > max) return [...out.slice(0, max), `외 ${out.length - max}`];
  return out;
}

function plusMinus(added, removed) {
  const parts = [];
  if (n(added)) parts.push(`+${fmt(added)}`);
  if (n(removed)) parts.push(`−${fmt(removed)}`);
  return parts.join(' ');
}

/** 비교 상태 → { tone: 'wait'|'busy'|'ok'|'err'|'none', text }. */
export function diffStatus(d) {
  if (!d || !d.state) return { tone: 'none', text: '비교 전' };
  if (d.state === 'waiting') return { tone: 'wait', text: '변환 대기' };
  if (d.state === 'queued' || d.state === 'running') return { tone: 'busy', text: '비교 중' };
  if (d.state === 'error') return { tone: 'err', text: `비교 실패: ${diffErrorText(d.error)}` };
  if (d.stale) return { tone: 'busy', text: '다시 비교 중' };
  return { tone: 'ok', text: diffChips(d.summary).join(' · ') || '변경 없음' };
}

/** 아직 기다리는 비교가 있는가(다시 읽기). */
export const hasPending = (diffs = []) => diffs.some((d) => d && (d.state === 'queued' || d.state === 'running'));

/** 검색 결과 행·미리보기 한 줄 — '판 3개 · 최신 R2'(계열이 여럿이면 '계열 2 · …'). */
export function revisionBrief(r) {
  if (!r || !r.files) return '';
  const head = r.series > 1 ? `계열 ${r.series} · ` : '';
  return `${head}판 ${r.files}개${r.latest ? ` · 최신 ${r.latest}` : ''}`;
}

/** 요약의 숫자 하나를 '앞 → 뒤' 로. */
export const arrow = (a, b) => `${fmt(a)} → ${fmt(b)}`;

export function formatMass(v) {
  const x = Number(v) || 0;
  return Math.abs(x) >= 1e5 || (x !== 0 && Math.abs(x) < 1e-3) ? x.toExponential(3) : String(+x.toPrecision(6));
}

// ── 판 정리(편집) 상태 ─────────────────────────────────────────────

/** 서버 응답 → 편집 상태 { series: [{ key, items: [{file_id, name, label, auto_label}], latest }], others: [...] }. */
export function editorState(data) {
  return {
    series: (data?.series || []).map((s) => ({
      key: s.key,
      items: s.items.map((x) => ({ file_id: x.file_id, name: x.name, label: x.label || '', auto_label: x.auto_label })),
      latest: (s.items.find((x) => x.is_latest) || s.items[s.items.length - 1])?.file_id ?? null,
    })),
    others: (data?.others || []).map((x) => ({ file_id: x.file_id, name: x.name, label: '', auto_label: '' })),
  };
}

const replaceSeries = (st, i, s) => ({ ...st, series: st.series.map((x, k) => (k === i ? s : x)) });

/** 계열 i 안에서 판을 위(−1)·아래(+1)로. */
export function moveItem(st, i, fileId, delta) {
  const s = st.series[i];
  const at = s.items.findIndex((x) => x.file_id === fileId);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= s.items.length) return st;
  const items = [...s.items];
  [items[at], items[to]] = [items[to], items[at]];
  return replaceSeries(st, i, { ...s, items });
}

/** 계열에서 빼기 — 계열 밖으로. 최신판이었으면 남은 마지막이 최신판. */
export function removeItem(st, i, fileId) {
  const s = st.series[i];
  const item = s.items.find((x) => x.file_id === fileId);
  if (!item) return st;
  const items = s.items.filter((x) => x.file_id !== fileId);
  const latest = s.latest === fileId ? items[items.length - 1]?.file_id ?? null : s.latest;
  const series = st.series.map((x, k) => (k === i ? { ...s, items, latest } : x)).filter((x) => x.items.length > 0);
  return { series, others: [...st.others, { ...item, label: '' }] };
}

/** 계열 밖 파일을 계열 i 끝에 넣는다(i = 'new' 면 새 계열). */
export function addItem(st, fileId, i) {
  const item = st.others.find((x) => x.file_id === fileId);
  if (!item) return st;
  const others = st.others.filter((x) => x.file_id !== fileId);
  if (i === 'new') {
    return { series: [...st.series, { key: `new:${fileId}`, items: [item], latest: fileId }], others };
  }
  const s = st.series[i];
  const wasLast = s.latest === s.items[s.items.length - 1]?.file_id;
  return { ...replaceSeries(st, i, { ...s, items: [...s.items, item], latest: wasLast ? fileId : s.latest }), others };
}

export const setLatest = (st, i, fileId) => replaceSeries(st, i, { ...st.series[i], latest: fileId });

export const setLabel = (st, i, fileId, label) => replaceSeries(st, i, {
  ...st.series[i], items: st.series[i].items.map((x) => (x.file_id === fileId ? { ...x, label: label.slice(0, 20) } : x)),
});

/** 편집 상태 → PUT 본문. */
export function layoutBody(st, token) {
  return {
    token,
    series: st.series.filter((s) => s.items.length > 0).map((s) => ({
      file_ids: s.items.map((x) => x.file_id),
      latest: s.latest,
      labels: Object.fromEntries(s.items.filter((x) => x.label.trim()).map((x) => [x.file_id, x.label.trim()])),
    })),
  };
}

/** 저장하면 풀리는(파일 하나뿐인) 계열 수. */
export const singletonSeries = (st) => st.series.filter((s) => s.items.length === 1).length;

/** entry.revisions(계열 목록) → revisionBrief 모양 { series, files, latest } — 판이 가장 많은 계열 기준. */
export function briefFromSeries(list) {
  if (!list?.length) return null;
  const big = list.reduce((m, s) => (s.items.length > m.items.length ? s : m), list[0]);
  const latest = big.items.find((x) => x.is_latest) || big.items[big.items.length - 1];
  return { series: list.length, files: big.items.length, latest: latest?.display || null };
}
