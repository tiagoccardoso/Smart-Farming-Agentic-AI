"use client";
import { useCallback, useEffect, useState } from "react";
import { getCurrentAuthSession } from "../../../lib/supabaseAuth";

const statusOptions = ["novo", "em_contato", "confirmado", "cancelado", "concluido"];

export default function Page() {
  const [items, setItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [cityFilter, setCityFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sortBy, setSortBy] = useState("created_at");

  const load = useCallback(async () => {
    const s = await getCurrentAuthSession();
    if (!s?.access_token) return;
    const params = new URLSearchParams();
    if (statusFilter !== "todos") params.set("status", statusFilter);
    if (cityFilter) params.set("city", cityFilter);
    if (stateFilter) params.set("state", stateFilter);
    params.set("sort", sortBy);
    const r = await fetch(`/api/admin/agendamentos?${params.toString()}`, { headers: { Authorization: `Bearer ${s.access_token}` } });
    if (r.ok) setItems((await r.json()).items || []);
  }, [cityFilter, sortBy, stateFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  return <div className='mx-auto max-w-6xl px-6 py-10'>
    <h1 className='text-3xl font-bold text-[#123F2A]'>Agendamentos</h1>
    <div className='mt-4 grid gap-3 md:grid-cols-4'>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className='rounded border p-2'><option value='todos'>Todos os status</option>{statusOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>
      <input value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} placeholder='Filtrar por cidade' className='rounded border p-2' />
      <input value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} placeholder='Filtrar por estado' className='rounded border p-2' />
      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className='rounded border p-2'><option value='created_at'>Ordenar por envio</option><option value='preferred_date'>Ordenar por data desejada</option></select>
    </div>
    <div className='mt-6 space-y-4'>{items.map((i) => <Card key={i.id} item={i} onSaved={load} />)}</div>
  </div>;
}

function Card({ item, onSaved }: { item: any; onSaved: () => void }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.internal_notes ?? "");
  async function save() {
    const s = await getCurrentAuthSession();
    if (!s?.access_token) return;
    await fetch(`/api/admin/agendamentos/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` }, body: JSON.stringify({ status, internal_notes: notes }) });
    onSaved();
  }
  return <div className='rounded-2xl border bg-white p-4'>
    <p className='font-semibold text-[#123F2A]'>{item.name} • {item.request_type}</p>
    <p className='text-sm'>Contato: {item.email || '-'} | {item.phone || '-'}</p>
    <p className='text-sm'>Local: {item.city || '-'} / {item.state || '-'}</p>
    <p className='text-sm'>Data desejada: {item.preferred_date ?? '-'} às {item.preferred_time ?? '-'}</p>
    <p className='text-sm'>Enviado em: {new Date(item.created_at).toLocaleString('pt-BR')}</p>
    <p className='mt-1 text-sm'>Mensagem: {item.message || '-'}</p>
    <div className='mt-2 flex gap-2'>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className='rounded border p-1'>{statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} className='flex-1 rounded border p-1' placeholder='Observações internas' />
      <button onClick={save} className='rounded bg-[#2E7D32] px-3 py-1 text-white'>Salvar</button>
    </div>
  </div>;
}
