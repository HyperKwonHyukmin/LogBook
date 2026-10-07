import { FlipHorizontal2, Link2, Link2Off, Scan, Scissors } from 'lucide-react';
import { SYNC_MODES, SYNC_MODE_LABELS } from '../../lib/cameraSync.js';
import { COLOR_MODES, COLOR_MODE_LABELS } from '../../lib/legend.js';
import { VIEW_PRESETS } from '../../lib/viewFrame.js';
import Button from '../ui/Button.jsx';
import { Segmented } from '../ui/Tabs.jsx';

// 시점 — 단축키 A 평면 · S 정면 · D 측면 · I 등각(빈 곳 아래 안내 줄에 적는다).
const VIEW_ITEMS = [
  { id: 'top', label: '평면' }, { id: 'front', label: '정면' }, { id: 'side', label: '측면' }, { id: 'iso', label: '등각' },
];
const PROJECTION_ITEMS = [{ id: 'ortho', label: '직교' }, { id: 'persp', label: '원근' }];
const RENDER_ITEMS = [{ id: 'line', label: '선' }, { id: 'section', label: '3D 단면' }];
const COLOR_ITEMS = COLOR_MODES.map((id) => ({ id, label: id === 'section' ? '단면' : id === 'type' ? '요소 종류' : COLOR_MODE_LABELS[id] }));
const AXES = [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }];
const SYNC_ITEMS = SYNC_MODES.map((id) => ({ id, label: SYNC_MODE_LABELS[id] }));

const Sep = () => <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-n-200" />;
const Label = ({ children }) => <span className="shrink-0 text-meta text-n-600">{children}</span>;

/** 켜고 끄는 단추 — 켜짐은 흰 바탕 + 테두리(세그먼트 선택과 같은 말투, 파란 채움 없음). */
function Toggle({ pressed, onClick, icon: Icon, children, title }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} title={title}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-meta font-medium
              transition-[background-color,border-color,color,box-shadow] duration-150 ease-out
              ${pressed ? 'border-n-250 bg-n-0 text-n-800 shadow-xs hover:border-n-300'
                : 'border-transparent text-n-600 hover:bg-n-100 hover:text-n-900 active:bg-n-150'}`}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * 공통 툴바(07 §2) — 모든 칸에 적용. 색 기준 · 표시 방식 · 자르기 · 시점·맞춤 · 투영 · 카메라 동기화.
 * 초기화·끝내기는 화면 단위 동작이라 머리줄에 둔다(툴바가 1366 폭에서 두 줄이 되지 않게).
 * shared = { colorMode, renderMode, clip, view, projection, sync: { on, mode } }
 */
export default function CompareToolbar({ shared, onChange, onView, onFit, disabled = false }) {
  const { clip, sync } = shared;
  const setClip = (patch) => onChange({ clip: { ...clip, ...patch } });
  return (
    <div role="toolbar" aria-label="비교 공통 도구"
         className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 border-b border-n-200 bg-n-50 px-4 py-1.5">
      <Segmented label="시점" disabled={disabled} value={shared.view} onChange={onView} items={VIEW_ITEMS} />
      <Button variant="ghost" size="sm" onClick={onFit} disabled={disabled} title="화면 맞춤 (F)" aria-keyshortcuts="F">
        <Scan size={14} aria-hidden="true" />맞춤
      </Button>
      <Segmented label="투영" items={PROJECTION_ITEMS} value={shared.projection} disabled={disabled}
                 onChange={(projection) => onChange({ projection })} />
      <Sep />
      <Label>표시</Label>
      <Segmented label="표시 방식" items={RENDER_ITEMS} value={shared.renderMode} disabled={disabled}
                 onChange={(renderMode) => onChange({ renderMode })} />
      <Label>색</Label>
      <Segmented label="색 기준" items={COLOR_ITEMS} value={shared.colorMode} disabled={disabled}
                 onChange={(colorMode) => onChange({ colorMode })} />
      <Sep />
      <Toggle pressed={clip.on} onClick={() => setClip({ on: !clip.on })} icon={Scissors} title="축 평면으로 자르기(각 모델 범위의 비율 위치)">
        자르기
      </Toggle>
      {clip.on && (
        <>
          <Segmented label="자르는 축" items={AXES} value={clip.axis} onChange={(axis) => setClip({ axis })} />
          <input type="range" min="0" max="1000" step="1" value={Math.round(clip.position * 1000)}
                 onChange={(e) => setClip({ position: Number(e.target.value) / 1000 })}
                 aria-label={`${clip.axis.toUpperCase()} 자르기 위치(모델 범위 비율)`}
                 className="h-1 w-28 shrink-0 cursor-pointer accent-brand" />
          <span className="w-10 shrink-0 text-right font-mono text-meta text-n-600">{Math.round(clip.position * 100)}%</span>
          <Toggle pressed={clip.flip} onClick={() => setClip({ flip: !clip.flip })} icon={FlipHorizontal2} title="남기는 쪽 뒤집기">
            뒤집기
          </Toggle>
        </>
      )}
      <Sep />
      <Toggle pressed={sync.on} onClick={() => onChange({ sync: { ...sync, on: !sync.on } })} icon={sync.on ? Link2 : Link2Off}
              title="마지막으로 조작한 칸의 카메라를 나머지가 따라갑니다">
        카메라 동기화
      </Toggle>
      {sync.on && (
        <Segmented label="동기화 기준" items={SYNC_ITEMS} value={sync.mode}
                   onChange={(mode) => onChange({ sync: { ...sync, mode } })} />
      )}
    </div>
  );
}
