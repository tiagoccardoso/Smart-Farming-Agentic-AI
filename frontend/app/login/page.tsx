"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import {
  loginWithEmailPassword,
  requestPasswordRecovery,
  getCurrentAuthSession,
} from "../../lib/supabaseAuth";
import { LOGIN_MESSAGES, RECOVERY_MESSAGES } from "../../lib/auth-messages";

const POST_LOGIN_REDIRECT_PATH = "/consultoria-ia";
const RECOVERY_HINT_ID = "login-recovery-hint";

/**
 * Mensagem amigável para exibir na tela. As rotas de autenticação já devolvem
 * textos simples; falhas de rede (TypeError, ex.: "Failed to fetch") ou erros
 * sem mensagem caem no texto genérico informado.
 */
function friendlyErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError || !(error instanceof Error) || !error.message) {
    return fallback;
  }

  return error.message;
}

function getFormInput(form: HTMLFormElement | null, name: string) {
  const element = form?.elements.namedItem(name);
  return element instanceof HTMLInputElement ? element : null;
}

/** Aplica os textos da tela à validação nativa existente (required + type=email). */
function applyValidationMessages(form: HTMLFormElement | null) {
  const emailInput = getFormInput(form, "email");
  const passwordInput = getFormInput(form, "password");

  emailInput?.setCustomValidity("");
  passwordInput?.setCustomValidity("");

  if (emailInput?.validity.valueMissing) {
    emailInput.setCustomValidity(LOGIN_MESSAGES.missingFields);
  } else if (emailInput?.validity.typeMismatch) {
    emailInput.setCustomValidity(LOGIN_MESSAGES.invalidEmail);
  }

  if (passwordInput?.validity.valueMissing) {
    passwordInput.setCustomValidity(LOGIN_MESSAGES.missingFields);
  }
}

function resolvePostLoginRedirect(rawNextPath: string | null) {
  if (!rawNextPath) {
    return POST_LOGIN_REDIRECT_PATH;
  }

  try {
    const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const parsedUrl = new URL(rawNextPath, baseUrl);

    if (parsedUrl.origin !== baseUrl) {
      return POST_LOGIN_REDIRECT_PATH;
    }

    const isConsultoriaIaRoute =
      parsedUrl.pathname === POST_LOGIN_REDIRECT_PATH ||
      parsedUrl.pathname.startsWith(`${POST_LOGIN_REDIRECT_PATH}/`);

    if (!isConsultoriaIaRoute) {
      return POST_LOGIN_REDIRECT_PATH;
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return POST_LOGIN_REDIRECT_PATH;
  }
}

function LoginContent() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const postLoginRedirectPath = useMemo(
    () => resolvePostLoginRedirect(nextParam),
    [nextParam],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function redirectAuthenticatedUser() {
      const session = await getCurrentAuthSession().catch(() => null);

      if (active && session?.access_token) {
        router.replace(postLoginRedirectPath);
        router.refresh();
      }
    }

    void redirectAuthenticatedUser();

    return () => {
      active = false;
    };
  }, [postLoginRedirectPath, router]);

  useEffect(() => {
    applyValidationMessages(formRef.current);
  }, [email, password]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || recoveringPassword) {
      return;
    }

    setLoading(true);
    setError(null);
    setRecoveryMessage(null);

    try {
      const session = await loginWithEmailPassword(email, password);

      if (!session.access_token) {
        console.error("[login] resposta de login sem token de acesso.");
        throw new Error(LOGIN_MESSAGES.unavailable);
      }

      window.dispatchEvent(new Event("auth:changed"));
      window.location.replace(postLoginRedirectPath);
    } catch (loginError) {
      setError(friendlyErrorMessage(loginError, LOGIN_MESSAGES.unavailable));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordRecovery() {
    setError(null);
    setRecoveryMessage(null);

    if (getFormInput(formRef.current, "email")?.validity.typeMismatch) {
      setError(RECOVERY_MESSAGES.invalidEmail);
      return;
    }

    setRecoveringPassword(true);

    try {
      const payload = await requestPasswordRecovery(email);
      setRecoveryMessage(payload.message ?? RECOVERY_MESSAGES.success);
    } catch (recoveryError) {
      setError(friendlyErrorMessage(recoveryError, RECOVERY_MESSAGES.unavailable));
    } finally {
      setRecoveringPassword(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 sm:py-14 md:py-20 xl:grid-cols-[0.95fr_1.05fr] xl:items-center">
      <div className="rounded-3xl bg-hero-gradient p-5 shadow-soft sm:p-6 md:p-10">
        <SectionTitle
          title="Entre na sua conta"
          subtitle="Acompanhe seus casos, converse com a IA e consulte os pareceres do especialista."
        />
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:p-6 md:p-8"
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
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
          disabled={loading}
          className="mt-6 w-full rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <div className="mt-5 space-y-3 text-center text-sm text-slate-600">
          <button
            type="button"
            onClick={handlePasswordRecovery}
            disabled={recoveringPassword || !email}
            aria-describedby={!email ? RECOVERY_HINT_ID : undefined}
            className="font-semibold text-leaf-700 hover:text-leaf-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recoveringPassword
              ? "Enviando recuperação..."
              : "Esqueci minha senha"}
          </button>
          {!email && (
            <p id={RECOVERY_HINT_ID} className="-mt-2 text-xs text-slate-500">
              {RECOVERY_MESSAGES.missingEmail}
            </p>
          )}
          <p>
            Ainda não tem conta?{" "}
            <Link
              href="/register"
              className="font-semibold text-leaf-700 hover:text-leaf-800"
            >
              Criar conta
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
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-14 text-sm text-slate-600">
          Carregando login...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
