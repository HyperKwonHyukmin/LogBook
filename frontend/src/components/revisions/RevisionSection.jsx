import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Box, GitCompareArrows, Layers } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import { inputClass } from '../ui/Field.jsx';
import Spinner from '../ui/Spinner.jsx';
import { useConfirm } from '../ui/ConfirmDialog.jsx';
import { SectionTitle } from '../ui/Page.jsx';
import { useToast } from '../ui/Toast.jsx';
import { errorText } from '../../lib/labels.js';
import { diffStatus, editorState, hasPending, layoutBody } from '../../lib/revisions.js';
import { diffHref } from '../../lib/revisionDiff3d.js';
import RevisionDiffPanel from './RevisionDiffPanel.jsx';
import { WidgetBoundary } from '../ui/ErrorBoundary.jsx';
import RevisionEditor from './RevisionEditor.jsx';
import { SendToWorkbenchButton } from '../workbench/WorkbenchSend.jsx';

const POLL_MS = 4000;
const POLL_MAX = 60;          // 4초 × 60 = 4분까지 기다린다(그 뒤엔 새로 고침)

/** GET /entries/{id}/revisions — 비교가 기다리는 중이면 다시 읽는다. */
export function useRevisions(entryId, reloadKey) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    let timer = null;
    let polls = 0;
    async function load() {
      try {
        const d = await api(`/entries/${encodeURIComponent(entryId)}/revisions`);
        if (!live) return;
        setData(d); setFailed(false);
        if (d.series.some((s) => hasPending(s.diffs)) && polls < POLL_MAX) {
          polls += 1;
          timer = setTimeout(load, POLL_MS);
        }
      } catch {
        if (live) setFailed(true);
      }
    }
    load();
    return () => { live = false; clearTimeout(timer); };
  }, [entryId, reloadKey, tick]);
  return { data, setData, failed, reload: () => setTick((t) => t + 1) };
}

const TONE = {
  ok: 'bg-n-100 text-n-700 hover:bg-n-150',
  busy: 'bg-n-50 text-n-600 hover:bg-n-100',
  wait: 'bg-wait-bg text-wait hover:underline',
  err: 'bg-err-bg text-err hover:underline',
  none: 'bg-n-50 text-n-500 hover:bg-n-100',
};

/** 판 사이 변경 칩 — 누르면 변경 요약. */
function DiffChip({ diff, active, onOpen, label }) {
  const st = diffStatus(diff);
  return (
    <button type="button" onClick={onOpen} aria-pressed={active} aria-label={`${label} 변경 요약: ${st.text}`}
            title={st.text}
            className={`inline-flex h-6 max-w-[320px] shrink items-center gap-1 rounded-sm px-1.5 text-micro font-medium transition-colors duration-150
              ${active ? 'bg-brand-subtle text-brand ring-1 ring-brand-muted' : TONE[st.tone]}`}>
      {st.tone === 'busy' && <Spinner size={10} />}
      <span className="truncate">{st.text}</span>
    </button>
  );
}

/** 칩 옆 작은 단추 — 그 두 판의 3D 변경 보기(비교가 끝났고 바뀐 것이 있을 때만). */
function Diff3dButton({ diff, label }) {
  const navigate = useNavigate();
  if (!diff || diff.state !== 'done' || diff.stale || !diff.summary || diff.summary.identical) return null;
  return (
    <button type="button" onClick={() => navigate(diffHref(diff.a, diff.b))} aria-label={`${label} 3D 변경 보기`}
            title="3D 로 변경 보기 — 추가·변경·삭제를 색으로"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-n-500 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
      <Box size={13} aria-hidden="true" />
    </button>
  );
}

/** 판 하나 — 누르면 그 파일 미리보기. */
function RevNode({ item, selected, onPick }) {
  return (
    <button type="button" onClick={() => onPick(item.file_id)} aria-current={selected || undefined}
            aria-label={`${item.display} ${item.name}${item.is_latest ? ' (최신판)' : ''}`}
            title={`${item.rel_path}${item.mark ? `\n파일 이름의 판 표시: ${item.mark}` : ''}`}
            className={`inline-flex h-7 min-w-0 max-w-[220px] shrink items-center gap-1.5 rounded-md border px-2 text-meta transition-colors duration-150
              ${selected ? 'border-brand-muted bg-brand-subtle text-brand' : 'border-n-200 bg-n-0 text-n-800 hover:bg-n-50'}`}>
      <span className="shrink-0 font-semibold">{item.display}</span>
      <span className="min-w-0 truncate text-n-600">{item.name}</span>
      {item.is_latest && <span className="shrink-0 rounded-xs bg-brand-subtle px-1 text-micro font-medium text-brand">최신</span>}
    </button>
  );
}

