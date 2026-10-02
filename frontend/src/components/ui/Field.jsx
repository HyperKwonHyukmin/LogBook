/** 입력류 공통 모양(DESIGN.md §입력). .field 가 포커스 링을 그린다. */
export const inputClass = (className = '') =>
  'field h-8 rounded-md border border-n-250 bg-n-0 px-2.5 text-ui text-n-900 shadow-xs outline-none '
  + 'transition-[border-color,box-shadow] duration-120 ease-out hover:border-n-300 focus-visible:outline-none '
  + `disabled:cursor-not-allowed disabled:border-n-200 disabled:bg-n-50 disabled:text-n-500 disabled:shadow-none ${className}`;

export const selectClass = (className = '') => inputClass(`pr-7 ${className}`);

export function Input({ className = '', ...rest }) {
  return <input className={inputClass(className)} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return <select className={selectClass(className)} {...rest}>{children}</select>;
}

/** 위쪽 라벨 + 입력. */
export function Labeled({ label, children, className = '' }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-meta font-medium text-n-600 ${className}`}>
      {label}
      {children}
    </label>
  );
}
