export default function Logo({ size = 30, withText = true }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="relative flex items-center justify-center rounded-[7px] bg-brand text-white"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span className="absolute right-1 top-1 h-[5px] w-[5px] rounded-full bg-spark" />
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none"
             stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 6.5c3.2-1.5 5.8-1.5 8.5 0 2.7-1.5 5.3-1.5 8.5 0v11c-3.2-1.5-5.8-1.5-8.5 0-2.7-1.5-5.3-1.5-8.5 0z" />
          <path d="M12 6.5v11" />
        </svg>
      </div>
      {withText && (
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold tracking-tight">Logbook</span>
          <span className="text-[11px] text-zinc-500">구조해석 항해일지</span>
        </div>
      )}
    </div>
  );
}
