/**
 * Campo invisivel anti-spam: pessoas nao o veem nem o preenchem; bots que
 * preenchem todos os campos sao descartados no servidor.
 */
export default function HoneypotField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Site (deixe em branco)
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