/** 두 판 고르기 — 같은 자료의 모델 아무 둘(계열 밖도). */
function PairPicker({ models, onCompare, onCancel }) {
  const [a, setA] = useState(models[0]?.file_id ?? '');
  const [b, setB] = useState(models[1]?.file_id ?? '');
  const sel = (label, value, set) => (
    <select aria-label={label} value={value} onChange={(e) => set(Number(e.target.value))} className={`${inputClass('h-7 max-w-[260px] text-meta')} pr-6`}>
      {models.map((m) => <option key={m.file_id} value={m.file_id}>{m.display ? `${m.display} · ` : ''}{m.name}</option>)}
    </select>
  );
  return (
    <div role="group" aria-label="두 판 고르기" className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-n-200 bg-n-50 px-2 py-1.5">
      <span className="text-meta text-n-700">앞</span>{sel('앞 판', a, setA)}
      <ArrowRight size={14} className="text-n-400" aria-hidden="true" />
      <span className="text-meta text-n-700">뒤</span>{sel('뒤 판', b, setB)}
      <Button size="sm" disabled={!a || !b || a === b} onClick={() => onCompare(a, b)}>비교</Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>닫기</Button>
      {a === b && <span className="text-meta text-n-500">서로 다른 두 모델을 고르세요.</span>}
    </div>
  );
}

/**
 * 판 흐름 줄(14 D) — Entry 상세 파일 영역 위. 계열마다 R0 → R1 → R2 와 판 사이 변경 칩.
 * 칩을 누르면 변경 요약, [두 판 고르기]로 임의 비교, [판 정리](올린 사람·관리자)로 계열을 고친다.
 * props: entryId, selectedId·onPick(미리보기 파일), locked(정보 고치는 중), onEditingChange, onSaved(이력 다시 읽기)
 */
