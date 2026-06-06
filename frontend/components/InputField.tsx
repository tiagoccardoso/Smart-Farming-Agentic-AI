type Props = {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  value: string | number;
  onChange: (value: string) => void;
  required?: boolean;
};

export default function InputField({
  label,
  name,
  type = "number",
  placeholder,
  value,
  onChange,
  required = false,
}: Props) {
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-paper-200 bg-paper-50 px-4 py-3 text-slate-900 shadow-inner-soft outline-none transition placeholder:text-slate-400 focus:border-leaf-500 focus:bg-white focus:ring-4 focus:ring-leaf-100"
      />
    </label>
  );
}
