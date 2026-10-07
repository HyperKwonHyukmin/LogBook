import { vi } from 'vitest';

/**
 * 가짜 3D 엔진 — components/viewer/viewerEngine.js 계약과 같은 모양(jsdom 에는 WebGL 이 없다).
 * pick 은 요소 순번(숫자) 또는 { kind, index }. 계약을 늘리면 여기도 같이 늘린다.
 */
export function fakeEngine(pick = 0) {
  return {
    setModel: vi.fn(), setGroupVisible: vi.fn(), setEdges: vi.fn(), setMarkers: vi.fn(),
    setView: vi.fn(), fit: vi.fn(), pickAt: vi.fn(() => (typeof pick === 'number' ? { kind: 'element', index: pick } : pick)),
    highlight: vi.fn(), dispose: vi.fn(),
    setGroupsVisible: vi.fn(), setColorMode: vi.fn(), setRenderMode: vi.fn(async () => ({ fallbacks: 0 })),
    setNodes: vi.fn(), setClip: vi.fn(), setProjection: vi.fn(), setIsolate: vi.fn(), frameNodes: vi.fn(),
    setNodeSet: vi.fn(),
    // 07 비교 화면 — 카메라 상태·알림, PID 강조
    getCameraState: vi.fn(() => ({
      projection: 'ortho', position: [4, -4, 3], target: [0, 0, 0], quaternion: [0, 0, 0, 1], up: [0, 0, 1],
      view: 10, radius: 10, center: [0, 0, 0],
    })),
    setCameraState: vi.fn(),
    onCameraChange: vi.fn(() => () => {}),
    setPidHighlight: vi.fn(() => 1),
  };
}
