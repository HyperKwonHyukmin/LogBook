/** 빈 상태 — 위쪽 정렬, 작게, 동작 하나(선택). */
export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="mx-auto mt-12 flex max-w-[400px] flex-col items-center text-center">
      {Icon && <Icon size={20} strokeWidth={1.75} className="text-n-400" aria-hidden="true" />}
      <h2 className="mt-3 text-body font-semibold text-n-900">{title}</h2>
      {children && <p className="mt-1 text-ui text-n-600">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
