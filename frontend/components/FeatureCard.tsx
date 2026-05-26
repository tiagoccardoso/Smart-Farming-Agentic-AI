type Props = {
  title: string;
  description: string;
  icon: string;
};

export default function FeatureCard({ title, description, icon }: Props) {
  return (
    <div className="rounded-2xl border border-[#e7e2d9] bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#f2ede4] text-2xl">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[#002817]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#414943]">{description}</p>
    </div>
  );
}
