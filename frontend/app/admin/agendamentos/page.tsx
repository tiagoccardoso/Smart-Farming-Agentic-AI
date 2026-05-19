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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const session = await getCurrentAuthSession();
    if (!session?.access_token) return;
    const params = new URLSearchParams();
    if (statusFilter !== "todos") params.set("status", statusFilter);
    if (cityFilter) params.set("city", cityFilter);
    if (stateFilter) params.set("state", stateFilter);
    params.set("sort", sortBy);
    const response = await fetch(`/api/admin/agendamentos?${params.toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (response.ok) setItems((await response.json()).items || []);
    else setError("Não foi possível carregar os agendamentos.");
  }, [cityFilter, sortBy, stateFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  return <div className='mx-auto max-w-6xl px-6 py-10'>
    <h1 className='text-3xl font-bold text-[#123F2A]'>Agendamentos</h1>
    <p className="mt-2 max-w-3xl text-slate-600">Gerencie solicitações recebidas pelo formulário de contato. Apenas especialistas e administradores têm acesso a esta área.</p>
    <div className='mt-4 grid gap-3 md:grid-cols-4'>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className='rounded-2xl border border-leaf-100 p-3'><option value='todos'>Todos os status</option>{statusOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>
      <input value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} placeholder='Filtrar por cidade' className='rounded-2xl border border-leaf-100 p-3' />
      <input value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} placeholder='Filtrar por estado' className='rounded-2xl border border-leaf-100 p-3' />
      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className='rounded-2xl border border-leaf-100 p-3'><option value='created_at'>Ordenar por envio</option><option value='preferred_date'>Ordenar por data desejada</option></select>
    </div>
    {message && <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className='mt-6 space-y-4'>{items.length === 0 ? <div className="rounded-3xl border bg-white p-6 text-slate-600">Nenhum agendamento encontrado.</div> : items.map((item) => <Card key={item.id} item={item} onSaved={(text) => { setMessage(text); setError(""); load(); }} onDeleted={(text) => { setMessage(text); setError(""); setItems((current) => current.filter((row) => row.id !== item.id)); }} onError={(text) => { setError(text); setMessage(""); }} />)}</div>
  </div>;
}

function Card({ item, onSaved, onDeleted, onError }: { item: any; onSaved: (message: string) => void; onDeleted: (message: string) => void; onError: (message: string) => void }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.internal_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const session = await getCurrentAuthSession();
      if (!session?.access_token) throw new Error("Sessão expirada.");
      const response = await fetch(`/api/admin/agendamentos/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ status, internal_notes: notes }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar o agendamento.");
      onSaved(payload?.message || "Agendamento salvo com sucesso.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível salvar o agendamento.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (deleting) return;
    const confirmed = window.confirm("Tem certeza que deseja excluir este agendamento? Esta ação não poderá ser desfeita.");
    if (!confirmed) return;
    setDeleting(true);
    try {
      const session = await getCurrentAuthSession();
      if (!session?.access_token) throw new Error("Sessão expirada.");
      const response = await fetch(`/api/admin/agendamentos/${item.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível excluir o agendamento.");
      onDeleted(payload?.message || "Agendamento excluído com sucesso.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível excluir o agendamento.");
    } finally {
      setDeleting(false);
    }
  }

  return <div className='rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft'>
    <p className='font-semibold text-[#123F2A]'>{item.name} • {item.request_type}</p>
    <p className='text-sm'>Contato: {item.email || '-'} | {item.phone || '-'}</p>
    <p className='text-sm'>Local: {item.city || '-'} / {item.state || '-'}</p>
    <p className='text-sm'>Data desejada: {item.preferred_date ?? '-'} às {item.preferred_time ?? '-'}</p>
    <p className='text-sm'>Enviado em: {new Date(item.created_at).toLocaleString('pt-BR')}</p>
    <p className='mt-1 text-sm'>Mensagem: {item.message || '-'}</p>
    <div className='mt-4 grid gap-2 md:grid-cols-[180px_1fr_auto_auto]'>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className='rounded-2xl border border-leaf-100 p-2'>{statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} className='rounded-2xl border border-leaf-100 p-2' placeholder='Observações internas' />
      <button onClick={save} disabled={saving} aria-busy={saving} className='rounded-full bg-[#2E7D32] px-4 py-2 text-white disabled:bg-slate-300'>{saving ? "Salvando..." : "Salvar"}</button>
      <button onClick={remove} disabled={deleting} aria-busy={deleting} className='rounded-full border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50 disabled:text-slate-400'>{deleting ? "Excluindo..." : "Excluir"}</button>
    </div>
  </div>;
}
