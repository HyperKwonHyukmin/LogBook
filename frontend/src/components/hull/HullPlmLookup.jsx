import { useState } from 'react';
import { Ship } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import { errorText } from '../../lib/labels.js';

/** 35 — 크기급 '174K급 LNG'(용량 + 선종). 규칙 밖(FPSO·함정)이면 PLM 선형 원문. */
export const sizeClassOf = (plm) => (plm?.capacity && plm?.ship_kind ? `${plm.capacity}급 ${plm.ship_kind}` : plm?.ship_type_raw || null);

/**
 * 30 — 자료 수정·정리 대기 화면의 [선박 정보 검색]. 한 번 찾은 호선은 저장된 정보를 보여 주고(PLM 에 다시 묻지 않음),
 * 처음 찾으면 서버가 호선 정보로 저장한다(빈 선종만 채움). 새로 받거나 선종을 바꾸려면 호선 화면의 같은 단추를 쓴다.
 */
export default function HullPlmLookup({ hulls, disabled = false }) {
  const [results, setResults] = useState({});   // 호선 → { plm, ship_type } | { error }
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setBusy(true);
    const pairs = await Promise.all(hulls.map((no) => api(`/hulls/${encodeURIComponent(no)}/plm`)
      .then((r) => [no, r])
      .catch((err) => [no, { error: errorText(err, '선박 정보를 찾지 못했습니다.') }])));
    setResults(Object.fromEntries(pairs));
    setBusy(false);
  }

  // 지운 호선의 결과는 감춘다
  const shown = hulls.filter((no) => results[no]);
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1">
      <Button variant="ghost" size="sm" className="w-fit -ml-2.5" loading={busy} disabled={disabled || busy || !hulls.length}
              onClick={lookup} title="입력한 호선의 크기급·주기관·선급·인도일을 보여 줍니다(한 번 찾은 호선은 저장된 정보)">
        <Ship size={13} aria-hidden="true" />선박 정보 검색
      </Button>
      {shown.length > 0 && (
        <ul aria-label="PLM 선박 정보" className="flex flex-col gap-0.5 text-meta font-normal">
          {shown.map((no) => <PlmRow key={no} hullNo={no} r={results[no]} />)}
        </ul>
      )}
    </div>
  );
}

/** 30 — 자료 화면 속성 칸: 저장된 PLM 선박 정보를 호선마다 한 줄씩(조회 안 한 호선은 줄이 없다). */
export function HullPlmSummary({ hulls }) {
  const rows = (hulls || []).filter((h) => h.plm);
  if (!rows.length) return null;
  return (
    <ul aria-label="PLM 선박 정보" className="mt-1 flex flex-col gap-0.5 text-meta">
      {rows.map((h) => (h.plm.status === 'found'
        ? <PlmRow key={h.hull_no} hullNo={h.hull_no} r={h} />
        : <li key={h.hull_no} className="text-n-500"><span className="mr-1.5 font-mono text-n-800">{h.hull_no}</span>PLM 에 없음</li>))}
    </ul>
  );
}

function PlmRow({ hullNo, r }) {
  if (r.error) {
    return <li className="text-n-600"><span className="mr-1.5 font-mono text-n-800">{hullNo}</span>{r.error}</li>;
  }
  const p = r.plm;
  const items = [
    sizeClassOf(p) && ['크기급', sizeClassOf(p)],
    p.main_engine && ['주기관', p.main_engine],
    p.ship_class && ['선급', p.ship_class],
    ['인도', `${p.delivery_date || '—'}${p.delivered ? '' : ' (미인도)'}`],
  ].filter(Boolean);
  return (
    <li className="flex min-w-0 flex-wrap gap-x-2.5 text-n-600">
      <span className="font-mono text-n-800">{hullNo}</span>
      {items.map(([k, v]) => (
        <span key={k} className="min-w-0 break-all"><span className="mr-1 text-n-500">{k}</span><span className="font-mono text-n-800">{v}</span></span>
      ))}
    </li>
  );
}
