type LoadingCardProps = {
  title: string;
  description?: string;
  rows?: number;
};

export default function LoadingCard({ title, description, rows = 3 }: LoadingCardProps) {
  return (
    <div className="rounded-[2rem] border border-paper-200 bg-white/95 p-6 shadow-soft" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="relative flex h-4 w-4" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf-400 opacity-60" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-leaf-600" />
        </span>
        <p className="font-bold text-moss-800">{title}</p>
      </div>
      {description && <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>}
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-4 animate-pulse rounded-full bg-paper-200" style={{ width: `${92 - index * 14}%` }} />
        ))}
      </div>
    </div>
  );
}
