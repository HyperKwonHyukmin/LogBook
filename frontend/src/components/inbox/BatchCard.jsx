import { AlertCircle, Check, ChevronRight, FolderInput, Globe } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import DraftCard from './DraftCard.jsx';
import { DuplicateTargets } from './DuplicateBlocked.jsx';
import { BATCH_STATE_LABELS, EXCLUDE_REASON_LABELS } from '../../lib/labels.js';
import { MODEL_CONVERT_LABELS, convertCounts, stagedStatus } from '../../lib/inboxStatus.js';

const STATE_TONE = { failed: 'text-err', staged: 'text-n-600', processed: 'text-wait', done: 'text-ok', uploading: 'text-n-600' };

/** 접어 두는 설명 — 머리줄만 보이고, 누르면 펼친다(카드를 기본으로 키우지 않는다). */
function Explain({ summary, children }) {
  return (
    <details className="group rounded-md border border-n-200 text-meta text-n-600">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 px-3 hover:bg-n-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="text-n-400 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
        {summary}
      </summary>
      <div className="border-t border-n-200 px-3 py-2.5">{children}</div>
    </details>
  );
}

/** 분석 중 — 서버 처리 단계(지난 것 체크, 지금 것 스피너). */
function StepList({ steps }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <li key={s.id} aria-current={s.state === 'current' ? 'step' : undefined} className="flex gap-2">
          <span aria-hidden="true" className="mt-px flex h-4 w-4 shrink-0 items-center justify-center">
            {s.state === 'done' ? <Check size={14} className="text-n-700" />
              : s.state === 'current' ? <Spinner size={12} className="text-n-700" />
                : <span className="font-mono text-micro text-n-500">{i + 1}</span>}
          </span>
          <span className="min-w-0">
            <span className={`font-medium ${s.state === 'todo' ? 'text-n-600' : 'text-n-800'}`}>{s.label}</span>
            {s.state === 'done' && <span className="sr-only"> (끝남)</span>}
            {s.state === 'current' && <span className="sr-only"> (진행 중)</span>}
            <span className="block text-n-600">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 분석 중(staged) 진행 패널 — 작은 머리줄 글자만으로는 '지금 정리 중' 이 잘 보이지 않아(사용자 의견) 따로 띄운다.
 * 큰 스피너 + 제목 + 지금 하는 일 + 단계 4칸 + 진행 막대(파일 확인 단계는 n/N 만큼, 그 밖은 흐르는 막대).
 */
function StagedPanel({ status }) {
  const running = !!status.current;
  const wait = status.tone === 'wait';
  const title = running ? '정리하는 중입니다' : wait ? '정리를 다시 시도하려고 기다리는 중입니다' : '정리를 기다리는 중입니다';
  const at = status.steps.findIndex((s) => s.state === 'current');
  const pct = status.fraction != null && at >= 0 ? Math.round(((at + status.fraction) / status.steps.length) * 100) : null;
  return (
    <div role="status" aria-label="정리 진행"
         className={`overflow-hidden rounded-lg border ${wait ? 'border-wait-line bg-wait-bg' : 'border-brand-muted bg-brand-subtle'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Spinner size={22} className={`shrink-0 ${wait ? 'text-wait' : 'text-brand'}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-body font-semibold ${wait ? 'text-wait' : 'text-n-900'}`}>{title}</p>
          <p className="text-ui text-n-700">{status.line}</p>
        </div>
        {running && (
          <ol aria-label="처리 단계" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-meta">
            {status.steps.map((s, i) => (
              <li key={s.id} aria-current={s.state === 'current' ? 'step' : undefined} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-n-400" aria-hidden="true" />}
                <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 ${
                  s.state === 'current' ? 'bg-n-0 font-semibold text-brand shadow-xs'
                    : s.state === 'done' ? 'text-n-700' : 'text-n-500'}`}>
                  {s.state === 'done' && <Check size={12} aria-hidden="true" />}
                  {s.label}
                  {s.state === 'done' && <span className="sr-only"> (끝남)</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className={`h-1 overflow-hidden ${wait ? 'bg-wait-line' : 'bg-brand-muted'}`}
           role="progressbar" aria-label="정리 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        {pct != null
          ? <div className="h-full bg-brand transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
          : !wait && <div className="progress-indeterminate h-full w-[30%] animate-progress bg-brand" />}
      </div>
    </div>
  );
}

/** 분석 중(staged) — 진행 패널(또는 꺼진 워커 알림) + '무엇을 하나요?' 펼침. */
function StagedDetail({ status }) {
  return (
    <>
      {!status.workerDown && <StagedPanel status={status} />}
      {status.workerDown && (
        <p role="status" className="flex items-start gap-1.5 rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-ui text-wait">
          <AlertCircle size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
          {status.line}
        </p>
      )}
      <Explain summary="무엇을 하나요?">
        <p className="mb-2.5 text-n-700">
          올린 파일을 사람이 확인하기 좋게 <span className="font-medium">초안(미확정 자료)</span>으로 정리합니다.
          보통 몇 초에서 몇 분 걸리고, 끝나면 이 자리에 초안이 나타납니다. 이 화면을 닫아도 계속 진행됩니다.
        </p>
        <StepList steps={status.steps} />
      </Explain>
    </>
  );
}

/** 정리 대기(processed) — 왜 기다리는지. */
function ProcessedDetail({ converts }) {
  return (
    <Explain summary="왜 기다리나요?">
      <ul className="flex list-disc flex-col gap-1 pl-4 text-n-700 marker:text-n-400">
        <li>아래 초안은 서버가 폴더·파일 이름으로 <span className="font-medium">추정</span>한 것입니다. 호선·제목·구역·대상이 맞는지 사람이 확인해야 합니다.</li>
        <li>맞으면 초안마다 <span className="font-medium">확정</span>을 누르세요. 파일이 보관소(<span className="font-mono">10_Vault</span>)로 옮겨지고 검색·호선 화면의 정식 자료가 됩니다.</li>
        <li>확정 전에도 검색에는 ‘미분류’로 보이지만, 확정하지 않으면 이 목록에 계속 남습니다.</li>
        {converts.length > 0 && (
          <li>BDF 3D 변환은 확정과 따로 진행됩니다. 변환이 끝나지 않아도 확정할 수 있고, 변환은 이어서 계속됩니다.</li>
        )}
      </ul>
    </Explain>
  );
}

/** 한 번에 올라온 배치 = 섹션 — 머리(출처·받은 시각·상태·지금 하는 일) + 설명 + 제외 목록 + 초안들. */
export default function BatchCard({ batch, me, isAdmin, canWrite = true, onChanged, onClaim, onDirtyChange }) {
  const mine = batch.uploader === me;
  const drafts = batch.entries || [];
  const SourceIcon = batch.source === 'web' ? Globe : FolderInput;
  const staged = batch.state === 'staged' ? stagedStatus(batch) : null;
  const converts = convertCounts(drafts.flatMap((d) => d.files || []));
  const dupCount = (batch.excluded || []).filter((x) => x.reason === 'duplicate_model').length;
  return (
    <section aria-label={`배치 ${batch.original_name}`} className="flex flex-col gap-3">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <SourceIcon size={14} className="text-n-400" aria-hidden="true" title={batch.source === 'web' ? '웹에서 올림' : '00_Inbox 에서 받음'} />
        <h2 className="text-ui font-semibold text-n-900">{batch.original_name}</h2>
        <span className="font-mono text-meta text-n-500">{batch.received_at ? batch.received_at.replace('T', ' ').slice(0, 16) : '—'}</span>
        <span className={`inline-flex items-center gap-1.5 text-meta font-medium ${STATE_TONE[batch.state] || 'text-n-600'}`}>
          {batch.state === 'staged' ? <Spinner size={12} /> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
          {BATCH_STATE_LABELS[batch.state] || batch.state}
        </span>
        {drafts.length > 0 && (
          <span className="text-meta text-n-500">
            초안 <span className="font-mono">{drafts.length}</span>개 · 확인 후 확정하세요
          </span>
        )}
        {converts.length > 0 && (
          <span className="inline-flex items-center gap-1 text-meta text-n-500" title="BDF 3D 변환 상태">
            {converts.some((c) => c.state === 'running') && <Spinner size={11} className="text-n-500" />}
            BDF {converts.map((c) => `${MODEL_CONVERT_LABELS[c.state].replace('3D ', '')} ${c.count}`).join(' · ')}
          </span>
        )}
        {!batch.uploader && batch.owner_account && (
          <span className="text-meta text-n-500">파일 소유 계정 <span className="font-mono text-n-700">{batch.owner_account}</span></span>
        )}
        <div className="flex-1" />
        {!batch.uploader && canWrite && <Button size="sm" onClick={() => onClaim(batch.key)}>내가 올렸어요</Button>}
      </div>
      {staged && <StagedDetail status={staged} />}
      {batch.attachment_target && <p role="status" className="text-meta text-n-600">
        <span className="font-mono">{batch.attachment_target}</span> 초안에 파일을 첨부 중입니다. 해당 초안의 파일 목록에 함께 표시됩니다.
      </p>}
      {batch.state === 'processed' && drafts.length > 0 && !batch.attachment_target && <ProcessedDetail converts={converts} />}
      {batch.state === 'failed' && (
        <p className="flex items-center gap-1.5 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
          <AlertCircle size={14} aria-hidden="true" />처리하지 못했습니다: {batch.error}
        </p>
      )}
      {batch.state === 'done' && drafts.length === 0 && dupCount > 0 && (
        // 17 — 탐색기로 넣은 BDF 가 모두 이미 있는 자료와 같아 초안 없이 끝난 배치(서버가 며칠 남겨 둔다)
        <p className="text-meta text-n-600">이미 있는 자료와 같은 BDF 뿐이라 초안을 만들지 않았습니다. 아래 목록에서 같은 자료를 열어 보세요.</p>
      )}
      {batch.excluded?.length > 0 && (
        // 17 — 동일 BDF 로 뺀 파일이 있으면 펼쳐 둔다(왜 초안에 없는지 바로 보이게). 대상은 서버가 권한으로 거른 것
        <details open={dupCount > 0 || undefined} className="group rounded-md border border-n-200 text-meta text-n-600">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 px-3 hover:bg-n-50 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="text-n-400 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
            제외된 파일 <span className="font-mono">{batch.excluded.length}</span>개
            {dupCount > 0 && <span className="text-n-600">· 동일 BDF <span className="font-mono">{dupCount}</span>개는 올리지 않았습니다</span>}
          </summary>
          <ul className="space-y-1.5 border-t border-n-200 px-3 py-2">
            {batch.excluded.map((x) => (
              <li key={x.name} className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap gap-x-2">
                  <span className="break-all text-n-800">{x.name}</span>
                  {x.reason && (
                    <span className={x.reason.startsWith('duplicate_') ? 'text-n-700' : 'text-wait'}>
                      {EXCLUDE_REASON_LABELS[x.reason] || x.reason}
                      {x.reason === 'duplicate_include' && x.of && <> ({x.of})</>}
                    </span>
                  )}
                </span>
                {x.reason === 'duplicate_model' && <DuplicateTargets item={x} />}
                {x.reason === 'duplicate_model' && x.kept && (
                  <span className="text-n-600">원본은 서버 보관 폴더(<span className="font-mono">10_Vault\_staging\{batch.key}</span>)에 남겨 두었습니다.</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {drafts.map((d) => (
        <DraftCard key={d.entry_id} entry={d} canEdit={canWrite && (mine || isAdmin)}
                   siblings={drafts.filter((s) => s.entry_id !== d.entry_id).map((s) => ({ entry_id: s.entry_id, title: s.title }))}
                   onChanged={onChanged} onDirtyChange={onDirtyChange} />
      ))}
    </section>
  );
}
