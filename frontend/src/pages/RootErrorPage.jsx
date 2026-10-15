import { useRouteError } from 'react-router-dom';
import { RecoveryPanel } from '../components/ui/ErrorBoundary.jsx';

/**
 * 최상위 오류 화면(라우터 errorElement) — 셸까지 그리지 못했을 때만 보인다.
 * 셸 안의 오류는 AppShell 의 경계가 작업면에서 먼저 받으므로 여기까지 오지 않는다.
 * 로그인 등급을 믿을 수 없는 자리라 '기술 정보'는 접어서 누구에게나 둔다.
 * [검색으로]는 a 태그(새로 불러오기)로 — 깨진 라우터 상태를 이어 쓰지 않는다.
 */
export default function RootErrorPage() {
  const error = useRouteError();
  return (
    <div className="h-full overflow-auto bg-n-0 py-6">
      <RecoveryPanel error={error} plainLinks showDetail />
    </div>
  );
}
