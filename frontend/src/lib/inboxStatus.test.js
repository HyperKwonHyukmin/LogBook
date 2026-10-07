import { convertCounts, draftChecks, hasPendingConvert, modelConvertState, stagedStatus } from './inboxStatus.js';

const staged = (queue, progress = null) => ({ state: 'staged', queue, progress });
const alive = { worker_alive: true, job_state: 'queued', ahead: 0, busy_with: [], attempts: 0, last_error: null };

test('처리 중이면 단계와 n/N — 지난 단계는 끝남, 지금 단계는 진행 중', () => {
  const s = stagedStatus(staged({ ...alive, job_state: 'running' }, { step: 'files', done: 3, total: 12 }));
  expect(s.line).toBe('파일 확인 중 3/12');
  expect(s.steps.map((x) => x.state)).toEqual(['done', 'current', 'todo', 'todo']);
  expect(s.workerDown).toBe(false);
});

test('대기 사유 — 앞 배치, 다른 작업, 곧 시작, 재시도', () => {
  expect(stagedStatus(staged({ ...alive, ahead: 2 })).line).toBe('앞의 배치 2개를 먼저 처리하고 있습니다');
  expect(stagedStatus(staged({ ...alive, busy_with: ['convert_model'] })).line).toMatch(/BDF 변환.*마치면 시작/);
  expect(stagedStatus(staged(alive)).line).toMatch(/곧 시작합니다/);
  const retry = stagedStatus(staged({ ...alive, attempts: 1, last_error: 'boom' }, { step: 'files', done: 1, total: 2 }));
  expect(retry.line).toMatch(/다시 시도를 기다리는 중/);
  expect(retry.current).toBeNull();      // 지난 시도의 진행 기록은 쓰지 않는다
  expect(retry.tone).toBe('wait');
});

test('워커가 꺼져 있으면 그대로 알린다', () => {
  const s = stagedStatus(staged({ ...alive, worker_alive: false }));
  expect(s.workerDown).toBe(true);
  expect(s.line).toMatch(/워커\)이 꺼져 있어 기다리는 중입니다 — 관리자에게 알려 주세요/);
  expect(s.steps.every((x) => x.state === 'todo')).toBe(true);
});

const bdf = (state, extra = {}) => ({ kind: 'model', drm_encrypted: false, model: { state, ...extra } });

test('BDF 변환 상태 — 작업이 도는 중이면 변환 중, 상태별 개수', () => {
  expect(modelConvertState(bdf('queued', { running: true }))).toBe('running');
  expect(modelConvertState(bdf('queued'))).toBe('queued');
  expect(modelConvertState({ kind: 'report', model: null })).toBeNull();
  expect(modelConvertState({ ...bdf('queued'), drm_encrypted: true })).toBe('skipped');
  const files = [bdf('done'), bdf('queued'), bdf('queued', { running: true }), bdf('failed'), { kind: 'report' }];
  expect(convertCounts(files)).toEqual([
    { state: 'running', count: 1 }, { state: 'queued', count: 1 }, { state: 'failed', count: 1 }, { state: 'done', count: 1 },
  ]);
  expect(hasPendingConvert({ entries: [{ files }] })).toBe(true);
  expect(hasPendingConvert({ entries: [{ files: [bdf('done')] }] })).toBe(false);
});

test('초안 확인할 것 — 제목은 확정을 막는다, 호선·해석 종류·암호화·중복은 권고', () => {
  const entry = { files: [{ drm_encrypted: true }, { duplicate_of_entry: 'E000001' }] };
  const c = draftChecks({ title: ' ', hulls: [], analysis_type: '' }, entry);
  expect(c.map((x) => x.id)).toEqual(['title', 'hull', 'type', 'drm', 'dup']);
  expect(c.find((x) => x.id === 'title').blocking).toBe(true);
  expect(draftChecks({ title: '검토', hulls: [{ hull_no: '3496' }], analysis_type: '강도' }, { files: [] })).toEqual([]);
});
