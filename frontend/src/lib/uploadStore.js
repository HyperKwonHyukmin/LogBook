/**
 * 올리기 상태 저장소 — 화면(컴포넌트)보다 오래 산다.
 *
 * 셸(AppShell)이 하나를 들고 있어, 올리던 화면을 떠나도(앱 안 이동) 올리기는 계속되고 진행률은
 * 오른쪽 아래 떠 있는 상자(GlobalDrop)로 옮겨 보인다. 같은 화면으로 돌아오면 그 화면이 다시 이어받는다.
 * 올리기는 scope(예: 'inbox', 'draft:E000010', 'entry:E000123') 마다 하나씩이다.
 *
 * job 은 바뀔 때마다 새 객체(useSyncExternalStore 용 불변 스냅숏)이고, AbortController·세션처럼
 * 화면에 보일 필요가 없는 것은 runtime 에 따로 둔다.
 */
import { errorText } from './labels.js';
import {
  blockedPaths, cancelUpload, continueUpload, isAbortError, isRetryable, uploadBatch,
} from './upload.js';

export const BUSY_NOTICE = '올리는 중입니다. 지금 올리기가 끝난 뒤 다시 놓아 주세요.';

export const IDLE_JOB = Object.freeze({
  busy: false,
  phase: null,        // 'checking'(파일 확인 중) | 'uploading' | 'canceling'
  checked: 0,
  checkTotal: null,
  progress: null,     // {sent, total}
  result: null,       // {key, uploaded, rejected, skipped, blocked, deferred}
  error: '',
  resumable: false,   // [이어 올리기]를 보일까
  notice: '',         // 올리는 중 두 번째 놓기 안내
  info: '',           // 취소 결과 등 한 줄 안내
});

const CANCEL_INFO = {
  removed: '올리기를 취소했습니다.',
  finished: '서버가 이미 다 받은 뒤라 취소하지 못했습니다. 정리 대기에서 확인해 주세요.',
  failed: '올리기를 멈췄습니다. 서버에 남은 임시 파일은 하루 안에 자동으로 정리됩니다.',
};

/**
 * deps 는 테스트에서 바꿔 끼운다(기본은 lib/upload.js).
 */
