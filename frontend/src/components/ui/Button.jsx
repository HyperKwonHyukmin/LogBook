import Spinner from './Spinner.jsx';

/**
 * 공통 버튼(DESIGN.md §버튼). 비활성은 opacity 가 아니라 색으로 칠한다.
 * variant: primary | secondary | ghost | danger | danger-solid
 * size: sm(28) | md(32) | lg(36) | icon(32 정사각) | icon-sm(28 정사각)
 */
const VARIANTS = {
  primary: 'bg-brand text-white shadow-xs hover:bg-brand-hover active:bg-brand-press '
    + 'disabled:bg-n-150 disabled:text-n-500 disabled:shadow-none',
  secondary: 'border border-n-250 bg-n-0 text-n-800 shadow-xs hover:border-n-300 hover:bg-n-50 active:bg-n-100 '
    + 'disabled:border-n-200 disabled:bg-n-50 disabled:text-n-500 disabled:shadow-none',
  ghost: 'text-n-600 hover:bg-n-100 hover:text-n-900 active:bg-n-150 disabled:bg-transparent disabled:text-n-500',
  danger: 'border border-n-250 bg-n-0 text-err shadow-xs hover:border-err-line hover:bg-err-bg active:bg-err-press '
    + 'disabled:border-n-200 disabled:bg-n-50 disabled:text-n-500 disabled:shadow-none',
  'danger-solid': 'bg-err text-white shadow-xs hover:bg-err-strong active:bg-err-strong disabled:bg-n-150 disabled:text-n-500',
};
const SIZES = {
  sm: 'h-7 px-2.5 text-meta',
  md: 'h-8 px-3 text-ui',
  lg: 'h-9 px-4 text-body',
  icon: 'h-8 w-8',
  'icon-sm': 'h-7 w-7',
};

export const buttonClass = (variant = 'primary', size = 'md', className = '') =>
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium '
  + 'transition-[background-color,border-color,color,box-shadow] duration-120 ease-out select-none '
  + `disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

export default function Button({ variant = 'primary', size = 'md', className = '', type = 'button', loading = false,
                                 children, onClick, ...rest }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} aria-busy={loading || undefined}
            onClick={loading ? undefined : onClick} {...rest}>
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
