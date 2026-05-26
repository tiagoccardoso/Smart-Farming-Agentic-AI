type Props = {
  label: string;
  value: string;
};

export default function MetricBadge({ label, value }: Props) {
  return (
    <div className="rounded-xl border border-[#e7e2d9] bg-white px-4 py-3 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#717973]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[#123f2a]">{value}</p>
    </div>
  );
}
