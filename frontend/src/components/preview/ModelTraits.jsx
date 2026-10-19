import { STRUCTURES, familyCounts, formatSize, num, structureOf } from '../../lib/insight.js';

/**
 * 38 — 대표 BDF 고르기: 변환이 끝난(done) 모델 중 절점(GRID)이 가장 많은 것(검색 결과 행·썸네일과 같은 규칙,
 * 같으면 큰 파일). 판 묶음(14)이 있으면 각 계열의 최신 판 안에서만 고른다(R0·R1 보다 R2). 없으면 null.
 */
export function representativeModel(files, revisions) {
  const done = (files || []).filter((f) => f.kind === 'model' && f.model?.state === 'done' && f.model.counts);
  // 옛 판(최신이 아닌 판)은 뺀다 — 판으로 묶이지 않은 모델은 그대로 후보. 다 빠지면 전체에서
  const stale = new Set((revisions || []).flatMap((s) => (s.items || []).filter((x) => !x.is_latest).map((x) => x.file_id)));
  const fresh = done.filter((f) => !stale.has(f.id));
  const pool = fresh.length ? fresh : done;
  let best = null;
  for (const f of pool) {
    const rank = [Number(f.model.counts.GRID) || 0, f.size || 0];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { file: f, rank };
  }
  return best?.file || null;
}

const bboxSize = (bbox) => {
  if (!bbox?.min || !bbox?.max) return null;
  return [0, 1, 2].map((k) => Number(bbox.max[k]) - Number(bbox.min[k]));
};

/**
 * 자료를 열었을 때 처음 미리 볼 파일 — BDF 가 있으면 대표 BDF(3D 뷰어), 변환된 BDF 가 없으면 첫 문서, 그다음 첫 파일.
 */
export function defaultFile(entry) {
  const files = entry?.files || [];
  return representativeModel(files, entry?.revisions) || files.find((f) => f.kind === 'report') || files[0] || null;
}

/** 자료 사전 → 특성 조각 [{ key, text, title? }] — 모델 구성·절점·크기·판·선형. 순수 함수(테스트용). */
export function traitParts(entry) {
  const parts = [];
  const rep = representativeModel(entry?.files, entry?.revisions);
  if (rep) {
    const structure = structureOf(familyCounts(rep.model.counts));
    if (structure) parts.push({ key: 'structure', text: STRUCTURES[structure], strong: true });
    parts.push({ key: 'nodes', text: `절점 ${num(rep.model.counts.GRID)}` });
    const size = formatSize(bboxSize(rep.model.bbox));
    if (size) parts.push({ key: 'size', text: size.text, title: size.hint });
    // 14 — 대표 BDF 가 판 묶음에 들었으면 그 판 표기(R2)와 최신 여부
    for (const s of entry.revisions || []) {
      const it = s.items?.find((x) => x.file_id === rep.id);
      if (it?.display) {
        parts.push({ key: 'rev', text: it.is_latest ? `${it.display} 최신` : it.display, title: `판 ${s.items.length}개 중` });
        break;
      }
    }
  }
  // 30 — 대표 호선의 선종(PLM 선형, 예: 174K LNG)
  const ship = entry?.hulls?.[0]?.ship_type;
  if (ship) parts.push({ key: 'ship', text: ship });
  return parts;
}

/** 자료 상세 제목 아래 '모델 특성' 한 줄 — 제목은 사람이 붙인 이름 그대로 두고, 모델이 어떤 것인지는 여기서 본다. */
export default function ModelTraits({ entry }) {
  const parts = traitParts(entry);
  if (!parts.length) return null;
  return (
    <p aria-label="모델 특성" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-n-600">
      {parts.map((p, i) => (
        <span key={p.key} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="text-n-300">·</span>}
          <span title={p.title} className={`tnum ${p.strong ? 'font-medium text-n-800' : ''}`}>{p.text}</span>
        </span>
      ))}
    </p>
  );
}
