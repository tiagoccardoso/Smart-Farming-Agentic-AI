type Props = {
  title: string;
  subtitle?: string;
};

export default function SectionTitle({ title, subtitle }: Props) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-semibold tracking-tight text-[#002817]">{title}</h2>
      {subtitle && <p className="mt-2 text-[#414943]">{subtitle}</p>}
    </div>
  );
}
