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
    <div role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-[13px] text-err">
      999_LogBook 공유 폴더에 연결할 수 없습니다. 업로드가 제한되며, 검색·열람은 계속 사용할 수 있습니다.
    </div>
  );
}
