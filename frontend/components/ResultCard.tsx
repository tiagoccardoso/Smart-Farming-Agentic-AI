type Props = {
  title: string;
  description: string;
};

export default function ResultCard({ title, description }: Props) {
  return (
    <div className="rounded-2xl border border-[#e7e2d9] bg-white p-5 shadow-card">
      <h4 className="text-base font-semibold text-[#002817]">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-[#414943]">{description}</p>
    </div>
  );
}
