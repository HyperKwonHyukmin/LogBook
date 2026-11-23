import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from './Button.jsx';
import { SectionTitle } from './Page.jsx';

/**
 * 분포 목록 — 값과 건수, 중립색 막대. hrefOf(row) 를 주면 값을 눌러 그 조건으로 검색한다(없으면 글자만).
 * limit 을 주면 처음엔 위에서 그만큼만 보이고 '모두 보기 N' 으로 펼친다(67 담당자 카드 — 대상이 26줄까지 길어진다).
 * 호선 화면(구역 분포)과 담당자 카드(67, 특성 분포)가 같이 쓴다.
 */
export default function Distribution({ title, rows, hrefOf = null, limit = 0 }) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const folded = limit > 0 && rows.length > limit && !all;
  const shown = folded ? rows.slice(0, limit) : rows;
  const cls = 'grid h-7 grid-cols-[minmax(0,1fr)_64px_24px] items-center gap-2 rounded-md px-1.5 text-ui text-n-700';
  const body = (r) => (
    <>
      <span className="truncate" title={r.value}>{r.value}</span>
      <span className="h-1.5 rounded-full bg-n-100">
        <span className="block h-full rounded-full bg-n-300" style={{ width: `${(r.count / max) * 100}%` }} />
      </span>
      <span className="text-right font-mono text-meta text-n-600">{r.count}</span>
    </>
  );
  return (
    <section aria-label={title}>
      <SectionTitle className="mb-2">{title}</SectionTitle>
      {rows.length === 0 && <p className="text-meta text-n-500">없음</p>}
      <ul className="flex flex-col gap-px">
        {shown.map((r) => (
          <li key={r.value}>
            {hrefOf
              ? <Link to={hrefOf(r)} className={`${cls} transition-colors duration-150 hover:bg-n-100 hover:text-n-900`}>{body(r)}</Link>
              : <div className={cls}>{body(r)}</div>}
          </li>
        ))}
      </ul>
      {limit > 0 && rows.length > limit && (
        <Button variant="ghost" size="sm" className="mt-1" aria-expanded={!folded} onClick={() => setAll((v) => !v)}>
          {folded ? `모두 보기 ${rows.length}` : '접기'}
        </Button>
      )}
    </section>
  );
}
