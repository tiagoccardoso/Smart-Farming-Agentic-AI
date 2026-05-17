export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  retryOn?: (error: unknown) => boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error(`Tempo limite da IA excedido (${timeoutMs}ms).`)));
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = operation();
      return options.timeoutMs ? await withTimeout(result, options.timeoutMs) : await result;
    } catch (error) {
      lastError = error;
      const shouldRetry = options.retryOn ? options.retryOn(error) : true;
      if (!shouldRetry || attempt === retries) {
        break;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha desconhecida ao executar operação com retry.");
}
