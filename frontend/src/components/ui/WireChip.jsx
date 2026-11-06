/** 49 — 권상 Wire 를 설치한 모델(_lifting.bdf) 표시. 나중에 이전 실적의 권상 위치를 찾는 데 쓰는 파일이다. */
export default function WireChip() {
  return (
    <span title="권상 Wire 를 설치한 모델(권상 위치 실적)"
          className="inline-flex shrink-0 items-center rounded-xs bg-brand-subtle px-1.5 text-micro font-medium text-brand">
      Wire 포함
    </span>
  );
}

/**
 * 정리 대기 카드 머리 — Module Unit 권상 자료가 무엇을 갖췄는지 카드를 펼치지 않고 본다(2026-11-06 사용자 요청).
 * WorkBench 가 보내는 권상 자료는 Wire 모델이 있는 것(구조 해석까지)과 없는 것(검증만)이 섞여 온다.
 * lifting = 자료 응답의 { needed, has_wire, has_result }(backend app/lifting.py brief).
 */
export function LiftingSetChip({ lifting }) {
  if (!lifting?.needed) return null;
  if (!lifting.has_wire) {
    return (
      <span title="Wire 를 설치한 모델(_lifting.bdf)이 없습니다 — 구조 해석 전 원본 모델만 있는 자료"
            className="inline-flex shrink-0 items-center rounded-xs bg-wait-bg px-1.5 text-micro font-medium text-wait">
        Wire 없음
      </span>
    );
  }
  return (
    <span title={lifting.has_result
      ? 'Wire 모델과 구조 해석 결과가 함께 있습니다 — Module Unit Studio 에서 실적의 결과 화면을 열 수 있습니다'
      : 'Wire 모델은 있고 구조 해석 결과는 없습니다 — 권상 배치 참조로만 쓰입니다'}
          className="inline-flex shrink-0 items-center rounded-xs bg-brand-subtle px-1.5 text-micro font-medium text-brand">
      {lifting.has_result ? 'Wire · 결과 포함' : 'Wire 포함'}
    </span>
  );
}
