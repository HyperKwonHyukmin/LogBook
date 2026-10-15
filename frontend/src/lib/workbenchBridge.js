/**
 * 18 — HiTESS WorkBench 연동(방식 A: LogBook 창에서 골라 보내기).
 *
 * [WorkBench로 보내기]는 WorkBench 가 연 LogBook 창에서만 보인다. 판단 기준은 두 가지가 모두 있을 때다.
 * - `window.hitessBridge` — WorkBench(Electron)가 그 창에만 붙이는 다리(version ≥ 1, sendModel 함수).
 *   브라우저로 직접 들어오면 없다.
 * - `sessionStorage.logbook_wb` — 자동 로그인(/sso) 화면이 남긴 선택 모드 {target:'gmu'|'truss', slot:1..4}.
 *   truss(Truss Structural Assessment)는 작업 탭이 없는 단일 화면이라 slot 이 항상 1 이다.
 *   WorkBench 를 거쳐 들어왔지만 고를 대상이 없으면 {} 가 남는다(그래도 'WorkBench 경유 세션' 표시로 쓴다).
 */
export const WB_SESSION_KEY = 'logbook_wb';
export const PICK_TARGETS = ['gmu', 'truss'];
export const TARGET_LABELS = { gmu: 'GMU 권상', truss: 'Truss Structural Assessment' };
/** 작업 탭이 없는 단일 화면 대상 — 문구에 '작업 N' 을 붙이지 않는다. */
const SINGLE_SCREEN_TARGETS = ['truss'];
const SEND_FAILED = 'WorkBench 로 보내지 못했습니다.';

function session() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/** WorkBench 다리 — 없거나 모양이 다르면 null. */
export function getBridge() {
  let b;
  try { b = globalThis.window?.hitessBridge; } catch { return null; }
  if (!b || typeof b !== 'object' || typeof b.sendModel !== 'function') return null;
  const v = Number(b.version);
  return Number.isFinite(v) && v >= 1 ? b : null;
}

/** 이 세션이 WorkBench 자동 로그인으로 들어왔는가(선택 대상이 없어도 true). */
export function isWorkbenchSession() {
  try { return session()?.getItem(WB_SESSION_KEY) != null; } catch { return false; }
}

/** 선택 모드 {target, slot} — 형식이 맞지 않으면 null. */
export function getPickContext() {
  let raw;
  try { raw = session()?.getItem(WB_SESSION_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || !PICK_TARGETS.includes(v.target)) return null;
    if (!Number.isInteger(v.slot) || v.slot < 1 || v.slot > 4) return null;
    return { target: v.target, slot: SINGLE_SCREEN_TARGETS.includes(v.target) ? 1 : v.slot };
  } catch {
    return null;
  }
}

/** 다리와 선택 모드(대상·작업 번호)가 모두 있을 때만 보내기 버튼·선택 띠를 보인다. */
export function canSendToWorkbench() {
  return !!getBridge() && !!getPickContext();
}

/** 선택 띠 문구. */
export function pickBannerText(ctx = getPickContext()) {
  if (!ctx) return '';
  const label = TARGET_LABELS[ctx.target] || ctx.target;
  if (SINGLE_SCREEN_TARGETS.includes(ctx.target)) return `WorkBench · ${label}에 보낼 BDF를 고르세요`;
  return `WorkBench · ${label} 작업 ${ctx.slot}에 보낼 BDF를 고르세요`;
}

/**
 * BDF 하나를 WorkBench 로 보낸다. file = {id, name, entryId}. 결과 {ok, message}(던지지 않는다).
 * 성공 문구는 'WorkBench 작업 N으로 보냈습니다'(단일 화면 대상은 'WorkBench · <앱>으로 보냈습니다').
 */
export async function sendModelToWorkbench(file) {
  const bridge = getBridge();
  const ctx = getPickContext();
  if (!bridge || !ctx) return { ok: false, message: 'WorkBench 에서 연 LogBook 창에서만 보낼 수 있습니다.' };
  const fileId = Number(file?.id);
  if (!Number.isInteger(fileId) || fileId <= 0) return { ok: false, message: SEND_FAILED };
  const payload = { target: ctx.target, slot: ctx.slot, fileId, entryId: file?.entryId ?? null, name: file?.name ?? '' };
  try {
    const res = await bridge.sendModel(payload);
    if (res?.ok) {
      const message = SINGLE_SCREEN_TARGETS.includes(ctx.target)
        ? `WorkBench · ${TARGET_LABELS[ctx.target]}로 보냈습니다`
        : `WorkBench 작업 ${ctx.slot}으로 보냈습니다`;
      return { ok: true, message };
    }
    return { ok: false, message: (typeof res?.message === 'string' && res.message.trim()) || SEND_FAILED };
  } catch (err) {
    return { ok: false, message: (typeof err?.message === 'string' && err.message.trim()) || SEND_FAILED };
  }
}
