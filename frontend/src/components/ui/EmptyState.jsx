export default function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="mx-auto mt-24 flex max-w-md flex-col items-center gap-3 text-center">
      {Icon && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand"><Icon size={22} aria-hidden="true" /></div>}
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="text-sm leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}
