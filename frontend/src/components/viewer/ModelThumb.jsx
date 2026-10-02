import { useEffect, useRef, useState } from 'react';
import { apiBlob } from '../../api/client.js';

/*
 * 썸네일 불러오기(설계 §7.5).
 *  · 캐시 열쇠 = `${fileId}:${modelKey}` — 다시 변환하면 key 가 바뀌어 새 그림을 받는다.
 *    key 가 없으면 마운트 사이에 캐시하지 않는다(무엇의 그림인지 알 수 없다).
 *  · 쓰는 곳 수(refs)를 세어, 넘칠 때는 아무도 안 쓰는 것만 오래된 순으로 해제한다.
 *  · 실패한 열쇠는 기억해 이 세션에서 다시 묻지 않는다.
 *  · 동시에 받는 것은 4개까지(검색 결과 50행이 한꺼번에 요청하지 않게).
 */
const DEFAULT_LIMIT = 100;
const MAX_ACTIVE = 4;
let limit = DEFAULT_LIMIT;
const cache = new Map();      // 열쇠 → { url, refs } (넣은 순서 = 오래된 순)
const pending = new Map();    // 열쇠 → Promise<url>
const failed = new Set();     // 실패한 열쇠
let active = 0;
const queue = [];             // 차례를 기다리는 { run, cancelled }

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    if (job.cancelled) continue;
    active += 1;
    job.run().finally(() => { active = Math.max(0, active - 1); pump(); });
  }
}

/** 차례가 오면 thumb.png 를 받는다. cancel() 은 아직 시작 전일 때만 효과가 있다. */
function enqueueFetch(fileId) {
  let job;
  const promise = new Promise((resolve, reject) => {
    job = { cancelled: false, run: () => apiBlob(`/files/${fileId}/thumb.png`).then(resolve, reject) };
  });
  queue.push(job);
  pump();
  return { promise, cancel: () => { job.cancelled = true; } };
}

function evict() {
  for (const [k, entry] of cache) {
    if (cache.size <= limit) return;
    if (entry.refs > 0) continue;
    cache.delete(k);
    URL.revokeObjectURL(entry.url);
  }
}

function acquire(k) {
  const entry = cache.get(k);
  entry.refs += 1;
  // 최근 사용으로 옮긴다(Map 은 넣은 순서를 지킨다).
  cache.delete(k);
  cache.set(k, entry);
  return entry.url;
}

function release(k) {
  const entry = cache.get(k);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  evict();
}

function loadCached(k, fileId) {
  if (!pending.has(k)) {
    const { promise } = enqueueFetch(fileId);
    pending.set(k, promise.then((blob) => {
      const url = URL.createObjectURL(blob);
      cache.set(k, { url, refs: 0 });
      return url;
    }, (err) => { failed.add(k); throw err; }).finally(() => pending.delete(k)));
  }
  return pending.get(k);
}

/** 테스트용 — 모듈 상태를 비운다. */
export const thumbTesting = {
  reset({ limit: n = DEFAULT_LIMIT } = {}) {
    limit = n;
    cache.clear(); pending.clear(); failed.clear(); queue.length = 0; active = 0;
  },
};

/** 인증이 필요한 모델 썸네일. 화면에 보일 때 받고, 못 받으면 회색 자리만 남긴다. */
export default function ModelThumb({ fileId, modelKey, className = '', alt = '' }) {
  const k = modelKey ? `${fileId}:${modelKey}` : null;
  const placeholderRef = useRef(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [url, setUrl] = useState(null);

  // 화면에 들어올 때까지 받지 않는다(jsdom 등 IntersectionObserver 가 없으면 바로 받는다).
  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const el = placeholderRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    setUrl(null);
    if (!visible) return undefined;
    let alive = true;
    if (k) {
      if (failed.has(k)) return undefined;
      let held = false;
      const take = () => { if (alive && cache.has(k)) { held = true; setUrl(acquire(k)); evict(); } };
      if (cache.has(k)) take();
      else loadCached(k, fileId).then(take, () => {});
      return () => { alive = false; if (held) release(k); };
    }
    // 열쇠가 없으면 이 마운트만 쓰고 뗄 때 해제한다.
    let own = null;
    const job = enqueueFetch(fileId);
    job.promise.then((blob) => {
      if (!alive) return;
      own = URL.createObjectURL(blob);
      setUrl(own);
    }, () => {});
    return () => { alive = false; job.cancel(); if (own) URL.revokeObjectURL(own); };
  }, [visible, k, fileId]);

  if (!url) return <div ref={placeholderRef} aria-hidden="true" className={`bg-n-100 ${className}`} />;
  return <img src={url} alt={alt} draggable={false} className={`bg-viewer object-contain ${className}`} />;
}