export function createUploadStore({
  upload = uploadBatch, resumeUpload = continueUpload, cancelRemote = cancelUpload,
} = {}) {
  let jobs = {};
  let attached = {};
  let snapshot = { jobs, attached };
  const runtime = {};          // scope → { ctrl, session, items, opts, done(Promise) }
  const handlers = {};         // scope → ref({ onUploaded })
  const listeners = new Set();
  const orphanListeners = new Set();

  const emit = () => {
    snapshot = { jobs, attached };
    listeners.forEach((l) => l());
  };
  const put = (scope, job) => { jobs = { ...jobs, [scope]: job }; emit(); };
  const patch = (scope, p) => put(scope, { ...(jobs[scope] || IDLE_JOB), ...p });
  const clear = (scope) => {
    if (!jobs[scope]) return;
    const { [scope]: _drop, ...rest } = jobs;
    jobs = rest;
    delete runtime[scope];
    emit();
  };
  const getJob = (scope) => jobs[scope] || IDLE_JOB;
  /** 화면에 남길 것(거부·건너뜀·막힘·오류·안내)이 없는 끝난 올리기인가. */
  const quiet = (job) => !job.busy && !job.resumable && !job.error && !job.info
    && !job.result?.rejected?.length && !job.result?.skipped?.length && !job.result?.blocked?.length;

  function succeed(scope, ctrl, res) {
    const rt = runtime[scope];
    if (rt?.ctrl !== ctrl) return;
    rt.session = null;
    put(scope, { ...IDLE_JOB, result: res });
    if (!res.key) return;
    const h = handlers[scope];
    if (h) h.current.onUploaded?.(res.key);
    else {
      // 올리던 화면이 떠났다 — 셸이 토스트로 알린다. 남길 것이 없으면 상태도 비운다
      orphanListeners.forEach((l) => l({ scope, result: res, away: rt.opts.away }));
      if (quiet(jobs[scope])) clear(scope);
    }
  }

  function fail(scope, ctrl, err) {
    const rt = runtime[scope];
    if (rt?.ctrl !== ctrl) return;
    if (isAbortError(err)) { rt.session = err.session || null; return; } // [취소]가 마무리한다
    if (err?.code === 'all_drm' || err?.code === 'none_uploadable') {
      rt.session = null;
      put(scope, { ...IDLE_JOB, result: { uploaded: 0, rejected: err.rejected || [], skipped: err.skipped || [] },
        error: err.code === 'all_drm' ? '모든 파일이 DRM 암호화 상태라 올리지 않았습니다.'
          : '올릴 수 있는 파일이 없습니다. 읽을 수 없는 파일은 아래에 적었습니다.' });
      return;
    }
    const session = err?.session || null;
    // 일시 오류가 끝내 풀리지 않았다 → 서버 배치를 남기고 [이어 올리기]. 그 밖의 거절(4xx)은 다시 보내도 같아 배치를 치운다
    const resumable = !!session && isRetryable(err);
    if (session && !resumable) cancelRemote(session.key);
    rt.session = resumable ? session : null;
    put(scope, {
      ...IDLE_JOB,
      error: errorText(err, resumable ? '서버에 연결하지 못했습니다.' : '올리기에 실패했습니다. 다시 시도해 주세요.'),
      resumable,
      progress: resumable ? { sent: session.sent, total: session.total } : null,
      result: session ? { uploaded: session.done.size, rejected: [...session.rejected], skipped: [...session.skipped] } : null,
    });
  }

  function launch(scope, ctrl, work) {
    const rt = runtime[scope];
    const set = (p) => { if (runtime[scope]?.ctrl === ctrl) patch(scope, p); };
    rt.done = (async () => {
      try {
        succeed(scope, ctrl, await work(set));
      } catch (err) {
        fail(scope, ctrl, err);
      }
    })();
  }

  const store = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => snapshot,
    getJob,
    anyBusy: () => Object.values(jobs).some((j) => j.busy),
    /** scope 를 시작할 때 받은 opts(away 등). 셸의 떠 있는 상자가 제목·토스트에 쓴다. */
    optionsOf: (scope) => runtime[scope]?.opts,

    /** 화면이 scope 의 올리기를 맡는다(완료 시 onUploaded). 돌려준 함수로 놓는다. */
    attach(scope, handlerRef) {
      handlers[scope] = handlerRef;
      attached = { ...attached, [scope]: (attached[scope] || 0) + 1 };
      emit();
      return () => {
        const n = (attached[scope] || 1) - 1;
        const { [scope]: _drop, ...rest } = attached;
        attached = n > 0 ? { ...attached, [scope]: n } : rest;
        if (n <= 0) {
          delete handlers[scope];
          // 끝난 결과는 화면과 함께 지운다(다시 들어오면 빈 칸). 올리는 중·멈춘 올리기는 남겨 셸이 띄운다
          const job = jobs[scope];
          if (job && !job.busy && !job.resumable) { clear(scope); return; }
        }
        emit();
      };
    },

    /** 끝났는데 맡은 화면이 없던 올리기(셸 토스트용). */
    onOrphanDone(fn) { orphanListeners.add(fn); return () => orphanListeners.delete(fn); },

    /**
     * 올리기 시작. source = [{file, relPath}] 또는 (onCount) => Promise<items>(끌어 놓은 폴더 펼치기).
     * ⚠ source 함수는 이 호출 안에서 바로 부른다 — drop 이벤트가 끝나면 폴더 항목을 꺼낼 수 없다.
     * opts: { targetEntryId, targetEntryStatus, force, away } → 시작했으면 true.
     */
    start(scope, source, opts = {}) {
      if (getJob(scope).busy) { patch(scope, { notice: BUSY_NOTICE }); return false; }
      if (Array.isArray(source) && !source.length) return false;
      const old = runtime[scope]?.session;
      if (old) cancelRemote(old.key); // 멈춘 올리기를 두고 새로 올린다 — 남은 반쪽 배치는 치운다
      const ctrl = new AbortController();
      runtime[scope] = { ctrl, session: null, items: [], opts };
      put(scope, { ...IDLE_JOB, busy: true, phase: 'checking',
        checkTotal: Array.isArray(source) ? source.length : null });
      const collected = typeof source === 'function'
        ? source((n) => { if (runtime[scope]?.ctrl === ctrl) patch(scope, { checked: n }); })
        : source;
      launch(scope, ctrl, async (set) => {
        const items = await collected;
        if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (!items.length) return { key: null, uploaded: 0, rejected: [], skipped: [], blocked: [], deferred: 0 };
        runtime[scope].items = items;
        set({ checked: 0, checkTotal: items.length });
        return upload(items, {
          targetEntryId: opts.targetEntryId, targetEntryStatus: opts.targetEntryStatus, force: !!opts.force,
          signal: ctrl.signal,
          onPhase: (p) => set(p.phase === 'checking' ? { phase: 'checking', checked: p.checked, checkTotal: p.total }
            : { phase: 'uploading' }),
          onProgress: (progress) => set({ phase: 'uploading', progress }),
        });
      });
      return true;
    },

    /** 멈춘 올리기를 이어 보낸다(같은 배치, 남은 파일·조각부터). */
    resume(scope) {
      const rt = runtime[scope];
      const session = rt?.session;
      if (!session || getJob(scope).busy) return;
      const ctrl = new AbortController();
      rt.ctrl = ctrl;
      put(scope, { ...IDLE_JOB, busy: true, phase: 'uploading', progress: { sent: session.sent, total: session.total } });
      launch(scope, ctrl, (set) => resumeUpload(session, {
        signal: ctrl.signal, onProgress: (progress) => set({ progress }),
      }));
    },

    /** [취소] — 멈추고 서버의 반쪽 배치를 지운다(사용자가 고른 동작). */
    async cancel(scope) {
      const rt = runtime[scope];
      if (!rt) return;
      const job = getJob(scope);
      if (job.busy) {
        put(scope, { ...job, phase: 'canceling', notice: '' });
        rt.ctrl.abort();
        await rt.done;
      }
      const key = rt.session?.key;
      rt.session = null;
      rt.ctrl = null;
      const outcome = key ? await cancelRemote(key) : 'removed';
      // 안내 한 줄을 남긴다(맡은 화면이 없으면 셸의 떠 있는 상자에 보이고, 닫으면 지워진다)
      put(scope, { ...IDLE_JOB, info: CANCEL_INFO[outcome] || CANCEL_INFO.removed });
    },

    /** 끝난 결과·안내를 닫는다. 올리는 중이거나 이어 올릴 수 있으면 남긴다. */
    dismiss(scope) {
      const job = jobs[scope];
      if (job && !job.busy && !job.resumable) clear(scope);
    },

    /** 올리는 중에 바깥에서 또 놓았다 — 올리는 중인 칸마다 안내한다. */
    noticeBusy() {
      Object.entries(jobs).filter(([, j]) => j.busy).forEach(([scope]) => patch(scope, { notice: BUSY_NOTICE }));
    },

    /** 17 LV3 '그래도 올리기' — 막힌 BDF 와 함께 빠진 INCLUDE 를 force 로 새 배치에 올린다. */
    forceBlocked(scope) {
      const rt = runtime[scope];
      const paths = new Set(blockedPaths(getJob(scope).result?.blocked));
      const items = (rt?.items || []).filter((it) => paths.has(it.relPath));
      if (items.length) store.start(scope, items, { ...rt.opts, force: true });
    },

    /** 셸이 사라질 때(로그아웃) — 보내던 요청을 끊는다. 배치는 서버가 하루 뒤 정리한다. */
    abortAll() {
      Object.values(runtime).forEach((rt) => rt.ctrl?.abort());
    },
  };
  return store;
}
