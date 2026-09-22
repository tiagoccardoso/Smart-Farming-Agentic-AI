import { NextResponse } from "next/server";
import { getSupabaseConfig, supabaseRequest } from "../../../lib/agronomic/case";
import type { PlanPagePlan, PlanPageService, PlanPageSettings } from "../../../lib/plans-page";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getSupabaseConfig();
    const [settings, plans, services] = await Promise.all([
      supabaseRequest<PlanPageSettings[]>(
        "/rest/v1/plan_page_settings?id=eq.true&select=*&limit=1",
        { method: "GET" },
        config.anonKey,
        config,
      ),
      supabaseRequest<PlanPagePlan[]>(
        "/rest/v1/plans?active=eq.true&select=id,name,slug,eyebrow,audience,description,price_cents,billing_type,price_prefix,price_period,price_note,features,exclusions,button_label,highlighted,badge,active,display_order,updated_at&order=display_order.asc,created_at.asc",
        { method: "GET" },
        config.anonKey,
        config,
      ),
      supabaseRequest<PlanPageService[]>(
        "/rest/v1/plan_page_services?active=eq.true&select=service_type,name,price_cents,price_prefix,price_period,description,button_label,active,display_order,updated_at&order=display_order.asc,created_at.asc",
        { method: "GET" },
        config.anonKey,
        config,
      ),
    ]);

    if (!settings[0]) {
      return NextResponse.json({ error: "A configuração da página de Planos ainda não foi criada." }, { status: 503 });
    }

    return NextResponse.json(
      { settings: settings[0], plans, services },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar os planos." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
