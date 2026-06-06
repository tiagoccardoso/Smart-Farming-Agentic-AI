"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import LoadingCard from "../../../components/agronomic/LoadingCard";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";
import type { UserRole } from "../../../lib/auth";

type ProfileStatus = "active" | "inactive";

type AdminUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: ProfileStatus | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  unlimited_access: boolean | null;
  current_plan: {
    name: string | null;
    slug: string | null;
    subscription_status: string | null;
  } | null;
  cases_count: number;
  human_reviews_count: number;
  details: {
    farms: Array<{
      id: string;
      name: string | null;
      city: string | null;
      state: string | null;
      area_hectares: number | null;
      soil_type: string | null;
      created_at: string | null;
    }>;
    cases: Array<{
      id: string;
      crop: string | null;
      status: string | null;
      risk_level: string | null;
      human_review_requested: boolean | null;
      human_review_status: string | null;
      created_at: string | null;
    }>;
    reports: Array<{
      id: string;
      case_id: string | null;
      report_type: string | null;
      report_url: string | null;
      created_at: string | null;
    }>;
    subscriptions: Array<{
      id: string;
      status: string | null;
      current_period_end: string | null;
      created_at: string | null;
      plans: { slug: string | null; name: string | null } | null;
    }>;
    payments: Array<{
      id: string;
      case_id: string | null;
      service_type: string | null;
      price_cents: number | null;
      payment_status: string | null;
      created_at: string | null;
    }>;
    usage_events: Array<{
      id: string;
      event_type: string | null;
      count: number | null;
      period_start: string | null;
      period_end: string | null;
      created_at: string | null;
    }>;
  };
};

type UsersResponse = {
  users: AdminUser[];
  role: "specialist" | "admin";
};

type EditUserForm = {
  full_name: string;
  phone: string;
  email: string;
  role: UserRole;
  status: ProfileStatus;
  unlimited_access: boolean;
  current_plan_slug: string;
};

type Filters = {
  name: string;
  email: string;
  role: "" | UserRole;
  status: "" | ProfileStatus;
  plan: string;
};

const roleLabels: Record<UserRole, string> = {
  client: "Cliente",
  specialist: "Especialista",
  admin: "Admin",
};

const statusLabels: Record<ProfileStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
};

const defaultFilters: Filters = {
  name: "",
  email: "",
  role: "",
  status: "",
  plan: "",
};

