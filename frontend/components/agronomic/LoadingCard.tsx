type LoadingCardProps = {
  title: string;
  description?: string;
  rows?: number;
};

export default function LoadingCard({ title, description, rows = 3 }: LoadingCardProps) {
  return (
    <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-leaf-500" aria-hidden />
        <p className="font-semibold text-slate-900">{title}</p>
      </div>
      {description && <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>}
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-4 animate-pulse rounded-full bg-slate-100" style={{ width: `${92 - index * 14}%` }} />
        ))}
      </div>
    </div>
  );
}
