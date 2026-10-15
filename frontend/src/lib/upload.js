/**
 * 크롬 업로드 — 폴더/여러 파일을 모아 8MB 조각으로 /api/uploads 에 올린다(설계 §5.1).
 * 회사 DRM 파일(첫 바이트 HHIDRMC)은 보내기 전에 거르고, 서버도 한 번 더 거른다.
 *
 * 큰 올리기를 견디게 하는 규칙:
 *  - 일시 오류(네트워크·5xx·408·429)는 조각마다 지수 간격으로 약 60초까지 다시 보낸다. 그 밖의 4xx 는 바로 실패.
 *  - 도중에 실패해도 서버 배치를 지우지 않는다. 던지는 오류에 session 을 실어 [이어 올리기](continueUpload)로
 *    남은 파일·남은 조각부터 보낸다(서버가 offset_mismatch 로 실제 크기를 알려 준다).
 *  - 내 PC 에서 읽을 수 없는 파일(잠김·삭제)은 건너뛰고 나머지를 마친 뒤 skipped 로 알린다.
 *  - signal(AbortController)로 [취소]한다. 배치 지우기는 호출자가 cancelUpload 로 한다(사용자가 고른 동작일 때만).
 */
import { api, apiBinary, ApiError } from '../api/client.js';

export const CHUNK_SIZE = 8 * 1024 * 1024;
const DRM_MAGIC = 'HHIDRMC';
/** 한 조각을 다시 보내며 기다리는 시간의 합 상한(ms). 1·2·4·8·16·16초 = 47초까지 기다린다. */
export const RETRY_BUDGET_MS = 60_000;
const RETRY_MAX_DELAY_MS = 16_000;
/** 조각 하나로 끝나는 작은 파일은 이만큼 함께 보낸다(큰 파일은 하나씩). */
export const SMALL_PARALLEL = 3;
const RESYNC_LIMIT = 5;

/** 내 PC 에서 파일을 읽지 못했다(다른 프로그램이 잠금·이동·삭제). 그 파일만 건너뛴다. */
export class UnreadableFileError extends Error {
  constructor(relPath, cause) {
    super(`unreadable: ${relPath}`);
    this.name = 'UnreadableFileError';
    this.relPath = relPath;
    this.cause = cause;
  }
}

export const isAbortError = (err) => err?.name === 'AbortError';
const abortError = () => new DOMException('올리기를 취소했습니다.', 'AbortError');
function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/** 다시 보내면 나아질 수 있는 오류인가 — 네트워크 오류(fetch TypeError)·5xx·408·429. */
export function isRetryable(err) {
  if (isAbortError(err) || err instanceof UnreadableFileError) return false;
  if (err instanceof ApiError) return err.status >= 500 || err.status === 408 || err.status === 429;
  return true;
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 기다리는 중에도 [취소]가 바로 먹게 한다. */
function pause(sleep, ms, signal) {
  if (!signal) return Promise.resolve(sleep(ms));
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(sleep(ms)).then(() => { signal.removeEventListener('abort', onAbort); resolve(); }, reject);
  });
}

/** fn 을 일시 오류일 때 1s, 2s, 4s … (최대 16s) 간격으로, 기다린 합이 RETRY_BUDGET_MS 를 넘기 전까지 다시 부른다. */
export async function withRetry(fn, { sleep = defaultSleep, signal } = {}) {
  let waited = 0;
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted) throw abortError();
      if (!isRetryable(err)) throw err;
      const delay = Math.min(1000 * 2 ** attempt, RETRY_MAX_DELAY_MS);
      if (waited + delay > RETRY_BUDGET_MS) throw err;
      waited += delay;
      await pause(sleep, delay, signal);
    }
  }
}

export async function hasDrmHeader(file) {
  const head = new Uint8Array(await file.slice(0, DRM_MAGIC.length).arrayBuffer());
  return String.fromCharCode(...head) === DRM_MAGIC;
}

export function collectFromInput(fileList) {
  return Array.from(fileList).map((file) => ({ file, relPath: file.webkitRelativePath || file.name }));
}