function parseResponse(response: Response) {
  return response
    .json()
    .catch(() => null)
    .then((payload) => {
      if (!response.ok) {
        throw new Error(
          payload?.error || "A solicitação não pôde ser concluída.",
        );
      }

      return payload;
    });
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Não disponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value?: number | null) {
  if (!value) {
    return "R$ 0,00";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function getBadgeClass(
  kind: "role" | "status" | "plan" | "unlimited",
  value?: string | boolean | null,
) {
  if (kind === "status") {
    return value === "inactive"
      ? "bg-red-50 text-red-700 ring-red-100"
      : "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  if (kind === "unlimited") {
    return value
      ? "bg-violet-50 text-violet-700 ring-violet-100"
      : "bg-slate-50 text-slate-600 ring-slate-100";
  }

  if (kind === "role") {
    return value === "admin"
      ? "bg-slate-900 text-white ring-slate-900"
      : value === "specialist"
        ? "bg-sun-100 text-sun-800 ring-sun-200"
        : "bg-leaf-50 text-leaf-700 ring-leaf-100";
  }

  return value
    ? "bg-sky-50 text-sky-700 ring-sky-100"
    : "bg-slate-50 text-slate-600 ring-slate-100";
}

function Badge({
  kind,
  value,
  children,
}: {
  kind: "role" | "status" | "plan" | "unlimited";
  value?: string | boolean | null;
  children: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ${getBadgeClass(kind, value)}`}
    >
      {children}
    </span>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-leaf-200 bg-white p-8 text-center shadow-soft">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}

export default function UsuariosPainelDoutoraPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [currentRole, setCurrentRole] = useState<"specialist" | "admin" | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [mutatingUserId, setMutatingUserId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? users[0] ?? null,
    [selectedUserId, users],
  );
  const planOptions = useMemo(() => {
    const options = new Map<string, string>();
    users.forEach((user) => {
      if (user.current_plan?.slug && user.current_plan.name) {
        options.set(user.current_plan.slug, user.current_plan.name);
      }
    });
    return Array.from(options.entries());
  }, [users]);

  async function loadUsers(nextFilters = appliedFilters) {
    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setAccessDenied(false);

    try {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        }
      });
      const response = await fetch(
        `/api/specialist/users${params.toString() ? `?${params.toString()}` : ""}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const payload = (await parseResponse(response)) as UsersResponse;
      setUsers(payload.users);
      setCurrentRole(payload.role);
      setSelectedUserId((current) =>
        current && payload.users.some((user) => user.id === current)
          ? current
          : (payload.users[0]?.id ?? null),
      );
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar usuários.";
      if (message.toLowerCase().includes("acesso negado")) {
        setAccessDenied(true);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers(defaultFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(field: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  async function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(filters);
    await loadUsers(filters);
  }

  function openEditUser(user: AdminUser) {
    setEditingUser(user);
    setEditForm({
      full_name: user.full_name ?? "",
      phone: user.phone ?? "",
      email: user.email ?? "",
      role: user.role,
      status: user.status ?? "active",
      unlimited_access: Boolean(user.unlimited_access),
      current_plan_slug: user.current_plan?.slug ?? "",
    });
    setError(null);
    setSuccessMessage(null);
  }

  function closeEditUser() {
    if (savingEdit) {
      return;
    }
    setEditingUser(null);
    setEditForm(null);
  }

  function updateEditForm<K extends keyof EditUserForm>(
    field: K,
    value: EditUserForm[K],
  ) {
    setEditForm((current) =>
      current ? { ...current, [field]: value } : current,
    );
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingUser || !editForm) {
      return;
    }

    if (
      !editForm.full_name.trim() ||
      !editForm.phone.trim() ||
      !editForm.email.trim()
    ) {
      setError("Nome completo, telefone e e-mail são obrigatórios.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      return;
    }

    setSavingEdit(true);
    setMutatingUserId(editingUser.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/specialist/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: editingUser.id,
          ...editForm,
          current_plan_slug: editForm.current_plan_slug || null,
        }),
      });
      await parseResponse(response);
      setSuccessMessage("Alterações salvas com sucesso.");
      setEditingUser(null);
      setEditForm(null);
      await loadUsers(appliedFilters);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar as alterações.",
      );
    } finally {
      setSavingEdit(false);
      setMutatingUserId(null);
    }
  }

  async function mutateUser(
    user: AdminUser,
    payload: Partial<Pick<AdminUser, "status" | "unlimited_access" | "role">>,
  ) {
    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      return;
    }

    setMutatingUserId(user.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/specialist/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: user.id, ...payload }),
      });
      await parseResponse(response);
      setSuccessMessage("Usuário atualizado com segurança.");
      await loadUsers(appliedFilters);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Não foi possível atualizar o usuário.",
      );
    } finally {
      setMutatingUserId(null);
    }
  }

  if (accessDenied) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-16">
        <EmptyState
          title="Acesso restrito"
          description="Entre com uma conta specialist/admin ativa para gerenciar usuários."
        />
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12">
      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          href="/configuracoes"
          className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
        >
          ⚙️ Configurações
        </Link>
        <Link
          href="/painel-doutora/usuarios"
          className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft"
        >
          Usuários
        </Link>
        <Link
          href="/painel-doutora/culturas"
          className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
        >
          Culturas
        </Link>
      </div>

      <p className="text-sm font-bold uppercase tracking-[0.2em] text-leaf-700">
        Administração da especialista
      </p>
      <SectionTitle
        title="Usuários"
        subtitle="Visualize perfis, acompanhe uso da consultoria agronômica, bloqueie contas e libere acesso ilimitado com validação no backend."
      />

      {error && (
        <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
          {successMessage}
        </div>
      )}

      <form
        onSubmit={handleFilterSubmit}
        className="mt-8 grid gap-4 rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft md:grid-cols-2 xl:grid-cols-6 xl:items-end"
      >
        <label className="block xl:col-span-2">
          <span className="text-sm font-semibold text-slate-700">
            Buscar por nome
          </span>
          <input
            value={filters.name}
            onChange={(event) => updateFilter("name", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
            placeholder="Nome completo"
          />
        </label>
        <label className="block xl:col-span-2">
          <span className="text-sm font-semibold text-slate-700">
            Buscar por e-mail
          </span>
          <input
            value={filters.email}
            onChange={(event) => updateFilter("email", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
            placeholder="email@exemplo.com"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Role</span>
          <select
            value={filters.role}
            onChange={(event) => updateFilter("role", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
          >
            <option value="">Todas</option>
            <option value="client">Cliente</option>
            <option value="specialist">Especialista</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Status</span>
          <select
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
          >
            <option value="">Todos</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </label>
        <label className="block xl:col-span-2">
          <span className="text-sm font-semibold text-slate-700">Plano</span>
          <select
            value={filters.plan}
            onChange={(event) => updateFilter("plan", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
          >
            <option value="">Todos</option>
            <option value="sem-plano">Sem plano</option>
            {planOptions.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3 xl:col-span-4">
          <button
            type="submit"
            className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(defaultFilters);
              setAppliedFilters(defaultFilters);
              loadUsers(defaultFilters);
            }}
            className="rounded-full border border-leaf-200 px-5 py-3 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
          >
            Limpar
          </button>
        </div>
      </form>

      {editingUser && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveEdit}
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl md:p-8"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">
                  Editar usuário
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">
                  {editingUser.full_name || editingUser.email || "Usuário"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Validações sensíveis também são aplicadas no backend.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditUser}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar edição
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              <section className="rounded-3xl border border-leaf-100 bg-leaf-50/40 p-5 lg:col-span-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
                  Perfil
                </h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">
                      Nome completo *
                    </span>
                    <input
                      required
                      value={editForm.full_name}
                      onChange={(event) =>
                        updateEditForm("full_name", event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">
                      Telefone *
                    </span>
                    <input
                      required
                      value={editForm.phone}
                      onChange={(event) =>
                        updateEditForm("phone", event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">
                      E-mail *
                    </span>
                    <input
                      required
                      type="email"
                      value={editForm.email}
                      onChange={(event) =>
                        updateEditForm("email", event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-soft">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
                  Permissões
                </h3>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-slate-700">
                    Role
                  </span>
                  <select
                    value={editForm.role}
                    onChange={(event) =>
                      updateEditForm("role", event.target.value as UserRole)
                    }
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  >
                    <option value="client">client</option>
                    <option value="specialist">specialist</option>
                    {currentRole === "admin" && (
                      <option value="admin">admin</option>
                    )}
                  </select>
                </label>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-slate-700">
                    Status
                  </span>
                  <select
                    value={editForm.status}
                    onChange={(event) =>
                      updateEditForm(
                        "status",
                        event.target.value as ProfileStatus,
                      )
                    }
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
                <label className="mt-4 flex items-center gap-3 rounded-2xl bg-violet-50 p-4 text-sm font-semibold text-violet-800">
                  <input
                    type="checkbox"
                    checked={editForm.unlimited_access}
                    onChange={(event) =>
                      updateEditForm("unlimited_access", event.target.checked)
                    }
                  />{" "}
                  Acesso ilimitado
                </label>
              </section>

              <section className="rounded-3xl border border-sky-100 bg-sky-50/50 p-5 lg:col-span-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
                  Plano
                </h3>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-slate-700">
                    Plano atual, se aplicável
                  </span>
                  <select
                    value={editForm.current_plan_slug}
                    onChange={(event) =>
                      updateEditForm("current_plan_slug", event.target.value)
                    }
                    className="mt-2 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">Sem alteração / sem plano</option>
                    {planOptions.map(([slug, name]) => (
                      <option key={slug} value={slug}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="rounded-3xl border border-slate-100 bg-slate-50 p-5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
                  Uso da plataforma
                </h3>
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <p>
                    <strong>{editingUser.cases_count}</strong> casos enviados
                  </p>
                  <p>
                    <strong>{editingUser.human_reviews_count}</strong> revisões
                    humanas pagas
                  </p>
                  <p>
                    Último acesso: {formatDate(editingUser.last_sign_in_at)}
                  </p>
                </div>
              </section>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeEditUser}
                disabled={savingEdit}
                className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar edição
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {savingEdit ? "Salvando alterações..." : "Salvar alterações"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="mt-8">
          <LoadingCard
            title="Carregando usuários"
            description="Consultando perfis, assinaturas, pagamentos e uso da IA."
          />
        </div>
      ) : users.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nenhum usuário encontrado"
            description="Ajuste os filtros para ampliar a busca."
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="overflow-hidden rounded-3xl border border-leaf-100 bg-white shadow-soft">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                <thead className="bg-leaf-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Usuário</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Plano</th>
                    <th className="px-4 py-3">Casos</th>
                    <th className="px-4 py-3">Revisões</th>
                    <th className="px-4 py-3">Último acesso</th>
                    <th className="px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => {
                    const inactive = (user.status ?? "active") === "inactive";
                    const unlimited = Boolean(user.unlimited_access);
                    return (
                      <tr
                        key={user.id}
                        className={`${selectedUser?.id === user.id ? "bg-leaf-50/70" : ""} ${inactive ? "bg-red-50/50 text-slate-500" : ""} ${unlimited ? "outline outline-1 outline-violet-100" : ""}`}
                      >
                        <td className="px-4 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(user.id)}
                            className="text-left font-semibold text-slate-900 hover:text-leaf-700"
                          >
                            {user.full_name || "Sem nome"}
                          </button>
                          <p className="mt-1 text-xs text-slate-500">
                            {user.email || "E-mail indisponível"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {user.phone || "Telefone não informado"}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Cadastro: {formatDate(user.created_at)}
                          </p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Badge kind="role" value={user.role}>
                            {roleLabels[user.role]}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Badge kind="status" value={user.status ?? "active"}>
                            {statusLabels[user.status ?? "active"]}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Badge kind="plan" value={user.current_plan?.slug}>
                            {user.current_plan?.name || "Sem plano"}
                          </Badge>
                          {unlimited && (
                            <div className="mt-2">
                              <Badge kind="unlimited" value>
                                Acesso ilimitado
                              </Badge>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 align-top font-semibold text-slate-700">
                          {user.cases_count}
                        </td>
                        <td className="px-4 py-4 align-top font-semibold text-slate-700">
                          {user.human_reviews_count}
                        </td>
                        <td className="px-4 py-4 align-top text-xs text-slate-600">
                          {formatDate(user.last_sign_in_at)}
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex min-w-44 flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => openEditUser(user)}
                              className="rounded-full bg-leaf-600 px-3 py-2 text-xs font-semibold text-white hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Editar usuário
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                mutateUser(user, {
                                  status: inactive ? "active" : "inactive",
                                })
                              }
                              disabled={mutatingUserId === user.id}
                              className="rounded-full border border-leaf-200 px-3 py-2 text-xs font-semibold text-leaf-700 hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {inactive
                                ? "Ativar usuário"
                                : "Desativar usuário"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                mutateUser(user, {
                                  unlimited_access: !unlimited,
                                })
                              }
                              disabled={mutatingUserId === user.id}
                              className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {unlimited
                                ? "Remover ilimitado"
                                : "Conceder acesso ilimitado"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedUser && (
            <aside className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">
                    Detalhe do usuário
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">
                    {selectedUser.full_name || "Sem nome"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {selectedUser.email || "E-mail indisponível"}
                  </p>
                </div>
                <Badge kind="unlimited" value={selectedUser.unlimited_access}>
                  {selectedUser.unlimited_access ? "Ilimitado" : "Limitado"}
                </Badge>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">
                    Telefone
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {selectedUser.phone || "Não informado"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">
                    Plano atual
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {selectedUser.current_plan?.name || "Sem plano"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">
                    Cadastro
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {formatDate(selectedUser.created_at)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">
                    Último acesso
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {formatDate(selectedUser.last_sign_in_at)}
                  </p>
                </div>
              </div>

              {currentRole === "admin" && (
                <label className="mt-5 block rounded-2xl border border-leaf-100 bg-leaf-50/60 p-4">
                  <span className="text-sm font-semibold text-slate-700">
                    Alterar role
                  </span>
                  <select
                    value={selectedUser.role}
                    onChange={(event) =>
                      mutateUser(selectedUser, {
                        role: event.target.value as UserRole,
                      })
                    }
                    disabled={mutatingUserId === selectedUser.id}
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  >
                    <option value="client">Cliente</option>
                    <option value="specialist">Especialista</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              )}

              <div className="mt-6 space-y-5">
                <DetailList
                  title="Propriedades cadastradas"
                  empty="Nenhuma propriedade cadastrada."
                >
                  {selectedUser.details.farms.map((farm) => (
                    <li key={farm.id} className="rounded-2xl bg-slate-50 p-3">
                      <strong>{farm.name || "Propriedade sem nome"}</strong>
                      <br />
                      {[farm.city, farm.state].filter(Boolean).join("/") ||
                        "Local não informado"}{" "}
                      · {farm.area_hectares ?? "Área não informada"} ha · Solo:{" "}
                      {farm.soil_type || "não informado"}
                    </li>
                  ))}
                </DetailList>
                <DetailList title="Casos enviados" empty="Nenhum caso enviado.">
                  {selectedUser.details.cases.map((caseData) => (
                    <li
                      key={caseData.id}
                      className="rounded-2xl bg-slate-50 p-3"
                    >
                      <strong>
                        {caseData.crop || "Cultura não informada"}
                      </strong>{" "}
                      · {caseData.status || "sem status"}
                      <br />
                      Risco: {caseData.risk_level || "não classificado"} ·
                      Revisão:{" "}
                      {caseData.human_review_status || "não solicitada"}
                      <br />
                      {formatDate(caseData.created_at)}
                    </li>
                  ))}
                </DetailList>
                <DetailList
                  title="Relatórios gerados"
                  empty="Nenhum relatório gerado."
                >
                  {selectedUser.details.reports.map((report) => (
                    <li key={report.id} className="rounded-2xl bg-slate-50 p-3">
                      <strong>{report.report_type || "Relatório"}</strong>
                      <br />
                      Caso: {report.case_id || "não vinculado"} ·{" "}
                      {formatDate(report.created_at)}
                    </li>
                  ))}
                </DetailList>
                <DetailList
                  title="Assinatura atual e histórico"
                  empty="Nenhuma assinatura registrada."
                >
                  {selectedUser.details.subscriptions.map((subscription) => (
                    <li
                      key={subscription.id}
                      className="rounded-2xl bg-slate-50 p-3"
                    >
                      <strong>
                        {subscription.plans?.name || "Plano sem nome"}
                      </strong>
                      <br />
                      Status: {subscription.status || "sem status"} · Período
                      até: {formatDate(subscription.current_period_end)}
                    </li>
                  ))}
                </DetailList>
                <DetailList
                  title="Histórico de pagamentos"
                  empty="Nenhum pagamento registrado."
                >
                  {selectedUser.details.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="rounded-2xl bg-slate-50 p-3"
                    >
                      <strong>{payment.service_type || "Serviço"}</strong> ·{" "}
                      {formatMoney(payment.price_cents)}
                      <br />
                      Status: {payment.payment_status || "sem status"} ·{" "}
                      {formatDate(payment.created_at)}
                    </li>
                  ))}
                </DetailList>
                <DetailList
                  title="Uso dos recursos da IA"
                  empty="Nenhum uso registrado."
                >
                  {selectedUser.details.usage_events.map((usage) => (
                    <li key={usage.id} className="rounded-2xl bg-slate-50 p-3">
                      <strong>{usage.event_type || "recurso"}</strong> ·{" "}
                      {usage.count ?? 0} uso(s)
                      <br />
                      Período: {formatDate(usage.period_start)} até{" "}
                      {formatDate(usage.period_end)}
                    </li>
                  ))}
                </DetailList>
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

function DetailList({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode[] | ReactNode;
}) {
  const hasItems = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);

  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
        {title}
      </h3>
      {hasItems ? (
        <ul className="mt-3 space-y-2 text-sm text-slate-700">{children}</ul>
      ) : (
        <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
          {empty}
        </p>
      )}
    </section>
  );
}
