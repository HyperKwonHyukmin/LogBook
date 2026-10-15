/**
 * 최근 비교(11) — 사용자별로 서버(/api/me/compares)에 둔다. 비교 화면이 2개 이상 모델로 열리면 남긴다.
 * 같은 모델 묶음(순서 무관)은 한 줄 — 다시 열면 순서·시각·연 횟수만 바뀐다. 최근 20개.
 */
import { api } from '../api/client.js';
import { compareHref } from './compareBasket.js';

/** 비교를 연 뒤 이만큼 그대로 있으면 남긴다(칸을 빼며 지나가는 묶음까지 남기지 않게). */
export const RECORD_DELAY_MS = 800;

/** 모델을 지금 열 수 없는 사유(서버 note) → 짧은 안내. */
export const NOTE_LABELS = {
  trashed: '휴지통에 있어 빠집니다',
  failed: '3D 변환 실패',
  pending: '아직 3D 변환 전',
  not_model: '모델 파일이 아닙니다',
};

export const listRecent = (limit) => api(`/me/compares${limit ? `?limit=${limit}` : ''}`).then((r) => r?.items || []);
export const recordCompare = (ids) => api('/me/compares', { method: 'POST', body: { file_ids: ids } });
export const removeRecent = (id) => api(`/me/compares/${id}`, { method: 'DELETE' });
export const clearRecent = () => api('/me/compares', { method: 'DELETE' });

/** 다시 열 때 넣을 모델 — 휴지통·모델 아님은 빼고 남은 것으로 연다(변환 전·실패 칸은 칸 안에서 사유를 보인다). */
export const openableIds = (item) => (item?.files || [])
  .filter((f) => f.note !== 'trashed' && f.note !== 'not_model').map((f) => f.id);

/** 열기 주소 — 열 수 있는 모델이 없으면 null. */
export function openHref(item) {
  const ids = openableIds(item);
  return ids.length ? compareHref(ids) : null;
}

/** '방금' · 'N분 전' · 'N시간 전' · '어제' · 'N일 전' · 'YYYY-MM-DD'. */
export function whenLabel(iso, now = new Date()) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24 && now.getDate() === t.getDate()) return `${hr}시간 전`;
  const day = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate())
    - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  if (day <= 1) return '어제';
  if (day < 7) return `${day}일 전`;
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
