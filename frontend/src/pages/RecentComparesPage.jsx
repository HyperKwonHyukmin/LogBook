import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Columns2 } from 'lucide-react';
import { RecentCompareCard } from '../components/compare/RecentCompares.jsx';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import { useConfirm } from '../components/ui/ConfirmDialog.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { errorText } from '../lib/labels.js';
import { clearRecent, listRecent, removeRecent } from '../lib/recentCompares.js';

/** 최근 비교(11, `/compares`) — 내가 연 모델 비교를 마지막에 연 순서로. 다른 PC 에서도 같은 목록. */
export default function RecentComparesPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [confirm, dialog] = useConfirm();
  const toast = useToast();

  useEffect(() => {
    let live = true;
    setError('');
    listRecent().then((r) => { if (live) setItems(r); },
      (err) => { if (live) { setItems((cur) => cur || []); setError(errorText(err, '최근 비교를 불러오지 못했습니다.')); } });
    return () => { live = false; };
  }, [attempt]);

  /** 한 줄 지우기 — 기록만 지우고(모델·자료는 그대로) 실패하면 되돌린다. */
  async function remove(item) {
    setBusy(item.id);
    const before = items;
    setItems((cur) => cur.filter((x) => x.id !== item.id));
    try {
      await removeRecent(item.id);
    } catch (err) {
      if (err?.status !== 404) {
        setItems(before);
        toast.show({ tone: 'err', message: errorText(err, '지우지 못했습니다.') });
      }
    } finally {
      setBusy(null);
    }
  }
  async function removeAll() {
    const ok = await confirm({ title: '최근 비교를 모두 지울까요?', body: '비교 기록만 지웁니다. 모델과 자료는 그대로입니다.',
                               confirmLabel: '모두 지우기' });
    if (!ok) return;
    try {
      await clearRecent();
      setItems([]);
    } catch (err) {
      toast.show({ tone: 'err', message: errorText(err, '지우지 못했습니다.') });
    }
  }

  return (
    <Page>
      {dialog}
      <PageHeader title="최근 비교"
                  description="모델 비교 화면을 2개 이상 모델로 열면 여기에 남습니다. 다른 PC 에서 로그인해도 같은 목록이 보입니다(최근 20개)."
                  actions={items?.length > 0 && <Button variant="ghost" size="sm" onClick={removeAll}>모두 지우기</Button>} />
      {error && (
        <ErrorNote className="mb-4"
                   action={<Button variant="ghost" size="sm" className="-my-1" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>
          {error}
        </ErrorNote>
      )}
      {!items && <BlockSkeleton className="h-48" />}
      {items?.length === 0 && !error && (
        <EmptyState icon={Columns2} title="아직 연 비교가 없습니다"
                    action={<Link to="/?unit=file&kind=model" className={buttonClass('secondary', 'sm')}>BDF 모델 찾기</Link>}>
          검색 결과(파일 보기)·자료 미리보기에서 BDF 모델을 '비교에 담기'로 2개 이상 담고 비교를 열면 여기에 남습니다.
        </EmptyState>
      )}
      {items?.length > 0 && (
        <ul aria-label="최근 비교" className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2 min-[1300px]:grid-cols-3">
          {items.map((it) => (
            <li key={it.id} className="flex min-w-0"><RecentCompareCard item={it} onRemove={remove} removing={busy === it.id} /></li>
          ))}
        </ul>
      )}
    </Page>
  );
}
