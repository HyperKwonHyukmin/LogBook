import { CircleAlert } from 'lucide-react';

/** 표준 페이지 컨테이너 1종 — 검색(3-pane)을 뺀 모든 화면이 이것을 쓴다. */
export function Page({ children, className = '' }) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-6 py-6 min-[1441px]:px-8 ${className}`}>{children}</div>
  );
}

/** 페이지 머리말 — 제목 + 설명 + 오른쪽 동작, 아래 헤어라인. */
export function PageHeader({ title, description, actions, children }) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-n-200 pb-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-title font-semibold tracking-[-0.012em] text-n-900">{title}</h1>
        {description && <p className="mt-1 text-ui text-n-600">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 페이지 오류 줄 — 머리말 아래, 같은 모양. */
export function ErrorNote({ children, action, className = '' }) {
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err ${className}`}>
      <CircleAlert size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/** 성공 줄(복원 등). */
export function OkNote({ children, className = '' }) {
  return (
    <p role="status" className={`rounded-md bg-ok-bg px-3 py-2 text-ui text-ok ${className}`}>{children}</p>
  );
}

/** 섹션 제목(13/600, 대문자·eyebrow 없음). */
export function SectionTitle({ as: Tag = 'h2', children, className = '' }) {
  return <Tag className={`text-ui font-semibold text-n-700 ${className}`}>{children}</Tag>;
}
