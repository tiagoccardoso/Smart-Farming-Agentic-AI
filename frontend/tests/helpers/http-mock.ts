/**
 * Mock do `fetch` global para os testes.
 *
 * Permite simular o Supabase (PostgREST) e o Stripe sem rede, registrando todas
 * as chamadas feitas para que os testes verifiquem o que foi gravado.
 */

export type RecordedCall = {
  url: string;
  method: string;
  body: unknown;
};

export type MockResponse = { status?: number; body?: unknown };

export type MockHandler = (call: RecordedCall) => MockResponse | undefined;

export type FetchMock = {
  calls: RecordedCall[];
  restore: () => void;
  callsTo: (fragment: string) => RecordedCall[];
};

const originalFetch = globalThis.fetch;

export function setTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-de-teste";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-de-teste";
  process.env.STRIPE_SECRET_KEY = "sk_test_chave";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_teste";
}

export function installFetchMock(handler: MockHandler): FetchMock {
  const calls: RecordedCall[] = [];

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;

    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const call: RecordedCall = { url, method, body };
    calls.push(call);

    const result = handler(call);

    if (!result) {
      throw new Error(`Chamada nao mapeada no mock: ${method} ${url}`);
    }

    const status = result.status ?? 200;
    const text = result.body === undefined ? "" : JSON.stringify(result.body);

    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => (text ? JSON.parse(text) : null)
    } as unknown as Response;
  }) as typeof fetch;

  return {
    calls,
    callsTo: (fragment: string) => calls.filter((call) => call.url.includes(fragment)),
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}
