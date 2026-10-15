import { afterEach, vi } from 'vitest';
import {
  canSendToWorkbench, getBridge, getPickContext, isWorkbenchSession, pickBannerText, sendModelToWorkbench, WB_SESSION_KEY,
} from './workbenchBridge.js';

function setBridge(b) { window.hitessBridge = b; }
function setPick(v) { sessionStorage.setItem(WB_SESSION_KEY, typeof v === 'string' ? v : JSON.stringify(v)); }

afterEach(() => {
  delete window.hitessBridge;
  sessionStorage.clear();
});

test('다리는 version ≥ 1 이고 sendModel 함수가 있을 때만', () => {
  expect(getBridge()).toBeNull();
  setBridge({ version: 0, sendModel: () => {} });
  expect(getBridge()).toBeNull();
  setBridge({ version: 1 });
  expect(getBridge()).toBeNull();
  setBridge({ version: '2', sendModel: () => {} });
  expect(getBridge()).not.toBeNull();
});

test.each([
  [{ target: 'gmu', slot: 3 }, { target: 'gmu', slot: 3 }],
  [{ target: 'gmu', slot: 0 }, null],
  [{ target: 'gmu', slot: 5 }, null],
  [{ target: 'gmu', slot: '2' }, null],
  [{ target: 'gmu', slot: 1.5 }, null],
  [{ target: 'truss', slot: 1 }, { target: 'truss', slot: 1 }],
  [{ target: 'truss', slot: 3 }, { target: 'truss', slot: 1 }],
  [{ target: 'truss', slot: 0 }, null],
  [{ target: 'bdfscanner', slot: 1 }, null],
  [{}, null],
  ['not json', null],
  ['null', null],
])('선택 모드 %j → %j', (stored, want) => {
  setPick(stored);
  expect(getPickContext()).toEqual(want);
});

test('WorkBench 경유 세션은 선택 대상이 없어도({}) 알아본다', () => {
  expect(isWorkbenchSession()).toBe(false);
  setPick({});
  expect(isWorkbenchSession()).toBe(true);
  expect(getPickContext()).toBeNull();
});

test('보내기는 다리와 선택 모드가 모두 있을 때만', () => {
  expect(canSendToWorkbench()).toBe(false);
  setBridge({ version: 1, sendModel: vi.fn() });
  expect(canSendToWorkbench()).toBe(false);
  setPick({ target: 'gmu', slot: 2 });
  expect(canSendToWorkbench()).toBe(true);
  delete window.hitessBridge;
  expect(canSendToWorkbench()).toBe(false);
});

test('띠 문구', () => {
  expect(pickBannerText({ target: 'gmu', slot: 2 })).toBe('WorkBench · GMU 권상 작업 2에 보낼 BDF를 고르세요');
  expect(pickBannerText({ target: 'truss', slot: 1 })).toBe('WorkBench · Truss Structural Assessment에 보낼 BDF를 고르세요');
  expect(pickBannerText(null)).toBe('');
});

test('sendModel 에 계약대로 넘기고 성공 문구를 돌려준다', async () => {
  const sendModel = vi.fn().mockResolvedValue({ ok: true });
  setBridge({ version: 1, sendModel });
  setPick({ target: 'gmu', slot: 4 });
  const res = await sendModelToWorkbench({ id: 4512, name: 'm.bdf', entryId: 'E000123' });
  expect(sendModel).toHaveBeenCalledWith({ target: 'gmu', slot: 4, fileId: 4512, entryId: 'E000123', name: 'm.bdf' });
  expect(res).toEqual({ ok: true, message: 'WorkBench 작업 4으로 보냈습니다' });
});

test('truss 대상도 계약대로 넘기고 단일 화면 성공 문구를 돌려준다', async () => {
  const sendModel = vi.fn().mockResolvedValue({ ok: true });
  setBridge({ version: 1, sendModel });
  setPick({ target: 'truss', slot: 1 });
  expect(canSendToWorkbench()).toBe(true);
  const res = await sendModelToWorkbench({ id: 77, name: 't.bdf', entryId: null });
  expect(sendModel).toHaveBeenCalledWith({ target: 'truss', slot: 1, fileId: 77, entryId: null, name: 't.bdf' });
  expect(res).toEqual({ ok: true, message: 'WorkBench · Truss Structural Assessment로 보냈습니다' });
});

test('거절·예외는 다리 문구(없으면 일반 문구)로', async () => {
  setPick({ target: 'gmu', slot: 1 });
  setBridge({ version: 1, sendModel: vi.fn().mockResolvedValue({ ok: false, message: '작업 1이 진행 중입니다' }) });
  expect(await sendModelToWorkbench({ id: 1, name: 'a.bdf' })).toEqual({ ok: false, message: '작업 1이 진행 중입니다' });
  setBridge({ version: 1, sendModel: vi.fn().mockRejectedValue(new Error('')) });
  expect((await sendModelToWorkbench({ id: 1, name: 'a.bdf' })).message).toBe('WorkBench 로 보내지 못했습니다.');
  setBridge({ version: 1, sendModel: vi.fn().mockResolvedValue(undefined) });
  expect((await sendModelToWorkbench({ id: 1, name: 'a.bdf' })).ok).toBe(false);
});

test('다리가 없으면 보내지 않는다', async () => {
  setPick({ target: 'gmu', slot: 1 });
  expect((await sendModelToWorkbench({ id: 1, name: 'a.bdf' })).ok).toBe(false);
});
