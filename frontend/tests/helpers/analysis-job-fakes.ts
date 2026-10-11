/**
 * Store de jobs em memória (reproduz o índice único "um job ativo por caso" e
 * a troca atômica de status) e cliente de background falso para testar o
 * processamento durável da análise sem rede.
 */

import type { AnalysisJob, AnalysisJobPatch, AnalysisJobStatus, AnalysisJobStore, NewAnalysisJob } from "../../lib/server/analysis-jobs";
import type { BackgroundClient } from "../../lib/server/case-analysis-service";
import type { BackgroundResponseState } from "../../src/lib/ai/providers/openai";

export class FakeClock {
  constructor(public value = Date.parse("2026-10-10T20:00:00.000Z")) {}
  now = () => this.value;
  advance(ms: number) {
    this.value += ms;
  }
}

export class MemoryJobStore implements AnalysisJobStore {
  jobs: AnalysisJob[] = [];
  private seq = 0;
  constructor(private clock: FakeClock) {}

  private iso() {
    return new Date(this.clock.now()).toISOString();
  }

  async latestForCase(caseId: string) {
    await Promise.resolve();
    const rows = this.jobs.filter((job) => job.case_id === caseId);
    return rows.length ? structuredClone(rows[rows.length - 1]) : null;
  }

  async insert(input: NewAnalysisJob) {
    await Promise.resolve();
    if (this.jobs.some((job) => job.case_id === input.case_id && (job.status === "processing" || job.status === "saving"))) {
      return "conflict" as const;
    }
    const now = this.iso();
    const job: AnalysisJob = {
      id: `job-${++this.seq}`,
      ...input,
      status: "processing",
      provider: null,
      model: null,
      provider_response_id: null,
      error_code: null,
      image_summary: null,
      context: null,
      save_attempts: 0,
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    this.jobs.push(job);
    return structuredClone(job);
  }

  async transition(id: string, from: AnalysisJobStatus[], patch: AnalysisJobPatch) {
    await Promise.resolve();
    const job = this.jobs.find((item) => item.id === id);
    if (!job || !from.includes(job.status)) return null;
    Object.assign(job, structuredClone(patch), { updated_at: this.iso() });
    return structuredClone(job);
  }
}

type Script = { status: BackgroundResponseState["status"]; content?: string; reason?: string };

export class FakeBackground implements BackgroundClient {
  started: Array<{ messages: unknown[]; model: string; maxOutputTokens: number }> = [];
  gets = 0;
  cancelled: string[] = [];
  responses = new Map<string, Script>();
  startError: (Error & { transient?: boolean; status?: number }) | null = null;
  startErrorsLeft = 0;
  getError: Error | null = null;
  private seq = 0;

  async start(messages: unknown[], options: { model: string; maxOutputTokens: number }) {
    await Promise.resolve();
    if (this.startError && this.startErrorsLeft !== 0) {
      this.startErrorsLeft -= 1;
      throw this.startError;
    }
    this.started.push({ messages, ...options });
    const id = `resp_${++this.seq}`;
    this.responses.set(id, { status: "queued" });
    return { id, status: "queued" as const, model: options.model };
  }

  async get(id: string) {
    await Promise.resolve();
    this.gets += 1;
    if (this.getError) throw this.getError;
    const script = this.responses.get(id) ?? { status: "failed" as const };
    return { id, model: "gpt-5-mini", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, ...script };
  }

  async cancel(id: string) {
    this.cancelled.push(id);
    const script = this.responses.get(id);
    if (script) script.status = "cancelled";
    return null;
  }

  finish(id: string, content: string) {
    this.responses.set(id, { status: "completed", content });
  }
}