export default function RevisionSection({ entryId, selectedId, onPick, locked = false, onEditingChange, onSaved }) {
  const { data, setData, failed, reload } = useRevisions(entryId, 0);
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const [open, setOpen] = useState(null);         // { a, b, names, request }
  const [picking, setPicking] = useState(false);
  const [edit, setEdit] = useState(null);         // 판 정리 상태
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => { setOpen(null); setPicking(false); setEdit(null); }, [entryId]);
  useEffect(() => { onEditingChange?.(!!edit); }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed || !data) return null;           // 판 묶음은 덧붙는 정보 — 못 읽으면 조용히 빠진다
  const allModels = [...data.series.flatMap((s) => s.items), ...data.others];
  if (allModels.length < 2 && !edit) return null;   // 모델이 하나뿐이면 판 이야기가 없다

  const nameOf = (id) => {
    const it = allModels.find((x) => x.file_id === id);
    return it ? `${it.display ? `${it.display} · ` : ''}${it.name}` : `#${id}`;
  };
  const openDiff = (a, b, request = false) => {
    setOpen((cur) => (cur && cur.a === a && cur.b === b && !request ? null : { a, b, request, names: { a: nameOf(a), b: nameOf(b) } }));
  };

  async function save() {
    setSaving(true); setEditError('');
    try {
      const d = await api(`/entries/${encodeURIComponent(entryId)}/revisions`, { method: 'PUT', body: layoutBody(edit, data.token) });
      setData(d); setEdit(null); onSaved?.();
      toast.show({ message: '판 정리를 저장했습니다.' });
    } catch (err) {
      setEditError(err?.detail === 'revisions_conflict'
        ? '다른 사람이 그 사이 판을 정리했습니다. [취소] 후 다시 열어 주세요.'
        : errorText(err, '저장하지 못했습니다.'));
    } finally { setSaving(false); }
  }
  async function reset() {
    const ok = await confirm({ title: '자동 추정으로 되돌릴까요?', body: '이 자료에서 사람이 정한 판 순서·최신판·판 이름이 모두 사라지고 파일 이름·내용으로 다시 묶습니다.',
                               confirmLabel: '되돌리기', cancelLabel: '그대로 두기' });
    if (!ok) return;
    setSaving(true); setEditError('');
    try {
      const d = await api(`/entries/${encodeURIComponent(entryId)}/revisions/reset`, { method: 'POST' });
      setData(d); setEdit(null); onSaved?.();
      toast.show({ message: '자동 추정으로 되돌렸습니다.' });
    } catch (err) {
      setEditError(errorText(err, '되돌리지 못했습니다.'));
    } finally { setSaving(false); }
  }

  return (
    <section aria-label="판" className="mb-4">
      {dialog}
      <div className="mb-2 flex h-7 items-center gap-2">
        <SectionTitle className="flex items-center gap-1.5"><Layers size={14} className="text-n-400" aria-hidden="true" />판
          {data.series.length > 0 && <span className="font-mono font-normal text-n-500">{data.series.reduce((k, s) => k + s.items.length, 0)}</span>}
        </SectionTitle>
        {data.manual && <span className="text-meta text-n-500" title="사람이 정리한 판 배치입니다">정리됨</span>}
        <div className="flex-1" />
        {allModels.length >= 2 && !edit && (
          <Button variant="ghost" size="sm" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            <GitCompareArrows size={14} aria-hidden="true" />두 판 고르기
          </Button>
        )}
        {data.can_edit && !edit && (
          <Button variant="ghost" size="sm" disabled={locked} title={locked ? '정보 고치기를 먼저 끝내 주세요' : '계열·순서·최신판을 고칩니다'}
                  onClick={() => { setEdit(editorState(data)); setEditError(''); setOpen(null); setPicking(false); }}>
            판 정리
          </Button>
        )}
      </div>
      {picking && !edit && (
        <PairPicker models={allModels} onCancel={() => setPicking(false)}
                    onCompare={(a, b) => { setPicking(false); openDiff(a, b, true); }} />
      )}
      {edit ? (
        <RevisionEditor state={edit} setState={setEdit} saving={saving} error={editError}
                        onSave={save} onCancel={() => { setEdit(null); setEditError(''); }} onReset={reset} canReset={data.manual} />
      ) : (
        <>
          {data.series.length === 0 && <p className="mb-2 text-meta text-n-500">판으로 묶인 BDF 가 없습니다.</p>}
          <ul aria-label="판 흐름" className="flex flex-col gap-1.5">
            {data.series.map((s) => {
              // 18 — WorkBench 가 연 창이면 최신판(없으면 마지막 판) 옆에 보내기 단추
              const sendId = (s.items.find((x) => x.is_latest) || s.items[s.items.length - 1])?.file_id;
              return (
              <li key={s.key} aria-label={`판 흐름 ${s.items[0]?.name}`} className="flex min-w-0 flex-wrap items-center gap-1.5">
                {s.items.map((it, k) => {
                  const d = s.diffs[k - 1];
                  const label = k > 0 ? `${s.items[k - 1].display} → ${it.display}` : '';
                  return (
                    <span key={it.file_id} className="flex min-w-0 items-center gap-1.5">
                      {k > 0 && (
                        <>
                          <ArrowRight size={14} className="shrink-0 text-n-400" aria-hidden="true" />
                          <DiffChip diff={d} label={label} active={open?.a === d?.a && open?.b === d?.b}
                                    onOpen={() => openDiff(s.items[k - 1].file_id, it.file_id)} />
                          <Diff3dButton diff={d} label={label} />
                          <ArrowRight size={14} className="shrink-0 text-n-400" aria-hidden="true" />
                        </>
                      )}
                      <RevNode item={it} selected={it.file_id === selectedId} onPick={onPick} />
                      {it.file_id === sendId && (
                        <SendToWorkbenchButton file={{ id: it.file_id, name: it.name, kind: 'model' }} entryId={entryId}
                                               compact />
                      )}
                    </span>
                  );
                })}
              </li>
              );
            })}
          </ul>
          {open && (
            <div className="mt-2">
              <WidgetBoundary what="판 비교" resetKey={`${open.a}-${open.b}`} className="rounded-lg border border-n-200">
                <RevisionDiffPanel key={`${open.a}-${open.b}`} a={open.a} b={open.b} names={open.names} request={open.request}
                                   onClose={() => { setOpen(null); reload(); }} />
              </WidgetBoundary>
            </div>
          )}
        </>
      )}
    </section>
  );
}
