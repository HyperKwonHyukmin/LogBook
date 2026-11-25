import { useEffect, useState } from 'react';
import { Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx';
import { inputClass } from '../../components/ui/Field.jsx';
import { ErrorNote, OkNote, Page, PageHeader, SectionTitle } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import { errorText, formatDateTime } from '../../lib/labels.js';
import { invalidateTeams } from '../../lib/teams.js';

const th = 'h-8 border-b border-n-200 bg-n-50 px-3 text-left text-meta font-medium text-n-600';
const td = 'h-10 border-b border-n-200 px-3 text-ui';
const splitIds = (s) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** 팀 하나 — 이름과 설명 고치기, 팀원 넣고 빼기, 팀 자료가 0건이면 지우기. */
function TeamCard({ team, onChanged, onDeleted }) {
  const [name, setName] = useState(team.name);
  const [desc, setDesc] = useState(team.description || '');
  const [ids, setIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm();
  useEffect(() => { setName(team.name); setDesc(team.description || ''); }, [team]);
  const dirty = name.trim() !== team.name || desc.trim() !== (team.description || '');

  async function run(fn, fallback) {
    setBusy(true); setError('');
    try { await fn(); invalidateTeams(); } catch (err) { setError(errorText(err, fallback)); } finally { setBusy(false); }
  }
  const save = () => run(async () => {
    onChanged(await api(`/admin/teams/${team.id}`, { method: 'PATCH', body: { name: name.trim(), description: desc.trim() } }));
  }, '팀 정보를 저장하지 못했습니다.');
  const add = () => run(async () => {
    onChanged(await api(`/admin/teams/${team.id}/members`, { method: 'POST', body: { employee_ids: splitIds(ids) } }));
    setIds('');
  }, '팀원을 넣지 못했습니다.');
  const remove = async (m) => {
    const ok = await confirm({
      title: `${m.name || m.employee_id} 님을 팀에서 뺄까요?`,
      body: '빼면 다른 팀원이 올린 팀 자료는 더 이상 보지 못합니다. 자기가 올린 자료는 계속 봅니다.',
      confirmLabel: '빼기', tone: 'danger',
    });
    if (ok) await run(async () => onChanged(await api(`/admin/teams/${team.id}/members/${encodeURIComponent(m.employee_id)}`,
      { method: 'DELETE' })), '팀원을 빼지 못했습니다.');
  };
  const drop = async () => {
    const ok = await confirm({ title: `'${team.name}' 팀을 지울까요?`, body: '팀원 명단도 함께 지웁니다.', confirmLabel: '지우기', tone: 'danger' });
    if (ok) await run(async () => { await api(`/admin/teams/${team.id}`, { method: 'DELETE' }); onDeleted(team.id); }, '팀을 지우지 못했습니다.');
  };

  return (
    <section aria-label={`${team.name} 팀`} className="rounded-lg border border-n-200 bg-n-0 p-4">
      {dialog}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SectionTitle>{team.name}</SectionTitle>
        <span className="text-meta text-n-500">팀원 <span className="font-mono">{team.members.length}</span>명, 팀 자료 <span className="font-mono">{team.entries}</span>건</span>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={busy || team.entries > 0} onClick={drop}
                title={team.entries > 0 ? '팀 자료가 남아 있으면 지울 수 없습니다' : undefined} aria-label={`${team.name} 팀 지우기`}>
          <Trash2 size={14} aria-hidden="true" />지우기
        </Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
        <input aria-label={`${team.name} 팀 이름`} value={name} maxLength={50} disabled={busy}
               onChange={(e) => setName(e.target.value)} className={inputClass('h-8')} />
        <input aria-label={`${team.name} 팀 설명`} value={desc} maxLength={200} disabled={busy} placeholder="한 줄 설명(예: CAESAR II 배관 응력해석)"
               onChange={(e) => setDesc(e.target.value)} className={inputClass('h-8')} />
        <Button size="sm" variant="secondary" disabled={!dirty || !name.trim() || busy} onClick={save}>저장</Button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr><th className={th}>이름</th><th className={th}>사번</th><th className={th}>부서</th><th className={th}>넣은 날</th><th className={th} aria-label="빼기" /></tr>
          </thead>
          <tbody>
            {team.members.map((m) => (
              <tr key={m.employee_id}>
                <td className={td}>{m.name || '—'}{!m.wb_active && <span className="ml-1.5 text-meta text-n-500">(WorkBench 비활성)</span>}</td>
                <td className={`${td} font-mono text-meta`}>{m.employee_id}</td>
                <td className={`${td} text-meta text-n-700`}>{m.department || '—'}</td>
                <td className={`${td} font-mono text-meta text-n-600`}>{m.added_at ? formatDateTime(m.added_at) : '—'}</td>
                <td className={`${td} text-right`}>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(m)} aria-label={`${m.name || m.employee_id} 빼기`}>
                    <UserMinus size={14} aria-hidden="true" />빼기
                  </Button>
                </td>
              </tr>
            ))}
            {!team.members.length && <tr><td colSpan={5} className={`${td} text-meta text-n-500`}>아직 팀원이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label={`${team.name} 팀원 사번`} value={ids} disabled={busy} placeholder="사번(여러 명은 쉼표나 띄어쓰기로)"
               onChange={(e) => setIds(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && splitIds(ids).length) add(); }}
               className={inputClass('h-8 min-w-[240px] flex-1 sm:max-w-[360px]')} />
        <Button size="sm" disabled={!splitIds(ids).length || busy} loading={busy} onClick={add}>
          {!busy && <UserPlus size={14} aria-hidden="true" />}팀원 넣기
        </Button>
        <span className="text-meta text-n-500">WorkBench 가입자만 넣습니다. 한 사람은 한 팀에만 들어갑니다.</span>
      </div>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </section>
  );
}

/**
 * 74 — 관리 › 팀(LV3). 팀 자료(공개 범위 '팀 전용')는 그 팀원과 관리자만 봅니다. 팀원 명단은 관리자만 고칩니다.
 */
export default function TeamsPage() {
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api('/admin/teams')
      .then((r) => { if (alive) setTeams(r); })
      .catch((err) => { if (alive) setError(errorText(err, '팀 목록을 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);

  const replace = (t) => setTeams((cur) => cur.map((x) => (x.id === t.id ? t : x)));
  async function create() {
    setBusy(true); setError(''); setNotice('');
    try {
      const t = await api('/admin/teams', { method: 'POST', body: { name: name.trim(), description: desc.trim() || null } });
      invalidateTeams();
      setTeams((cur) => [...(cur || []), t]);
      setName(''); setDesc('');
      setNotice(`'${t.name}' 팀을 만들었습니다. 이제 팀원을 넣으세요.`);
    } catch (err) {
      setError(errorText(err, '팀을 만들지 못했습니다.'));
    } finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader title="팀"
                  description="팀 자료(공개 범위 '팀 전용')는 그 팀원과 관리자만 봅니다. 팀원은 팀 자료를 올린 사람처럼 고치고 확정합니다. 팀원이 올리는 자료는 처음부터 팀 전용입니다." />
      <div className="flex max-w-[960px] flex-col gap-4">
        <section aria-label="새 팀" className="rounded-lg border border-n-200 bg-n-0 p-4">
          <SectionTitle>새 팀</SectionTitle>
          <div className="mt-3 grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
            <input aria-label="새 팀 이름" value={name} maxLength={50} disabled={busy} placeholder="팀 이름(예: 배관해석)"
                   onChange={(e) => setName(e.target.value)} className={inputClass('h-8')} />
            <input aria-label="새 팀 설명" value={desc} maxLength={200} disabled={busy} placeholder="한 줄 설명"
                   onChange={(e) => setDesc(e.target.value)} className={inputClass('h-8')} />
            <Button size="sm" disabled={!name.trim() || busy} loading={busy} onClick={create}>만들기</Button>
          </div>
          <p className="mt-2 text-meta text-n-500">
            공유 폴더(999_LogBook)에 접근 권한이 있는 사람은 팀 파일도 폴더에서 직접 볼 수 있습니다. LogBook 화면에서만 숨깁니다.
          </p>
        </section>
        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && <OkNote>{notice}</OkNote>}
        {!teams && !error && <RowsSkeleton rows={3} label="팀 목록을 불러오는 중" />}
        {teams && !teams.length && <p className="text-ui text-n-600">아직 팀이 없습니다.</p>}
        {teams && teams.map((t) => (
          <TeamCard key={t.id} team={t} onChanged={replace}
                    onDeleted={(id) => setTeams((cur) => cur.filter((x) => x.id !== id))} />
        ))}
      </div>
    </Page>
  );
}
