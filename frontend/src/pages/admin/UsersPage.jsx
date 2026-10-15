import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Lock, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { inputClass, selectClass } from '../../components/ui/Field.jsx';
import { errorText, formatDateTime } from '../../lib/labels.js';
import { LEVELS, LEVEL_HELP, assignableLevels, levelName } from '../../lib/levels.js';
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx';
import { ErrorNote, Page, PageHeader } from '../../components/ui/Page.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';

const ADMIN_FALLBACK = { employee_id: '', level: 3 };
const DEBOUNCE_MS = 250;

/** 등급 배지 — LV3 은 brand 옅은 바탕, 나머지는 회색. */
export function LevelBadge({ level }) {
  return (
    <span className={`inline-flex h-5 items-center rounded-xs px-1.5 text-micro font-semibold ${level === 3 ? 'bg-brand-subtle text-brand' : 'bg-n-100 text-n-700'}`}>
      {levelName(level)}
    </span>
  );
}

/** 등급 안내(접힘) — 무엇을 할 수 있는지 한 줄씩. */
function LevelHelp() {
  return (
    <details className="group mb-4 rounded-md border border-n-200 text-meta text-n-700">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 px-3 hover:bg-n-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="text-n-400 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
        등급 안내
      </summary>
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-n-200 px-3 py-2.5">
        {[...LEVELS].reverse().map((lv) => (
          <div key={lv} className="contents">
            <dt><LevelBadge level={lv} /></dt>
            <dd className="text-n-700">{LEVEL_HELP[lv]}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-n-200 px-3 py-2 text-n-600">
        HiTESS WorkBench 에 가입·승인된 사람은 누구나 들어오고, 처음에는 LV1 입니다. WorkBench 관리자는 자동으로 LV3 이며 여기서 바꿀 수 없습니다.
        계정 활성·비활성은 WorkBench 에서 관리합니다. 자료별 열람 허락은 그 자료의 상세 화면 ‘공개 범위’에서 줍니다.
      </p>
    </details>
  );
}

const th = 'h-9 border-b border-n-200 bg-n-50 px-3 text-left text-meta font-medium text-n-600';
const td = 'h-12 border-b border-n-200 px-3 text-ui';
const FILTERS = [{ id: 'all', label: '전체' }, { id: '3', label: 'LV3' }, { id: '2', label: 'LV2' }, { id: '1', label: 'LV1' }];

/**
 * 사용자 관리(15, LV3) — WorkBench 활성 사용자 목록과 LogBook 등급.
 * WorkBench 표를 읽을 수 없으면(연결·권한) 원인을 알리고 목록을 비운다.
 */
export default function UsersPage() {
  // 관리자 전용 화면이라 로그인 정보가 없으면(시험) LV3 로 본다 — 서버가 다시 검사한다
  const me = useContext(AuthContext)?.user || ADMIN_FALLBACK;
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirm, dialog] = useConfirm();
  // 검색어를 빠르게 바꿀 때 먼저 나간 요청이 나중에 응답해 화면을 덮어쓰지 않도록 순번을 매긴다
  const requestSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const data = await api(`/admin/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
      if (seq === requestSeq.current) { setRows(data); setError(''); }
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err?.detail === 'wb_unavailable'
          ? 'WorkBench 사용자 표를 읽을 수 없습니다. 운영 화면의 ‘WorkBench 사용자 표’ 상태와 DB 권한(GRANT SELECT)을 확인하세요.'
          : '사용자 목록을 불러오지 못했습니다.');
        setRows([]);
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [term]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: rows.length, 1: 0, 2: 0, 3: 0 };
    for (const u of rows) c[u.level] += 1;
    return c;
  }, [rows]);
  const shown = filter === 'all' ? rows : rows.filter((u) => String(u.level) === filter);

  async function change(u, level) {
    // LV3 지정·해제는 모든 자료·사용자 관리 권한이 오가므로 묻는다(다른 등급은 바로 바꾸고 되돌릴 수 있다)
    if (level === 3 || u.level === 3) {
      const ok = await confirm({
        title: level === 3 ? `${u.name} 님을 LV3 관리자로 지정할까요?` : `${u.name} 님을 ${levelName(level)} 로 내릴까요?`,
        body: level === 3 ? '모든 자료를 보고 고치며, 자료 블록과 사용자 등급을 바꿀 수 있게 됩니다.'
          : '관리자 권한(모든 자료·블록·등급 지정)이 바로 없어집니다.',
        confirmLabel: '바꾸기', tone: 'primary',
      });
      if (!ok) return;
    }
    setBusyId(u.employee_id);
    try {
      await api(`/admin/users/${u.employee_id}/level`, { method: 'PUT', body: { level } });
      await load();
    } catch (err) {
      setError(errorText(err, '등급을 바꾸지 못했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      {dialog}
      <PageHeader title="사용자 관리"
                  description="HiTESS WorkBench 가입자에게 LogBook 등급(LV1 게스트 · LV2 일반 · LV3 관리자)을 정합니다." />
      <LevelHelp />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs label="등급으로 거르기" className="min-w-0"
              items={FILTERS.map((f) => ({ ...f, count: counts[f.id] }))}
              value={filter} onChange={setFilter} />
        <label className="ml-auto flex items-center gap-1.5">
          <Search size={14} className="text-n-400" aria-hidden="true" />
          <input aria-label="사용자 찾기" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 사번"
                 className={inputClass('h-8 w-[220px]')} />
        </label>
      </div>
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      <div className="overflow-hidden rounded-lg border border-n-200">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>이름</th><th className={th}>부서</th>
              <th className={th}>마지막 로그인</th><th className={th}>등급</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.employee_id} className="transition-colors duration-150 last:[&>td]:border-0 hover:bg-n-50">
                <td className={td}>
                  <div className="font-medium text-n-900">{u.name || <span className="font-mono">{u.employee_id}</span>}</div>
                  <div className="font-mono text-meta text-n-500">{u.employee_id}</div>
                </td>
                <td className={`${td} ${u.department ? 'text-n-700' : 'text-n-500'}`}>
                  {u.department || '—'}{u.position && <span className="ml-1.5 text-meta text-n-500">{u.position}</span>}
                </td>
                <td className={`${td} text-meta ${u.last_login ? 'font-mono text-n-600' : 'text-n-500'}`}>
                  {u.last_login ? formatDateTime(u.last_login).slice(0, 16) : '들어온 적 없음'}
                </td>
                <td className={td}>
                  <LevelCell u={u} me={me} busy={busyId === u.employee_id} onChange={(lv) => change(u, lv)} />
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && !error && (
              <tr><td colSpan={4} className="py-10 text-center text-ui text-n-500">해당하는 사용자가 없습니다.</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-ui text-n-500"><span className="appear-late">불러오는 중…</span></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

/**
 * 등급 칸 — 바꿀 수 있는 사람은 고르기, 아니면 배지 + 이유(WorkBench 관리자 자동 LV3 · 나 · WorkBench 비활성).
 */
function LevelCell({ u, me, busy, onChange }) {
  const options = assignableLevels(me, u);
  let note = null;
  if (u.wb_admin) note = 'WorkBench 관리자 · 자동';
  else if (me && u.employee_id === me.employee_id) note = '나';
  else if (u.wb_active === false) note = 'WorkBench 비활성';
  if (options.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <LevelBadge level={u.level} />
        {note && (
          <span className="inline-flex items-center gap-1 text-meta text-n-500" title={u.wb_admin ? 'WorkBench 관리자는 LogBook 에서 바꿀 수 없습니다' : undefined}>
            {u.wb_admin && <Lock size={11} aria-hidden="true" />}{note}
          </span>
        )}
      </span>
    );
  }
  return (
    <select aria-label={`${u.name || u.employee_id} 등급`} value={u.level} disabled={busy} title={LEVEL_HELP[u.level]}
            onChange={(e) => Number(e.target.value) !== u.level && onChange(Number(e.target.value))}
            className={selectClass('h-7 text-meta')}>
      {options.map((lv) => <option key={lv} value={lv}>{levelName(lv)}</option>)}
    </select>
  );
}
