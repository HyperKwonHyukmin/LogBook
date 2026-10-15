import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lock, Send } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { useToast } from '../ui/Toast.jsx';
import { canSendToWorkbench, getPickContext, pickBannerText, sendModelToWorkbench } from '../../lib/workbenchBridge.js';
import {
  filterApplied, loadWbTarget, markFilterApplied, ruleFilter, useWbEligibility,
} from '../../lib/wbTargets.js';
import { vocabKey } from '../../lib/vocab.js';

/** 지금 주소가 검색 화면이고 그 필터(칸의 규칙 값 전부)가 켜져 있는가. */
function filterOn(loc, f) {
  if (!f || loc.pathname !== '/') return false;
  const have = new URLSearchParams(loc.search).getAll(f.key).map(vocabKey);
  return f.values.every((v) => have.includes(vocabKey(v)));
}

/** 규칙 값을 칸에 켜거나(on) 뺀 주소 질의 — 같은 칸의 다른 값(사용자가 고른 값)은 그대로 둔다. */
function withRuleValues(search, f, on) {
  const p = new URLSearchParams(search);
  const rule = new Set(f.values.map(vocabKey));
  const kept = p.getAll(f.key).filter((v) => !rule.has(vocabKey(v)));
  p.delete(f.key);
  for (const v of on ? [...kept, ...f.values] : kept) p.append(f.key, v);
  return p;
}

/**
 * 18 — WorkBench 선택 모드 띠(앱 전체, 상단 바 아래). WorkBench 다리와 선택 모드가 모두 있을 때만 보인다.
 * 다리·선택 모드는 창이 열린 동안 바뀌지 않으므로 처음 한 번만 읽는다.
 *
 * 18-b — 그 대상에 분류 규칙이 있으면 조건을 함께 보이고, 창이 열린 첫 검색 화면에 규칙 값으로 검색 필터를
 * 한 번 켠다(sessionStorage 표시 — 사용자가 끄면 다시 켜지 않는다).
 * 19 — 검색 필터는 한 칸 안 여러 값(OR)·칸끼리 AND 라, 한 칸(태그 우선)에 그 칸 규칙 값 전부를 켜고
 * 다른 칸 조건(예: 구역)은 문구로 안내한다(칸을 넘는 OR 은 검색 필터로 표현하지 않는다).
 */
export function WorkbenchPickBanner() {
  const [ctx] = useState(() => (canSendToWorkbench() ? getPickContext() : null));
  const [rule, setRule] = useState(null);
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ctx) return undefined;
    let alive = true;
    loadWbTarget(ctx.target).then((r) => { if (alive) setRule(r); }, () => {});
    return () => { alive = false; };
  }, [ctx]);

  const f = ruleFilter(rule);
  // 창이 열린 첫 검색 화면에 한 번만 켠다. 규칙이 늦게 와 사용자가 이미 다른 화면에 있으면 표시만 남긴다
  useEffect(() => {
    if (!f || filterApplied()) return;
    markFilterApplied();
    if (loc.pathname !== '/') return;
    if (new URLSearchParams(loc.search).getAll(f.key).length) return;   // 사용자가 이미 그 속성으로 거르고 있으면 건드리지 않는다
    navigate({ pathname: '/', search: `?${withRuleValues(loc.search, f, true)}` }, { replace: true });
  }, [f?.key, f?.values.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) return null;
  const text = pickBannerText(ctx);
  const on = filterOn(loc, f);
  function toggle() {
    const qs = withRuleValues(loc.pathname === '/' ? loc.search : '', f, !on).toString();
    navigate({ pathname: '/', search: qs ? `?${qs}` : '' });
  }
  const linkCls = 'shrink-0 rounded-xs font-medium text-brand underline-offset-2 hover:underline '
    + 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-ring';
  return (
    <div role="status" className="mx-3 mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-brand-muted bg-brand-subtle px-3 py-1.5 text-ui text-brand">
      <Send size={14} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">
        {text}
        {rule?.condition && <span className="text-n-700"> · {rule.condition}</span>}
      </span>
      {f ? (
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2 text-meta text-n-700">
          {loc.pathname === '/'
            ? <span>{f.label} 필터를 {on ? '켜 두었습니다' : '껐습니다'}</span>
            : <span>{f.label} 자료만 보려면</span>}
          <button type="button" onClick={toggle} className={linkCls}>
            {on ? '필터 끄기' : loc.pathname === '/' ? '다시 켜기' : '검색에서 보기'}
          </button>
          {f.others.length > 0 && (
            <span className="hidden text-n-600 lg:inline">
              · {f.others.join(', ')} 자료도 보낼 수 있습니다(함께 걸면 둘 다 맞는 자료만 남으니 이 필터를 끄고 따로 거르세요)
            </span>
          )}
        </span>
      ) : (
        <span className="ml-auto hidden shrink-0 text-meta text-n-600 md:inline">BDF 옆 [WorkBench로 보내기]를 누르면 바로 검증을 시작합니다.</span>
      )}
    </div>
  );
}

