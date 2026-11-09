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

/** 61 — Abaqus 입력(.inp). kind 는 other 지만 3D 뷰어로 연다(Nastran 실행·비교·선례 찾기·WorkBench 보내기는 BDF 전용). */
export const isAbaqusInput = (name) => /\.inp$/i.test(name || '');

/** 3D 변환·뷰어 대상(BDF 류 또는 Abaqus .inp) — 백엔드 ingest.rules.has_model_view 와 같은 규칙. */
export const hasModelView = (file) => !!file && (file.kind === 'model' || isAbaqusInput(file.name));

/**
 * 검색 미리보기 순서(2026-11-09) — 3D 로 볼 수 있는 BDF → INP → 보고서(PDF 먼저) → 나머지.
 * 변환 결과가 없는 모델(INCLUDE 조각·변환 전·실패)은 같은 종류의 볼 수 있는 모델 뒤에 둔다.
 */
export function previewRank(file) {
  const viewable = file.model?.format_version != null || file.model?.state === 'done';
  if (file.kind === 'model') return viewable ? 0 : 1;
  if (isAbaqusInput(file.name)) return viewable ? 2 : 3;
  if (file.kind === 'report') return /\.pdf$/i.test(file.name) ? 4 : 5;
  return 6;
}

/** previewRank 순(같은 순위는 원래 순서 유지). */
export const sortForPreview = (files) => (files || []).map((f, i) => [f, i])
  .sort((a, b) => previewRank(a[0]) - previewRank(b[0]) || a[1] - b[1]).map(([f]) => f);
