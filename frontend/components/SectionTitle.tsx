type Props = {
  title: string;
  subtitle?: string;
};

export default function SectionTitle({ title, subtitle }: Props) {
  return (
    <div className="mb-6">
      <h2 className="text-3xl font-bold tracking-tight text-moss-800 md:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600 md:text-lg">
          {subtitle}
        </p>
      )}
    </div>
  );
}
