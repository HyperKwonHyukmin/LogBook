import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * /api/system/health 를 30초마다 확인해 저장소 연결 상태를 돌려준다.
 * 탭이 백그라운드(hidden)에 있는 동안은 확인을 건너뛰고(불필요한 요청 방지),
 * 다시 보이는(visible) 순간 곧바로 한 번 확인해 상태를 최신으로 맞춘다.
 */
export function useStorageStatus(intervalMs = 30000) {
  const [storage, setStorage] = useState({ reachable: true });
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === 'hidden') return undefined;
      return api('/system/health', { auth: false })
        .then((r) => alive && setStorage(r.storage))
        .catch(() => alive && setStorage({ reachable: false }));
    };
    check();
    const id = setInterval(check, intervalMs);
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') check();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
  return storage;
}

export function DisconnectedBanner({ storage }) {
  if (storage?.reachable !== false) return null;
  return (
    <div role="alert" className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-err-line bg-err-bg px-3 py-1.5 text-ui text-err">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-err" />
      999_LogBook 공유 폴더에 연결할 수 없습니다. 올리기는 막히고, 검색과 열람은 계속 쓸 수 있습니다.
    </div>
  );
}
