import { useContext, useEffect, useRef, useState } from 'react';
import { FolderUp, RotateCw, Upload, UploadCloud } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import DuplicateBlockedNotice from './DuplicateBlocked.jsx';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { collectFromDrop, collectFromInput } from '../../lib/upload.js';
import { IDLE_JOB, createUploadStore } from '../../lib/uploadStore.js';
import { formatBytes } from '../../lib/labels.js';
import { isAdminLevel } from '../../lib/levels.js';
import { isOsFileDrag, useUploadSnapshot, useUploadStore, useUploadWindowGuards } from './UploadProvider.jsx';

export { isOsFileDrag };

/** 화면 덮개 대신 자기가 받는 놓기 칸(예: 정리 대기의 초안 카드). 덮개는 이 칸에 놓인 것을 가져가지 않는다. */
export const DROP_ZONE_ATTR = 'data-drop-zone';
const inDropZone = (target) => typeof target?.closest === 'function' && !!target.closest(`[${DROP_ZONE_ATTR}]`);

/** 탐색기에서 파일을 끌고 창 안에 들어와 있는 동안 true. */
export function useOsFileDragActive() {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const enter = (e) => { if (!isOsFileDrag(e)) return; depth.current += 1; setActive(true); };
    const leave = (e) => { if (!isOsFileDrag(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setActive(false); };
    const end = () => { depth.current = 0; setActive(false); };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, []);
  return active;
}

/**
 * 폴더·여러 파일 → 한 배치로 올리는 상태. DRM 파일은 거부하고 탐색기 경로를 안내한다.
 * 상태는 셸의 올리기 저장소(UploadProvider)에 scope 별로 있다 — 이 화면을 떠나도 올리기는 계속되고,
 * 진행률은 오른쪽 아래 떠 있는 상자로 옮겨 보이며, 돌아오면 이 화면이 다시 이어받는다.
 * 저장소가 없으면(단독 렌더 테스트) 이 훅이 자기 저장소를 하나 만든다.
 * scope: 올리기 칸 이름('inbox', 'draft:E…', 'entry:E…'). away: 화면을 떠난 뒤 끝났을 때 셸 토스트 {message, to, label, title}.
 * targetEntryId: 기존 Entry 에 추가로 올릴 때.
 * 17 — 서버가 완전 동일 BDF 를 받지 않으면 result.blocked 에 온다. 모두 막히면 배치가 없어 onUploaded 를 부르지 않는다.
 * LV3 는 forceBlocked() 로 막힌 파일(+ 함께 빠진 INCLUDE)을 '그래도 올리기' 한다(새 배치, 서버 감사 기록).
 */
export function useUploader({ scope = 'upload', onUploaded, disabled = false, targetEntryId, targetEntryStatus, away }) {
  const auth = useContext(AuthContext); // 단독 렌더(테스트)에서는 없을 수 있다
  const canForce = isAdminLevel(auth?.user);
  const shared = useUploadStore();
  const localRef = useRef(null);
  if (!shared && !localRef.current) localRef.current = createUploadStore();
  const store = shared || localRef.current;
  useUploadWindowGuards(shared ? null : store); // 셸 저장소면 UploadProvider 가 건다
  const snap = useUploadSnapshot(store);
  const job = snap.jobs[scope] || IDLE_JOB;
  const handler = useRef(null);
  handler.current = { onUploaded };
  useEffect(() => store.attach(scope, handler), [store, scope]);
  const fileRef = useRef(null);
  const dirRef = useRef(null);
  return uploaderView(store, scope, job, {
    disabled, canForce, fileRef, dirRef, opts: { targetEntryId, targetEntryStatus, away },
  });
}

/** 저장소의 한 scope 를 화면용 객체로(useUploader 와 셸의 떠 있는 상자가 같이 쓴다). */
export function uploaderView(store, scope, job, { disabled = false, canForce = false, fileRef = null, dirRef = null, opts = {} } = {}) {
  return {
    ...job, scope, disabled, fileRef, dirRef, canForce,
    start: (items, { force = false } = {}) => store.start(scope, items, { ...opts, force }),
    /** 끌어 놓기 — 폴더 펼치기부터 '파일 확인 중'으로 보이고, 그동안 또 놓으면 안내만 한다. */
    onDrop: (dataTransfer) => {
      if (disabled) return;
      store.start(scope, (onCount) => collectFromDrop(dataTransfer, { onCount }), opts);
    },
    forceBlocked: canForce ? () => store.forceBlocked(scope) : null,
    cancel: () => store.cancel(scope),
    resume: () => store.resume(scope),
    dismiss: () => store.dismiss(scope),
  };
}

/** 파일 선택·폴더 선택 단추(숨은 input 포함). */
export function UploadButtons({ u, size = 'sm' }) {
  const off = u.disabled || u.busy;
  return (
    <>
      <input ref={u.fileRef} type="file" multiple hidden aria-label="파일 선택" disabled={off}
             onChange={(e) => { u.start(collectFromInput(e.target.files)); e.target.value = ''; }} />
      <input ref={u.dirRef} type="file" hidden webkitdirectory="" aria-label="폴더 선택" disabled={off}
             onChange={(e) => { u.start(collectFromInput(e.target.files)); e.target.value = ''; }} />
      <Button variant="secondary" size={size} disabled={off} onClick={() => u.fileRef.current?.click()}>
        <Upload size={14} aria-hidden="true" />파일 선택
      </Button>
      <Button variant="secondary" size={size} disabled={off} onClick={() => u.dirRef.current?.click()}>
        <FolderUp size={14} aria-hidden="true" />폴더 선택
      </Button>
    </>
  );
}

/** 진행률·결과·오류·DRM 거부·건너뛴 파일 목록, [취소]·[이어 올리기]. */
export function UploadFeedback({ u, showSuccess = true }) {
  const { phase, checked, checkTotal, progress, result, error, notice, info, busy, disabled, resumable } = u;
  const checking = busy && phase === 'checking';
  const canceling = busy && phase === 'canceling';
  const uploading = busy && !checking && !canceling;
  const shown = progress || { sent: 0, total: 0 };
  const pct = progress ? Math.floor((progress.sent / Math.max(progress.total, 1)) * 100) : 0;
  const any = disabled || busy || resumable || info || (showSuccess && result?.uploaded > 0) || error
    || result?.rejected?.length > 0 || result?.skipped?.length > 0 || result?.blocked?.length > 0;
  if (!any) return null;
  return (
    <div className="flex flex-col gap-2">
      {disabled && <p className="text-meta text-err">999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.</p>}
      {checking && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-meta text-n-600">
          <Spinner size={12} />
          <span className="min-w-0 flex-1">
            파일 확인 중 <span className="font-mono">{checked}</span>{checkTotal != null && <> / <span className="font-mono">{checkTotal}</span></>}개
          </span>
          <Button variant="ghost" size="sm" onClick={u.cancel}>취소</Button>
        </div>
      )}
      {uploading && (
        <div aria-live="polite">
          <div className="flex items-center gap-2 text-meta text-n-600">
            <span className="min-w-0 flex-1">올리는 중…</span>
            <span className="font-mono">{formatBytes(shown.sent)} / {formatBytes(shown.total)} · {pct}%</span>
            <Button variant="ghost" size="sm" onClick={u.cancel}>취소</Button>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-n-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="올리기 진행률">
            <div className="h-full bg-brand transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {canceling && (
        <p role="status" className="flex items-center gap-2 text-meta text-n-600"><Spinner size={12} />취소하는 중…</p>
      )}
      {showSuccess && result && result.uploaded > 0 && !busy && !resumable && (
        <p role="status" className="rounded-md bg-n-50 px-3 py-2 text-ui text-n-800">
          {result.uploaded}개 파일을 올렸습니다. 잠시 뒤 아래에 묶음 제안이 나타납니다.
          {result.deferred > 0 && <> 큰 BDF <span className="font-mono">{result.deferred}</span>개는 같은 BDF 가 있는지 이어서 확인합니다.</>}
        </p>
      )}
      {/* 17 — 완전 동일 BDF 로 받지 않은 파일(안내, 오류 아님). LV3 에게만 [그래도 올리기] */}
      {result?.blocked?.length > 0 && !busy && (
        <DuplicateBlockedNotice blocked={result.blocked} uploaded={result.uploaded} busy={busy}
                                canForce={u.canForce} onForce={u.forceBlocked} />
      )}
      {notice && busy && <p className="text-meta text-wait">{notice}</p>}
      {/* 도중에 멈춤 — 서버의 반쪽 배치는 그대로 두고 이어 보낼 수 있다 */}
      {resumable && !busy && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
          <span className="min-w-0 flex-1">
            올리기가 중간에 멈췄습니다. {error}
            {progress && <> <span className="font-mono">{formatBytes(progress.sent)} / {formatBytes(progress.total)}</span> 까지 보냈습니다.</>}
          </span>
          <span className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={u.resume}><RotateCw size={14} aria-hidden="true" />이어 올리기</Button>
            <Button variant="ghost" size="sm" onClick={u.cancel}>취소</Button>
          </span>
        </div>
      )}
      {error && !resumable && <p role="alert" className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">{error}</p>}
      {info && !busy && <p role="status" className="text-meta text-n-600">{info}</p>}
      {result?.skipped?.length > 0 && !busy && (
        <div className="rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-meta text-wait">
          <p className="font-semibold">읽을 수 없는 파일 {result.skipped.length}개는 건너뛰었습니다. 다른 프로그램에서 열려 있는지 확인한 뒤 따로 올려 주세요.</p>
          <ul className="mt-1">{result.skipped.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {result?.rejected?.length > 0 && (
        <div className="rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-meta text-wait">
          <p className="font-semibold">DRM 암호화 파일 {result.rejected.length}개는 올리지 않았습니다. 탐색기로 00_Inbox 에 복사해 주세요(복사하면 암호가 풀립니다).</p>
          <ul className="mt-1">{result.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/**
 * 화면 전체를 놓는 곳으로 — 바깥에서 파일을 끌고 들어오면 덮개를 띄운다(평소에는 보이지 않는다).
 * 덮개는 놓기를 가로채지 않는다(pointer-events 없음). 놓기는 창(capture)에서 받되, 자기 칸이 있는
 * 곳(DROP_ZONE_ATTR, 예: 초안 카드)에 놓으면 그 칸에 맡긴다. 그런 칸이 있으면 위쪽 안내 띠로 두 곳을 설명한다.
 */
export function PageDropOverlay({ u }) {
  const active = useOsFileDragActive();
  const [onZone, setOnZone] = useState(false);
  const [hasZones, setHasZones] = useState(false);
  const ref = useRef(u);
  ref.current = u;
  useEffect(() => {
    if (active) setHasZones(!!document.querySelector(`[${DROP_ZONE_ATTR}]`));
    else setOnZone(false);
  }, [active]);
  useEffect(() => {
    const over = (e) => {
      if (!isOsFileDrag(e)) return;
      const zone = inDropZone(e.target);
      setOnZone(zone);
      if (!zone) e.preventDefault();
    };
    const drop = (e) => {
      if (!isOsFileDrag(e) || !(e.target instanceof Element) || inDropZone(e.target)) return;
      if (ref.current.busy) return; // 올리는 중 안내는 useUploader 가 한다
      e.preventDefault();
      ref.current.onDrop(e.dataTransfer);
    };
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragover', over, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);
  if (!active || u.busy) return null;
  // 초안 카드가 있으면 받는 곳이 둘이다(카드 = 그 초안에 첨부, 빈 곳 = 새 배치). 카드는 덮개 위로 올라오므로
  // 가운데 큰 상자 대신 위쪽 안내 띠 하나로 두 곳을 설명하고, 카드 위에서는 문구만 바꾼다(덮개를 숨겼다 켜지 않는다).
  if (hasZones) {
    return (
      <div className="pointer-events-none fixed inset-0 z-40 animate-fade bg-scrim">
        <div role="status" className="absolute left-1/2 top-16 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-lg bg-n-0 px-4 py-2.5 text-ui text-n-700 shadow-md">
          <UploadCloud size={16} className="shrink-0 text-brand" aria-hidden="true" />
          {u.disabled ? <span>지금은 새 배치로 올릴 수 없습니다. 999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.</span>
            : onZone ? <span><span className="font-semibold text-brand">초안 카드</span>에 놓으면 그 초안에 첨부합니다.</span>
              : <span>초안 카드에 놓으면 <span className="font-semibold text-n-900">그 초안에 첨부</span>, 빈 곳에 놓으면 <span className="font-semibold text-n-900">새 배치</span>로 올립니다.</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex animate-fade items-center justify-center bg-scrim p-6">
      <div className="flex h-full max-h-[420px] w-full max-w-[720px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-ring bg-brand-subtle text-center">
        <UploadCloud size={24} className="text-brand" aria-hidden="true" />
        <p className="text-body font-semibold text-brand">{u.disabled ? '지금은 올릴 수 없습니다' : '여기에 놓아 올리기'}</p>
        <p className="text-ui text-n-600">{u.disabled ? '999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.' : '한 번에 놓은 것이 한 배치가 됩니다.'}</p>
      </div>
    </div>
  );
}

/**
 * 기본 올리기 칸(기존 Entry 에 파일 추가 등) — 단추 한 줄 + 이 칸에 끌어 놓기.
 * showSuccess=false 면 성공 문구를 부모가 대신 보인다.
 */
export default function UploadZone({ onUploaded, disabled = false, targetEntryId, showSuccess = true, scope = 'zone', away }) {
  const u = useUploader({ scope, onUploaded, disabled, targetEntryId, away });
  const [over, setOver] = useState(false);
  return (
    <section aria-label="자료 올리기" className="flex flex-col gap-2">
      <div onDragOver={(e) => { if (!disabled && isOsFileDrag(e)) { e.preventDefault(); if (!u.busy) setOver(true); } }}
           onDragLeave={() => setOver(false)}
           onDrop={(e) => { if (!isOsFileDrag(e) && !e.dataTransfer?.files?.length) return; e.preventDefault(); setOver(false); u.onDrop(e.dataTransfer); }}
           className={`flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2.5 transition-colors duration-150
             ${over ? 'border-brand-ring bg-brand-subtle' : 'border-n-250 bg-n-25'}`}>
        <UploadButtons u={u} />
        <span className="text-meta text-n-500">또는 여기에 폴더·파일을 끌어 놓으세요. 큰 해석 폴더는 탐색기로 <span className="font-mono">00_Inbox</span> 에 복사해도 됩니다.</span>
      </div>
      <UploadFeedback u={u} showSuccess={showSuccess} />
    </section>
  );
}
