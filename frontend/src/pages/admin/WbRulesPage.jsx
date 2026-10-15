import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import ChipInput from '../../components/ui/ChipInput.jsx';
import VocabInput from '../../components/ui/VocabInput.jsx';
import { ErrorNote, OkNote, Page, PageHeader, SectionTitle } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import { errorText, formatDateTime } from '../../lib/labels.js';
import { invalidateWbTargets } from '../../lib/wbTargets.js';

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 한 WorkBench 앱의 규칙 카드 — 구역(분류 목록에서 고르기)·태그(자유 입력 + 자동완성)·저장. */
function TargetCard({ item, onSaved }) {
  const [zones, setZones] = useState(item.zones);
  const [tags, setTags] = useState(item.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setZones(item.zones); setTags(item.tags); }, [item]);
  const dirty = !same(zones, item.zones) || !same(tags, item.tags);

  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api(`/admin/wb-targets/${encodeURIComponent(item.target)}`, { method: 'PUT', body: { zones, tags } });
      invalidateWbTargets();
      onSaved(r);
      setNotice(r.condition ? `저장했습니다 — ${r.condition}.` : '저장했습니다 — 이제 제한 없이 보낼 수 있습니다.');
    } catch (err) {
      setError(errorText(err, '저장하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={item.label} className="rounded-lg border border-n-200 bg-n-0 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <SectionTitle>{item.label}</SectionTitle>
        <span className="font-mono text-meta text-n-500">{item.target}</span>
        {item.updated_at && (
          <span className="ml-auto text-meta text-n-500">
            {item.updated_by ? `${item.updated_by} · ` : ''}{formatDateTime(item.updated_at)}
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-meta font-medium text-n-700">필요한 구역</p>
          <VocabInput kind="zone" label={`${item.label} 필요한 구역`} multiple values={zones} onChange={setZones}
                      disabled={busy} placeholder="구역 목록에서 고르기" />
        </div>
        <div>
          <p className="mb-1 text-meta font-medium text-n-700">필요한 태그</p>
          <ChipInput kind="tag" label={`${item.label} 필요한 태그`} values={tags} onChange={setTags} disabled={busy}
                     placeholder="태그 입력 후 Enter" />
        </div>
      </div>
      <p className="mt-2 text-meta text-n-500">
        하나라도 맞으면 보낼 수 있습니다. 비워 두면 제한하지 않습니다. 태그는 동의어도 함께 맞춥니다.
      </p>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      {notice && <OkNote className="mt-3">{notice}</OkNote>}
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!dirty || busy} loading={busy} onClick={save}
                aria-label={`${item.label} 규칙 저장`}>
          {!busy && <Save size={14} aria-hidden="true" />}저장
        </Button>
      </div>
    </section>
  );
}

/** WorkBench 연결 규칙(관리자, 18-b) — WorkBench 앱마다 [WorkBench로 보내기]에 필요한 구역·태그. 변경은 기록된다. */
export default function WbRulesPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api('/admin/wb-targets')
      .then((r) => { if (alive) setItems(r); })
      .catch((err) => { if (alive) setError(errorText(err, '규칙을 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);

  const replace = (r) => setItems((cur) => cur.map((it) => (it.target === r.target ? { ...it, ...r } : it)));

  return (
    <Page>
      <PageHeader title="WorkBench 연결 규칙"
                  description="WorkBench 앱마다 LogBook 에서 보낼 수 있는 자료를 구역·태그로 정합니다. 조건에 맞지 않는 모델은 목록에 그대로 보이고 [WorkBench로 보내기]만 잠깁니다." />
      {error && <ErrorNote className="mb-4 max-w-[960px]">{error}</ErrorNote>}
      {!items && !error && <RowsSkeleton rows={4} label="규칙을 불러오는 중" />}
      {items && (
        <div className="flex max-w-[960px] flex-col gap-4">
          {items.map((it) => <TargetCard key={it.target} item={it} onSaved={replace} />)}
        </div>
      )}
    </Page>
  );
}