function readAll(reader) {
  return new Promise((resolve, reject) => {
    const out = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(out);
      else { out.push(...batch); next(); }
    }, reject);
    next();
  });
}

async function walk(entry, prefix, out, onCount) {
  if (entry.isFile) {
    try {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, relPath: prefix + entry.name });
    } catch {
      // 잠긴·사라진 파일 — 목록에는 남겨 scanItems 가 '건너뜀'으로 알린다
      out.push({ file: null, relPath: prefix + entry.name });
    }
    onCount(out.length);
  } else if (entry.isDirectory) {
    let children;
    try {
      children = await readAll(entry.createReader());
    } catch {
      out.push({ file: null, relPath: `${prefix}${entry.name}/` });
      return;
    }
    for (const child of children) {
      await walk(child, `${prefix}${entry.name}/`, out, onCount);
    }
  }
}

/**
 * 끌어 놓은 항목(폴더 포함)을 모은다. 폴더는 재귀로 펼치고 상대경로를 유지한다.
 * ⚠ webkitGetAsEntry 는 drop 이벤트 안에서만 쓸 수 있다 — 첫 await 전에 항목을 꺼낸다.
 * onCount(n): 찾은 파일 수(큰 폴더는 펼치는 데 시간이 걸려 '파일 확인 중 n개'로 보인다).
 */
export async function collectFromDrop(dataTransfer, { onCount = () => {} } = {}) {
  const entries = Array.from(dataTransfer.items || [])
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return collectFromInput(dataTransfer.files || []);
  const out = [];
  for (const e of entries) await walk(e, '', out, onCount);
  return out;
}

export function batchName(items) {
  const tops = new Set(items.map((i) => i.relPath.split('/')[0]));
  const allNested = items.every((i) => i.relPath.includes('/'));
  return tops.size === 1 && allNested ? [...tops][0] : `파일 ${items.length}개`;
}

/**
 * 보내기 전 확인 — DRM 머리를 읽어 거르고, 읽을 수 없는 파일은 건너뛴다.
 * → { good: [{file, relPath}], rejected: [{file, relPath}], skipped: [relPath] }
 */
export async function scanItems(items, { onScan = () => {}, signal } = {}) {
  const good = [];
  const rejected = [];
  const skipped = [];
  for (let i = 0; i < items.length; i += 1) {
    throwIfAborted(signal);
    const it = items[i];
    if (!it.file) skipped.push(it.relPath);
    else {
      try {
        (await hasDrmHeader(it.file) ? rejected : good).push(it);
      } catch {
        skipped.push(it.relPath);
      }
    }
    onScan(i + 1);
  }
  return { good, rejected, skipped };
}

async function readSlice(item, start, end) {
  try {
    return await item.file.slice(start, end).arrayBuffer();
  } catch (err) {
    throw new UnreadableFileError(item.relPath, err);
  }
}

/** 파일 하나를 startAt 부터 조각으로 보낸다. onAdvance(n, offset): 서버가 받은 바이트가 n 만큼 움직였다. */
async function sendFile(key, item, { chunkSize, sleep, signal, startAt = 0, onAdvance }) {
  const { file, relPath } = item;
  let offset = startAt;
  let resyncs = 0;
  let restarted = false;
  do {
    throwIfAborted(signal);
    const end = Math.min(offset + chunkSize, file.size);
    // 조각을 먼저 읽는다 — 읽지 못한 것(잠김)과 보내지 못한 것(네트워크)을 가른다
    const body = await readSlice(item, offset, end);
    const q = `path=${encodeURIComponent(relPath)}&offset=${offset}`;
    try {
      await withRetry(() => apiBinary(`/uploads/${key}/chunk?${q}`, body, { signal }), { sleep, signal });
      onAdvance(end - offset, end);
      offset = end;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.detail?.code === 'offset_mismatch') {
        resyncs += 1;
        if (resyncs > RESYNC_LIMIT) throw err;
        let next = err.detail.size;
        if (next > file.size) {
          // 서버 쪽 파일이 더 크다 — 같은 경로의 다른 파일이 남아 있던 것. 처음부터 한 번만 다시 쓴다.
          if (restarted) throw err;
          restarted = true;
          next = 0;
        }
        onAdvance(next - offset, next);
        offset = next;
        continue;
      }
      throw err;
    }
  } while (offset < file.size);
}

