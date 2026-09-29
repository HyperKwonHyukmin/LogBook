import { api } from '../api/client.js';

/** 10분짜리 내려받기 주소(iframe·a 는 Authorization 헤더를 못 붙여서 토큰 주소를 쓴다). */
export async function fileLink(fileId, { inline = false } = {}) {
  const { url } = await api(`/files/${fileId}/link${inline ? '?inline=true' : ''}`, { method: 'POST' });
  return url;
}

export async function downloadFile(file) {
  const url = await fileLink(file.id);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 공유 폴더 안 파일의 UNC 경로(탐색기에 붙여 넣는 용도). 확정 전이라 경로가 없으면 빈 문자열. */
export function uncPath(vaultUnc, relPath) {
  return vaultUnc ? `${vaultUnc}\\files\\${relPath.replaceAll('/', '\\')}` : '';
}

/** 사내 서버는 http 라 navigator.clipboard 가 없다(보안 컨텍스트 아님) — execCommand 로 대신한다. */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 아래로 */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = typeof document.execCommand === 'function' && document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
