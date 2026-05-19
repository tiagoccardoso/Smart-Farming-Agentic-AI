"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import {
  getCurrentAuthSession,
  loginWithEmailPassword,
  requestPasswordRecovery,
} from "../../lib/supabaseAuth";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid_credentials") ||
    normalized.includes("email not confirmed") ||
    normalized.includes("invalid grant")
  ) {
    return "E-mail ou senha inválidos. Verifique os dados e tente novamente.";
  }

  if (
    normalized.includes("email") &&
    (normalized.includes("confirm") || normalized.includes("verified"))
  ) {
    return "Seu usuário ainda não foi confirmado. Verifique seu e-mail antes de entrar.";
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timeout")
  ) {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }

  if (
    normalized.includes("sessão inválida retornada pelo servidor") ||
    normalized.includes("sessao invalida retornada pelo servidor")
  ) {
    return "A autenticação retornou uma sessão inválida. Tente entrar novamente em instantes.";
  }

  if (
    normalized.includes("sessão não foi persistida no navegador") ||
    normalized.includes("sessao nao foi persistida no navegador")
  ) {
    return "Seu login foi aceito, mas a sessão não ficou ativa no navegador. Atualize a página e tente novamente.";
  }

  if (
    normalized.includes("sessão não encontrada") ||
    normalized.includes("sessao nao encontrada") ||
    normalized.includes("sessão inválida") ||
    normalized.includes("sessao invalida")
  ) {
    return "Não foi possível validar sua sessão de acesso. Tente entrar novamente.";
  }

  return "Não foi possível concluir o login agora. Tente novamente em instantes.";
}

function resolveRedirectTarget(rawTarget: string | null) {
  if (!rawTarget) {
    return "/consultoria-ia";
  }

  if (!rawTarget.startsWith("/") || rawTarget.startsWith("//")) {
    return "/consultoria-ia";
  }

  if (rawTarget === "/login" || rawTarget.startsWith("/login?")) {
    return "/consultoria-ia";
  }

  return rawTarget;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = resolveRedirectTarget(
    searchParams.get("redirectTo") || searchParams.get("next"),
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  const disableSubmit = loading || recoveringPassword;

  const progressClasses = useMemo(
    () =>
      loading
        ? "translate-x-0 opacity-100"
        : "-translate-x-full opacity-0 group-hover:opacity-60",
    [loading],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) {
      return;
    }

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError("Informe seu e-mail.");
      return;
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Informe um e-mail válido.");
      return;
    }

    if (!password) {
      setError("Informe sua senha.");
      return;
    }

    setLoading(true);
    setError(null);
    setRecoveryMessage(null);

    try {
      const authPayload = await loginWithEmailPassword(normalizedEmail, password);

      if (!authPayload.access_token || !authPayload.user?.id) {
        throw new Error("Sessão inválida retornada pelo servidor.");
      }

      router.refresh();
      router.replace(redirectTo);

      if (process.env.NODE_ENV === "development") {
        void getCurrentAuthSession().catch((sessionError) => {
          console.warn(
            "Diagnóstico pós-login: /api/auth/me ainda indisponível logo após autenticação.",
            sessionError,
          );
        });
      }
    } catch (loginError) {
      const message =
        loginError instanceof Error
          ? friendlyAuthError(loginError.message)
          : "Não foi possível concluir o login agora. Tente novamente em instantes.";

      if (process.env.NODE_ENV !== "production") {
        console.error("Falha no login:", loginError);
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordRecovery() {
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError("Informe seu e-mail.");
      return;
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Informe um e-mail válido.");
      return;
    }

    setRecoveringPassword(true);
    setError(null);
    setRecoveryMessage(null);

    try {
      const payload = await requestPasswordRecovery(normalizedEmail);
      setRecoveryMessage(
        payload.message ??
          "Enviamos as instruções de recuperação para o e-mail informado.",
      );
    } catch (recoveryError) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Falha ao recuperar senha:", recoveryError);
      }

      setError(
        recoveryError instanceof Error
          ? recoveryError.message
          : "Não foi possível enviar a recuperação de senha.",
      );
    } finally {
      setRecoveringPassword(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Área segura
        </p>
        <SectionTitle
          title="Entrar"
          subtitle="Acesse sua consultoria agrícola com e-mail e senha."
        />
        <p className="text-base leading-7 text-slate-700">
          Faça login para enviar casos, acompanhar relatórios, solicitar revisão
          humana e consultar a IA usando seus dados protegidos pelo Supabase
          Auth.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={loading}
        className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8"
      >
        <div className="space-y-5">
          <InputField
            label="E-mail"
            name="email"
            type="email"
            value={email}
            onChange={(value) => setEmail(value)}
            required
          />
          <InputField
            label="Senha"
            name="password"
            type="password"
            value={password}
            onChange={(value) => setPassword(value)}
            required
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {recoveryMessage && (
          <div className="mt-5 rounded-2xl border border-leaf-200 bg-leaf-50 p-4 text-sm text-leaf-800">
            {recoveryMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={disableSubmit}
          aria-busy={loading}
          className="group relative mt-6 w-full overflow-hidden rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span
            aria-hidden="true"
            className={`absolute inset-0 bg-gradient-to-r from-leaf-400/20 via-white/25 to-leaf-300/20 transition-all duration-700 ${progressClasses}`}
          />
          <span className="relative flex items-center justify-center gap-2">
            {loading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
            )}
            {loading ? "Entrando..." : "Entrar"}
          </span>
        </button>

        <div className="mt-5 space-y-3 text-center text-sm text-slate-600">
          <button
            type="button"
            onClick={handlePasswordRecovery}
            disabled={recoveringPassword || loading || !email.trim()}
            className="font-semibold text-leaf-700 hover:text-leaf-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recoveringPassword
              ? "Enviando recuperação..."
              : "Esqueci minha senha"}
          </button>
          <p>
            Ainda não tem conta?{" "}
            <Link
              href="/register"
              className="font-semibold text-leaf-700 hover:text-leaf-800"
            >
              Criar cadastro
            </Link>
          </p>
        </div>
      </form>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">
          Carregando login...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
