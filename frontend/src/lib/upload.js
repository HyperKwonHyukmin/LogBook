/**
 * 크롬 업로드 — 폴더/여러 파일을 모아 8MB 조각으로 /api/uploads 에 올린다(설계 §5.1).
 * 회사 DRM 파일(첫 바이트 HHIDRMC)은 보내기 전에 거르고, 서버도 한 번 더 거른다.
 */
import { api, apiBinary, ApiError } from '../api/client.js';

export const CHUNK_SIZE = 8 * 1024 * 1024;
const DRM_MAGIC = 'HHIDRMC';
const RETRIES = 3;

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

async function walk(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, relPath: prefix + entry.name });
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry.createReader())) {
      await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/** 끌어 놓은 항목(폴더 포함)을 모은다. 폴더는 재귀로 펼치고 상대경로를 유지한다. */
export async function collectFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [])
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return collectFromInput(dataTransfer.files || []);
  const out = [];
  for (const e of entries) await walk(e, '', out);
  return out;
}

export function batchName(items) {
  const tops = new Set(items.map((i) => i.relPath.split('/')[0]));
  const allNested = items.every((i) => i.relPath.includes('/'));
  return tops.size === 1 && allNested ? [...tops][0] : `파일 ${items.length}개`;
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const RESYNC_LIMIT = 5;

/** 다시 시도해도 되는 오류인가 — 네트워크 오류와 5xx 만. 그 밖의 4xx 는 다시 보내도 결과가 같다. */
function isRetryable(err) {
  return !(err instanceof ApiError) || err.status >= 500;
}

async function sendFile(key, item, chunkSize, onBytes, sleep) {
  const { file, relPath } = item;
  let offset = 0;
  let attempts = 0;
  let resyncs = 0;
  let restarted = false;
  do {
    const end = Math.min(offset + chunkSize, file.size);
    const q = `path=${encodeURIComponent(relPath)}&offset=${offset}`;
    try {
      await apiBinary(`/uploads/${key}/chunk?${q}`, file.slice(offset, end));
      onBytes(end - offset);
      offset = end;
      attempts = 0;
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
        onBytes(next - offset);
        offset = next;
        continue;
      }
      if (!isRetryable(err)) throw err;
      attempts += 1;
      if (attempts >= RETRIES) throw err;
      await sleep(1000 * 2 ** (attempts - 1)); // 1s, 2s, 4s
    }
  } while (offset < file.size);
}

/**
 * items: [{file, relPath}] → {key, uploaded, rejected}
 * 모든 파일이 DRM 이면 배치를 만들지 않고 {code:'all_drm', rejected} 를 던진다.
 * sleep 은 재시도 간격 대기 함수(테스트에서 바꿔 끼운다).
 */
export async function uploadBatch(items, {
  onProgress = () => {}, chunkSize = CHUNK_SIZE, targetEntryId, sleep = defaultSleep,
} = {}) {
  const rejected = [];
  const good = [];
  for (const it of items) (await hasDrmHeader(it.file) ? rejected : good).push(it);
  if (!good.length) {
    throw Object.assign(new Error('all_drm'), { code: 'all_drm', rejected: rejected.map((r) => r.relPath) });
  }
  const { key } = await api('/uploads', { method: 'POST', body: { name: batchName(items), target_entry_id: targetEntryId || null } });
  const total = good.reduce((s, it) => s + it.file.size, 0);
  let sent = 0;
  let finishSent = false;
  let uploaded = [];
  const result = () => ({ key, uploaded: uploaded.length, rejected: rejected.map((r) => r.relPath) });
  try {
    for (const it of good) {
      try {
        await sendFile(key, it, chunkSize, (n) => { sent += n; onProgress({ sent, total }); }, sleep);
      } catch (err) {
        if (err instanceof ApiError && err.detail === 'drm_encrypted') { rejected.push(it); continue; }
        throw err;
      }
    }
    uploaded = good.filter((g) => !rejected.includes(g));
    finishSent = true;
    await api(`/uploads/${key}/finish`, {
      method: 'POST',
      body: {
        files: uploaded.map((u) => ({ rel_path: u.relPath, size: u.file.size })),
        rejected: rejected.map((r) => ({ rel_path: r.relPath, reason: 'drm' })),
      },
    });
    onProgress({ sent: total, total });
    return result();
  } catch (err) {
    try {
      await api(`/uploads/${key}`, { method: 'DELETE' });
    } catch (cleanupErr) {
      // finish 응답만 잃었고 서버는 이미 받았다(더 이상 uploading 이 아님) → 성공으로 본다.
      const code = typeof cleanupErr?.detail === 'string' ? cleanupErr.detail : cleanupErr?.detail?.code;
      if (finishSent && cleanupErr instanceof ApiError && cleanupErr.status === 409 && code === 'not_uploading') {
        onProgress({ sent: total, total });
        return result();
      }
    }
    throw err;
  }
}
