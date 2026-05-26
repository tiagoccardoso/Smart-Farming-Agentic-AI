type LoadingCardProps = {
  title: string;
  description?: string;
  rows?: number;
};

export default function LoadingCard({ title, description, rows = 3 }: LoadingCardProps) {
  return (
    <div className="rounded-2xl border border-[#e7e2d9] bg-white p-6 shadow-card" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-[#123f2a]" aria-hidden />
        <p className="font-semibold text-[#002817]">{title}</p>
      </div>
      {description && <p className="mt-2 text-sm leading-6 text-[#414943]">{description}</p>}
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-4 animate-pulse rounded-full bg-[#f2ede4]" style={{ width: `${92 - index * 14}%` }} />
        ))}
      </div>
    </div>
  );
}
