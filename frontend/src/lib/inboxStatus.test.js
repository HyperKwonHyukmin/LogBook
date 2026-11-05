import { bulkConfirmPlan, formatDuration, stagedTiming, convertCounts, draftChecks, hasPendingConvert, modelConvertState, stagedStatus } from './inboxStatus.js';

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
  expect(s.line).toMatch(/워커\)이 꺼져 있어 기다리는 중입니다. 관리자에게 알려 주세요/);
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

test('초안 확인할 것 — 제목은 확정을 막는다, (BDF 없는 자료의) 호선·암호화·중복은 권고(42 — 해석 종류는 없앴다)', () => {
  const entry = { files: [{ drm_encrypted: true }, { duplicate_of_entry: 'E000001' }] };
  const c = draftChecks({ title: ' ', hulls: [] }, entry);
  expect(c.map((x) => x.id)).toEqual(['title', 'hull', 'drm', 'dup']);
  expect(c.find((x) => x.id === 'title').blocking).toBe(true);
  expect(draftChecks({ title: '검토', hulls: [{ hull_no: '3496' }] }, { files: [] })).toEqual([]);
});

test('43 — BDF 자료의 빈 호선은 확정을 막지 않고 보완 필요를 알린다, 구역·대상은 선택(42 — 해석 종류는 없다)', () => {
  const entry = { files: [{ kind: 'model' }] };
  const c = draftChecks({ title: '검토', hulls: [], zones: [], analysis_type: '' }, entry);
  expect(c.map((x) => [x.id, !!x.blocking])).toEqual([['hull', false]]);
  expect(c[0].text).toContain('보완 필요');
  const shared = draftChecks({ title: '검토', hulls: [], no_hull: true, zones: ['선수부'] }, entry);
  expect(shared).toEqual([]);
  // 기존 자료에 추가하는 초안은 그 자료의 분류를 따른다
  expect(draftChecks({ title: '검토', hulls: [], zones: [] }, { ...entry, merge_into: { entry_id: 'E1' } })).toEqual([]);
  // 29 — 프로젝트는 없앴다: 예전 값이 있어도 호선 대신 인정하지 않는다
  const project = draftChecks({ title: '검토', hulls: [], project: '크레인 연구', zones: ['선수부'] }, entry);
  expect(project.map((x) => x.id)).toEqual(['hull']);
});

test('49 — needsLiftingWire: 대상 Module Unit 또는 WB 권상 출처인데 Wire 모델이 없을 때만', async () => {
  const { needsLiftingWire } = await import('./inboxStatus.js');
  const base = { merge_into: null, files: [{ kind: 'model', name: 'a.bdf' }] };
  expect(needsLiftingWire(base, 'Module Unit')).toBe(true);
  expect(needsLiftingWire(base, 'module unit')).toBe(true);
  expect(needsLiftingWire(base, 'Unit')).toBe(true);
  expect(needsLiftingWire(base, '블록')).toBe(false);
  expect(needsLiftingWire({ ...base, lifting: { needed: true, has_wire: false } }, '')).toBe(true);
  expect(needsLiftingWire({ ...base, files: [{ kind: 'model', lifting: true }] }, 'Module Unit')).toBe(false);
  expect(needsLiftingWire({ ...base, merge_into: { entry_id: 'E1' } }, 'Module Unit')).toBe(false);
});

describe('52 — bulkConfirmPlan', () => {
  const d = (id, extra = {}) => ({ entry_id: id, title: `t${id}`, hulls: [], files: [], merge_into: null, ...extra });
  it('물어야 하는 초안은 이유와 함께 건너뛰고, 호선 없음은 확정한다', () => {
    const { go, skip } = bulkConfirmPlan([
      d('E1'), d('E2', { title: '' }), d('E3', { blocked_models: [{ name: 'a.bdf' }] }),
      d('E4', { target: 'Module Unit' }), d('E5'),
    ], new Set(['E5']));
    expect(go.map((e) => e.entry_id)).toEqual(['E1']);
    expect(skip.map((s) => [s.entry.entry_id, s.reason])).toEqual([
      ['E2', '제목 없음'], ['E3', '똑같은 BDF 가 이미 있음'], ['E4', '권상 Wire 모델 확인'], ['E5', '저장하지 않은 변경']]);
  });
});

describe('52 — 정리 진행 시간', () => {
  it('경과·남은 시간 글자', () => {
    expect(formatDuration(80)).toBe('1분 20초');
    expect(formatDuration(40, { approx: true })).toBe('1분 미만');
    expect(formatDuration(150, { approx: true })).toBe('약 3분');
  });
  it('파일 확인 속도로 남은 시간을 추정하고, 처음 본 순간에는 계산 중', () => {
    const t0 = Date.parse('2026-11-05T10:00:00');
    const batch = { key: 'K', received_at: '2026-11-05T09:59:00', progress: { step: 'files', done: 20, total: 100 } };
    const status = { current: 'files' };
    expect(stagedTiming(batch, status, { key: 'K', t: t0, done: 20 }, t0)).toEqual({ elapsed: '1분 0초', remaining: null });
    // 10초에 10개 → 남은 70개는 70초 → 약 1분
    expect(stagedTiming({ ...batch, progress: { step: 'files', done: 30, total: 100 } }, status,
      { key: 'K', t: t0, done: 20 }, t0 + 10_000)).toEqual({ elapsed: '1분 10초', remaining: '약 1분' });
  });
});
