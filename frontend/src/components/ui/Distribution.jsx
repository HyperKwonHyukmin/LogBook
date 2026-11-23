import { Link } from 'react-router-dom';
import { SectionTitle } from './Page.jsx';

/**
 * 분포 목록 — 값과 건수, 중립색 막대. hrefOf(row) 를 주면 값을 눌러 그 조건으로 검색한다(없으면 글자만).
 * 호선 화면(구역 분포)과 담당자 카드(67, 특성 분포)가 같이 쓴다.
 */
export default function Distribution({ title, rows, hrefOf = null }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
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
        {rows.map((r) => (
          <li key={r.value}>
            {hrefOf
              ? <Link to={hrefOf(r)} className={`${cls} transition-colors duration-150 hover:bg-n-100 hover:text-n-900`}>{body(r)}</Link>
              : <div className={cls}>{body(r)}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
