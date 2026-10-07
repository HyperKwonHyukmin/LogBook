/**
 * 정리 대기 화면 — 배치·초안이 '지금 무엇을 하고 왜 기다리는지'를 사람 말로 바꾼다.
 * 서버 값: batch.progress { step, done, total } · batch.queue { job_state, ahead, busy_with, worker_alive, … }
 * (backend app/ingest/progress.py · routers/batches.py). 순수 함수 — 화면은 BatchCard·DraftCard.
 */
import { JOB_TYPE_LABELS } from './labels.js';

/** 서버 처리 단계(process_batch 순서 그대로). detail 은 '무엇을 하나요?' 펼침에 쓴다. */
export const BATCH_STEPS = [
  { id: 'scan', label: '파일 목록 훑기', detail: '올린 폴더 안의 파일을 모두 셉니다.' },
  {
    id: 'files', label: '파일마다 확인',
    detail: '임시·잠금 파일(~$ 등)을 빼고, 종류(BDF·결과·보고서·도면)를 나누고, DRM 이 걸렸는지 보고, '
      + '지문(SHA-256)을 계산해 이미 보관된 파일과 겹치는지 확인합니다.',
  },
  {
    id: 'propose', label: '묶음(초안) 제안',
    detail: '폴더·파일 이름에서 호선 번호와 제목을 추정해 자료 단위로 묶고, 같은 호선의 비슷한 기존 자료를 찾습니다.',
  },
  {
    id: 'queue', label: '본문 추출·3D 변환 예약',
    detail: '보고서 본문 색인과 BDF 3D 변환은 오래 걸려 따로 예약합니다. 초안이 먼저 나타나고 변환은 이어서 진행됩니다.',
  },
];

const STEP_LINES = {
  scan: () => '파일 목록을 훑는 중',
  files: (p) => (p.total ? `파일 확인 중 ${p.done}/${p.total}` : '파일 확인 중'),
  propose: () => '호선·제목을 추정해 묶는 중',
  queue: () => '본문 추출·3D 변환을 예약하는 중',
};

/**
 * 분석 중(staged) 배치의 한 줄 상태와 단계 표.
 * @returns {{ line: string, tone: 'normal'|'wait', workerDown: boolean, current: string|null,
 *             steps: Array<{ id, label, detail, state: 'done'|'current'|'todo' }> }}
 */
export function stagedStatus(batch) {
  const q = batch.queue || {};
  const p = batch.progress || null;
  const workerDown = q.worker_alive === false;
  // 진행 기록은 처리 중일 때만 믿는다(실패 뒤 재시도 대기면 지난 시도의 기록이다).
  const live = p?.step && STEP_LINES[p.step] && (!q.job_state || q.job_state === 'running');
  let current = live ? p.step : null;
  let line;
  let tone = 'normal';
  if (current) {
    line = STEP_LINES[current](p);
  } else if (workerDown) {
    line = '처리 프로그램(워커)이 꺼져 있어 기다리는 중입니다 — 관리자에게 알려 주세요.';
    tone = 'wait';
  } else if (q.job_state === 'running') {
    line = '처리를 시작했습니다';
    current = 'scan';
  } else if (q.job_state === 'failed') {
    line = '처리하지 못했습니다 — 관리자에게 알려 주세요.';
    tone = 'wait';
  } else if (q.last_error) {
    line = `처리 중 문제가 생겨 다시 시도를 기다리는 중입니다(${q.attempts}번 시도)`;
    tone = 'wait';
  } else if (q.ahead > 0) {
    line = `앞의 배치 ${q.ahead}개를 먼저 처리하고 있습니다`;
  } else if (q.busy_with?.length) {
    line = `워커가 하던 작업(${q.busy_with.map((t) => JOB_TYPE_LABELS[t] || t).join('·')})을 마치면 시작합니다`;
  } else {
    line = '곧 시작합니다 — 워커가 30초마다 새 배치를 확인합니다';
  }
  const at = BATCH_STEPS.findIndex((s) => s.id === current);
  const steps = BATCH_STEPS.map((s, i) => ({ ...s, state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo' }));
  return { line, tone, workerDown: workerDown && !current, current, steps };
}

/** BDF 3D 변환 상태 — 파일 하나. 모델 파일이 아니거나 기록이 없으면 null. */
export function modelConvertState(f) {
  if (f.kind !== 'model' || !f.model) return null;
  if (f.drm_encrypted) return 'skipped';
  const s = f.model.state;
  if (s === 'queued') return f.model.running ? 'running' : 'queued';
  if (s === 'done' || s === 'failed' || s === 'include' || s === 'skipped') return s;
  return 'queued';
}

export const MODEL_CONVERT_LABELS = {
  queued: '3D 변환 대기', running: '3D 변환 중', done: '3D 준비됨', failed: '3D 변환 실패',
  skipped: '3D 변환 안 함', include: 'INCLUDE 파일',
};
const CONVERT_ORDER = ['running', 'queued', 'failed', 'done', 'skipped', 'include'];

/** 파일 목록의 BDF 변환 상태별 개수 — [{ state, count }] (보일 순서). */
export function convertCounts(files) {
  const n = {};
  for (const f of files || []) {
    const s = modelConvertState(f);
    if (s) n[s] = (n[s] || 0) + 1;
  }
  return CONVERT_ORDER.filter((s) => n[s]).map((s) => ({ state: s, count: n[s] }));
}

/** 배치 안 모든 초안의 BDF 변환이 아직 진행 중인가(화면을 다시 부를 가치가 있는가). */
export function hasPendingConvert(batch) {
  return (batch.entries || []).some((e) => e.files.some((f) => {
    const s = modelConvertState(f);
    return s === 'queued' || s === 'running';
  }));
}

/**
 * 초안에서 사람이 확인할 것 — 확정을 막는 것(blocking)과 권하는 것.
 * form: 화면에서 고치는 중인 값(제목·호선·해석 종류), entry: 서버 값(파일).
 * @returns {Array<{ id, text, blocking?: boolean }>}
 */
export function draftChecks(form, entry) {
  const out = [];
  if (!(form.title || '').trim()) out.push({ id: 'title', text: '제목 없음 — 확정하려면 필요합니다', blocking: true });
  if (!(form.hulls || []).length) out.push({ id: 'hull', text: '호선 없음 — 호선으로 찾을 수 있게 넣어 주세요' });
  if (!(form.analysis_type || '').trim()) out.push({ id: 'type', text: '해석 종류 없음' });
  const files = entry.files || [];
  const drm = files.filter((f) => f.drm_encrypted).length;
  if (drm) out.push({ id: 'drm', text: `암호화 파일 ${drm}개 — 본문·3D 를 읽지 못합니다` });
  const dup = files.filter((f) => f.duplicate_of_entry).length;
  if (dup) out.push({ id: 'dup', text: `이미 보관된 파일 ${dup}개` });
  return out;
}