/** n 개씩 함께 돌린다. 하나가 실패하면 새 파일은 더 꺼내지 않고, 돌던 것이 끝난 뒤 첫 오류를 던진다. */
async function runPool(list, n, fn) {
  let i = 0;
  let failed = null;
  const worker = async () => {
    while (!failed && i < list.length) {
      const it = list[i];
      i += 1;
      try { await fn(it); } catch (err) { failed = failed || err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  if (failed) throw failed;
}

/** 막힌 BDF(17) 와 함께 빠진 INCLUDE 조각의 경로 — [그래도 올리기] 때 다시 보낼 파일. */
export const blockedPaths = (blocked = []) => blocked.flatMap((b) => [b.name, ...(b.includes || [])]);

const detailCode = (err) => (typeof err?.detail === 'string' ? err.detail : err?.detail?.code);

/**
 * items: [{file, relPath}] → {key, uploaded, rejected, skipped, blocked, deferred}
 * 모든 파일이 DRM 이면 배치를 만들지 않고 {code:'all_drm', rejected} 를 던진다
 * (읽을 수 없는 파일까지 섞여 올릴 것이 없으면 code 'none_uploadable' + skipped).
 * 17 — 서버가 '완전 동일 BDF' 를 받지 않으면 blocked 에 그 파일과 같은 기존 자료가 온다. 모두 막히면 key 는 null(배치 없음).
 * force(LV3 만): 동일 BDF 도 받는다(서버 감사 기록). deferred = 서버가 바로 확인하지 못해 정리 대기에서 이어 확인할 BDF 수.
 * onPhase({phase:'checking', checked, total}) → DRM 확인 진행, ({phase:'uploading'}) → 보내기 시작.
 * 도중 실패·취소 오류에는 err.session 이 실린다 — continueUpload(err.session) 로 이어 올리고, 버릴 때는 cancelUpload(key).
 * sleep 은 재시도 간격 대기 함수(테스트에서 바꿔 끼운다).
 */
export async function uploadBatch(items, {
  onProgress = () => {}, onPhase = () => {}, chunkSize = CHUNK_SIZE, targetEntryId, targetEntryStatus,
  sleep = defaultSleep, force = false, signal, parallel = SMALL_PARALLEL,
} = {}) {
  const { good, rejected, skipped } = await scanItems(items, {
    signal, onScan: (checked) => onPhase({ phase: 'checking', checked, total: items.length }),
  });
  if (!good.length) {
    const code = skipped.length ? 'none_uploadable' : 'all_drm';
    throw Object.assign(new Error(code), { code, rejected: rejected.map((r) => r.relPath), skipped });
  }
  onPhase({ phase: 'uploading' });
  const { key } = await withRetry(() => api('/uploads', { method: 'POST', signal, body: {
    name: batchName(items), target_entry_id: targetEntryId || null,
    ...(targetEntryStatus ? { target_status: targetEntryStatus } : {}) } }), { sleep, signal });
  const session = {
    key,
    items: good,
    rejected: rejected.map((r) => r.relPath),
    skipped: [...skipped],
    done: new Set(),
    offsets: {},          // 보내다 멈춘 파일의 서버 확인 크기
    sent: 0,
    total: good.reduce((s, it) => s + it.file.size, 0),
    force,
    finishAttempts: 0,
  };
  return continueUpload(session, { onProgress, chunkSize, sleep, signal, parallel });
}

/** 세션(uploadBatch 가 던진 err.session)의 남은 파일을 보내고 마친다. 이어 올리기도 이것이다. */
export async function continueUpload(session, {
  onProgress = () => {}, chunkSize = CHUNK_SIZE, sleep = defaultSleep, signal, parallel = SMALL_PARALLEL,
} = {}) {
  const report = () => onProgress({ sent: session.sent, total: session.total });
  const drop = (it) => {
    // 받지 않은 파일(서버 DRM·읽기 실패)은 진행률 분모·분자에서 뺀다
    session.sent -= session.offsets[it.relPath] || 0;
    session.total -= it.file.size;
    delete session.offsets[it.relPath];
    report();
  };
  const sendOne = async (it) => {
    try {
      await sendFile(session.key, it, {
        chunkSize, sleep, signal, startAt: session.offsets[it.relPath] || 0,
        onAdvance: (n, offset) => { session.sent += n; session.offsets[it.relPath] = offset; report(); },
      });
      delete session.offsets[it.relPath];
      session.done.add(it.relPath);
    } catch (err) {
      if (err instanceof ApiError && err.detail === 'drm_encrypted') { session.rejected.push(it.relPath); drop(it); return; }
      if (err instanceof UnreadableFileError) { session.skipped.push(it.relPath); drop(it); return; }
      throw err;
    }
  };
  try {
    report();
    const out = new Set([...session.done, ...session.rejected, ...session.skipped]);
    const todo = session.items.filter((it) => !out.has(it.relPath));
    const small = todo.filter((it) => it.file.size <= chunkSize && !session.offsets[it.relPath]);
    const large = todo.filter((it) => !small.includes(it));
    await runPool(small, Math.max(1, parallel), sendOne);
    for (const it of large) await sendOne(it);

    const uploaded = session.items.filter((it) => session.done.has(it.relPath));
    if (!uploaded.length) {
      // 받은 파일이 하나도 없다 — 이어 올릴 것이 없으니 빈 배치를 지운다
      await cancelUpload(session.key);
      throw Object.assign(new Error('none_uploadable'), {
        code: session.skipped.length ? 'none_uploadable' : 'all_drm',
        rejected: [...session.rejected], skipped: [...session.skipped], session: null,
      });
    }
    let finished = null; // 마무리 응답 {key, state, blocked, deferred}
    try {
      finished = await withRetry(() => {
        session.finishAttempts += 1;
        return api(`/uploads/${session.key}/finish`, { method: 'POST', signal, body: {
          files: uploaded.map((u) => ({ rel_path: u.relPath, size: u.file.size })),
          rejected: session.rejected.map((rel) => ({ rel_path: rel, reason: 'drm' })),
          ...(session.force ? { force: true } : {}),
        } });
      }, { sleep, signal });
    } catch (err) {
      // 앞선 마무리 응답만 잃었고 서버는 이미 받았다(더 이상 uploading 이 아님) → 성공으로 본다.
      const lostReply = session.finishAttempts > 1 && err instanceof ApiError && err.status === 409
        && detailCode(err) === 'not_uploading';
      if (!lostReply) throw err;
    }
    session.sent = session.total;
    report();
    const blocked = finished?.blocked || [];
    const left = new Set(blockedPaths(blocked));
    return {
      key: finished?.state === 'blocked' ? null : session.key,
      uploaded: uploaded.filter((u) => !left.has(u.relPath)).length,
      rejected: [...session.rejected],
      skipped: [...session.skipped],
      blocked,
      deferred: finished?.deferred || 0,
    };
  } catch (err) {
    // 이어 올리기에 쓸 상태를 싣는다(취소도 마찬가지 — 호출자가 배치를 지운다)
    if (err && typeof err === 'object' && !('session' in err)) err.session = session;
    throw err;
  }
}

/**
 * 올리던 배치를 버린다([취소]). → 'removed'(지움·이미 없음) | 'finished'(서버가 이미 받음) | 'failed'(공유 폴더 끊김 등).
 * 'failed' 여도 서버가 24시간 뒤 정리한다.
 */
export async function cancelUpload(key) {
  try {
    await api(`/uploads/${key}`, { method: 'DELETE' });
    return 'removed';
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return 'removed';
    if (err instanceof ApiError && err.status === 409 && detailCode(err) === 'not_uploading') return 'finished';
    return 'failed';
  }
}