/**
 * [WorkBench로 보내기] — BDF(kind === 'model')이고 WorkBench 가 연 창일 때만 그린다.
 * file = {id, name, kind}, entryId = 'E000123'. stop = 목록 행 안에서 행 고르기로 번지지 않게.
 * compact = 좁은 자리(파일 트리 행·판 흐름)용 작은 채움 단추 — 아이콘만 두면 처음 쓰는 사람이 못 알아본다.
 * 어디서든 아이콘 + 글자 + 브랜드 채움색으로 그려 화면에서 바로 눈에 띄게 한다.
 *
 * 18-b — 대상 규칙(구역·태그)에 맞지 않는 자료면 회색(비활성)으로 그리고 사유를 보인다:
 * 넓은 자리는 버튼 옆 작은 글, 좁은 자리는 자물쇠 + '태그 필요' 와 title(비활성 버튼은 hover 가 잘 안 걸려
 * 감싼 span 에 단다). 판정을 받는 동안은 사유 없이 비활성, 판정 요청이 실패하면 켜 둔다(lib/wbTargets.js).
 */
export function SendToWorkbenchButton({ file, entryId = null, size = 'sm', className = '', stop = false,
                                        compact = false }) {
  const toast = useToast();
  const [enabled] = useState(canSendToWorkbench);
  const [busy, setBusy] = useState(false);
  const [target] = useState(() => getPickContext()?.target || null);
  const show = enabled && !!file && file.kind === 'model';
  const verdict = useWbEligibility(target, entryId, show);
  const reasonId = useId();
  if (!show) return null;

  const blocked = !verdict.loading && !verdict.ok;
  const disabled = busy || verdict.loading || blocked;
  async function onClick(e) {
    if (stop) e.stopPropagation();
    if (disabled) return;
    setBusy(true);
    try {
      const res = await sendModelToWorkbench({ id: file.id, name: file.name, entryId });
      toast.show({ message: res.message, tone: res.ok ? 'ok' : 'err' });
    } finally {
      setBusy(false);
    }
  }
  const label = 'WorkBench로 보내기';
  const describedBy = blocked && verdict.reason ? reasonId : undefined;
  if (compact) {
    const btn = (
      <button type="button" disabled={disabled} onClick={onClick} onKeyDown={stop ? (e) => e.stopPropagation() : undefined}
              aria-label={`${file.name} ${label}`} aria-describedby={describedBy}
              title={blocked ? undefined : `${label} — 이 BDF로 바로 검증을 시작합니다`}
              aria-busy={busy || verdict.loading || undefined}
              className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-brand px-2 text-micro font-semibold
                text-white shadow-xs transition-colors duration-150 ease-out hover:bg-brand-hover active:bg-brand-press
                disabled:cursor-not-allowed disabled:bg-n-150 disabled:text-n-500 disabled:shadow-none
                focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-ring ${className}`}>
        {blocked ? <Lock size={12} aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
        {busy ? '보내는 중' : 'WorkBench로'}
      </button>
    );
    if (!blocked) return btn;
    return (
      <span title={verdict.reason || undefined} className="inline-flex shrink-0 items-center gap-1"
            onClick={stop ? (e) => e.stopPropagation() : undefined}>
        {btn}
        <span className="whitespace-nowrap text-micro text-n-500" aria-hidden="true">{verdict.need}</span>
        {verdict.reason && <span id={reasonId} className="sr-only">{verdict.reason}</span>}
      </span>
    );
  }
  const button = (
    <Button variant="primary" size={size} className={className} disabled={disabled} loading={busy}
            onClick={onClick} onKeyDown={stop ? (e) => e.stopPropagation() : undefined}
            aria-describedby={describedBy}
            title={blocked ? undefined : '이 BDF로 WorkBench에서 바로 검증을 시작합니다'}>
      {!busy && (blocked ? <Lock size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />)}
      {label}
    </Button>
  );
  if (!blocked) return button;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`} title={verdict.reason || undefined}>
      {button}
      {verdict.reason && (
        <span id={reasonId} className="min-w-0 max-w-[360px] truncate text-meta text-n-600">{verdict.reason}</span>
      )}
    </span>
  );
}
