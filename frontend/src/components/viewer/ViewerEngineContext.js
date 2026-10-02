import { createContext } from 'react';

/**
 * 엔진 공장 — 화면 컴포넌트는 이것만 안다. 테스트는 가짜 공장을 넣는다(jsdom 에 WebGL 이 없다).
 * 공장은 Promise<engine> 을 돌려준다. three 는 이 동적 import 로만 불러와 별도 묶음에 들어간다.
 */
export const ViewerEngineContext = createContext(async (container) => {
  const { createViewerEngine } = await import('./viewerEngine.js');
  return createViewerEngine(container);
});
