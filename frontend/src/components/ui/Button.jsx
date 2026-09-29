/** 공통 버튼. WorkBench components/ui/Button.jsx 의 variant 체계를 가져왔다. */
const VARIANTS = {
  primary: 'bg-brand text-white border-brand hover:bg-brand-dark',
  secondary: 'bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50',
  danger: 'bg-white text-err border-zinc-300 hover:bg-red-50',
  ghost: 'bg-transparent text-zinc-600 border-transparent hover:bg-zinc-100',
};
const SIZES = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-[13px]', lg: 'h-10 px-4 text-sm' };

export default function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
