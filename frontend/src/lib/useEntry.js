import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { errorText } from './labels.js';
import { invalidateWbEligibility } from './wbTargets.js';

const sameId = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();

/**
 * Entry 불러오기 + 순차 저장. 저장은 한 줄로 세우고 응답의 version 으로 다음 저장을 보낸다.
 * - 앞 저장이 실패해도(거부된 Promise) 줄은 끊기지 않는다 — 다음 저장은 그대로 이어서 보낸다.
 * - 다른 Entry 로 옮겨 가면 세대(generation)를 올려 새 줄을 시작하고, 옛 줄의 응답·충돌 재불러오기는 버린다.
 * save 결과: true(저장됨) | false(실패) | 'conflict'(다른 사람이 먼저 고쳐 최신으로 다시 불러옴)
 */
export function useEntry(entryId) {
  const [entry, setEntry] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [error, setError] = useState('');
  const versionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const reqRef = useRef(0);
  const genRef = useRef(0);
  const idRef = useRef(entryId);

  /** 지금 보고 있는 Entry 의 응답만 화면에 반영한다. */
  const apply = useCallback((e) => {
    if (!e || !sameId(e.entry_id, idRef.current)) return e;
    // 18-b — 저장으로 구역·태그가 바뀌었을 수 있다: WorkBench 보내기 판정을 다시 묻게 한다(태그를 붙이면 바로 보낼 수 있게)
    if (versionRef.current && e.version !== versionRef.current) invalidateWbEligibility(e.entry_id);
    versionRef.current = e.version; setEntry(e); setStatus('ready');
    return e;
  }, []);

  /** 최신 Entry 를 불러온다. 늦게 온 옛 응답(다른 Entry 로 옮겨 간 뒤 등)은 버린다. */
  const load = useCallback(() => {
    const id = ++reqRef.current;
    return api(`/entries/${encodeURIComponent(entryId)}`).then((e) => (id === reqRef.current ? apply(e) : e), (err) => {
      if (id === reqRef.current) throw err;
      return null;
    });
  }, [entryId, apply]);

  useEffect(() => {
    idRef.current = entryId;
    genRef.current += 1;
    queueRef.current = Promise.resolve(); // 새 Entry 는 새 줄 — 옛 Entry 의 저장을 기다리지 않는다
    setEntry(null); setStatus('loading'); setError('');
    const id = reqRef.current + 1;
    load().catch((err) => {
      if (id !== reqRef.current) return;
      if (err.status === 404) setStatus('missing');
      else { setStatus('error'); setError(errorText(err, '자료를 불러오지 못했습니다.')); }
    });
  }, [entryId, load]);

  const save = useCallback((patch) => {
    const gen = genRef.current;
    const live = () => gen === genRef.current;
    const run = queueRef.current.then(async () => {
      if (!live()) return false;
      try {
        const e = await api(`/entries/${encodeURIComponent(entryId)}`, { method: 'PATCH', body: { ...patch, version: versionRef.current } });
        if (!live()) return false;
        apply(e);
        setError('');
        return true;
      } catch (err) {
        if (!live()) return false;
        setError(errorText(err, '저장하지 못했습니다.'));
        if (err?.detail === 'version_conflict') {
          await load().catch(() => {});
          return 'conflict';
        }
        return false;
      }
    });
    // 어떤 경우에도 줄의 꼬리는 성공으로 끝나게 둔다(다음 저장이 막히지 않게).
    queueRef.current = run.catch(() => false);
    return run;
  }, [entryId, apply, load]);

  /**
   * 고치기 화면의 [변경 완료](11) — 바뀐 칸 전부를 한 번의 PATCH 로, 고치기 시작할 때의 version 으로 보낸다.
   * 충돌(409)이어도 스스로 다시 불러오지 않는다(고친 내용을 지키고 화면이 사용자에게 묻는다). 실패는 throw.
   */
  const commit = useCallback((patch, version) => {
    const gen = genRef.current;
    const run = queueRef.current.then(async () => {
      const e = await api(`/entries/${encodeURIComponent(entryId)}`, { method: 'PATCH', body: { ...patch, version } });
      if (gen === genRef.current) apply(e);
      return e;
    });
    queueRef.current = run.catch(() => false);
    return run;
  }, [entryId, apply]);

  return { entry, status, error, setError, save, commit, reload: load };
}
