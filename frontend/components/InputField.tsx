type Props = {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  value: string | number;
  onChange: (value: string) => void;
  required?: boolean;
};

export default function InputField({ label, name, type = "number", placeholder, value, onChange, required = false }: Props) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#1d1c16]">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-[#c1c9c1] bg-white px-4 py-3 text-sm font-normal text-[#1d1c16] placeholder:text-[#717973] transition focus:border-[#123f2a] focus:outline-none focus:ring-2 focus:ring-[#123f2a]/15"
      />
    </label>
  );
}
