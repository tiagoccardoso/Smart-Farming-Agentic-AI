import { getSupabaseConfig, supabaseRequest } from "./agronomic/case";

export type SitePage = {
  id?: string;
  slug: string;
  title: string | null;
  subtitle: string | null;
  content: Record<string, any> | null;
  image_url: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const especialistaFallback: SitePage = {
  slug: "especialista",
  title: "Jessica Cardoso",
  subtitle: "Engenheira Agrônoma e Doutora em Produção Vegetal/Agronomia",
  image_url: "",
  content: {
    professionalTitle: "Especialista em agricultura orgânica, olericultura e fitossanidade de hortaliças",
    summary: "Engenheira Agrônoma e Doutora em Produção Vegetal, com experiência em agricultura orgânica, olericultura, manejo da cultura do tomateiro, agroecologia, fitossanidade de hortaliças, manejo integrado de pragas e doenças, experimentos de campo, docência e suporte técnico a produtores.",
    education: ["Engenharia Agronômica / Agronomia — UTFPR (Pato Branco, PR)", "Mestrado em Agronomia / Produção Vegetal — UTFPR (Pato Branco, PR)", "Doutorado em Agronomia / Produção Vegetal — UTFPR (Pato Branco, PR)"],
    experiences: ["Pesquisa de doutorado com melhoramento genético de tomate e estudos com porta-enxertos alternativos para controle de Meloidogyne javanica.", "Desenvolvimento e execução de experimentos de campo com tomateiro, produtividade, qualidade e adaptação a sistemas orgânicos.", "Vivência em produção sustentável e inovação agrícola em estágio curricular na Embrapa Agrobiologia.", "Experiência com substratos orgânicos, iniciativas agroecológicas e implantação/acompanhamento de hortas orgânicas em escolas e comunidades."],
    competencies: ["Agricultura orgânica e agroecologia", "Olericultura e produção de hortaliças", "Manejo da cultura do tomateiro", "Fitossanidade de hortaliças", "Manejo integrado de pragas e doenças", "Produção de mudas e tratos culturais", "Manejo de solo e sistemas sustentáveis", "Avaliação agronômica e relatórios técnicos"],
    platformText: "Na Plantasã, a especialista revisa casos enviados por produtores, valida diagnósticos e recomendações, apoia decisões de manejo e orienta produtores interessados em produção orgânica.",
    ctaFinal: "Envie seu caso ou fale pelo formulário oficial para receber orientação adequada ao seu contexto produtivo.",
  },
};

export const agriculturaOrganicaFallback: SitePage = {
  slug: "agricultura-organica",
  title: "Converta sua propriedade para agricultura orgânica com orientação especializada",
  subtitle: "Planejamento técnico, diagnóstico da propriedade e acompanhamento para produtores que desejam iniciar ou aprimorar a produção orgânica.",
  image_url: "/images/organic-consulting-premium.svg",
  content: {
    intro: "A agricultura orgânica é uma oportunidade para produtores que buscam agregar valor à produção, acessar novos mercados, melhorar a saúde do solo e construir sistemas produtivos mais sustentáveis. A transição exige planejamento, conhecimento técnico e acompanhamento para reduzir riscos.",
    benefits: ["Maior valor agregado e diferenciação de mercado", "Produção mais sustentável e melhoria da fertilidade do solo", "Redução gradual da dependência de insumos externos", "Conexão com consumidores que buscam alimentos saudáveis", "Mais canais de comercialização: feiras, cestas, mercados locais e programas institucionais"],
    challenges: ["Diagnóstico completo da propriedade", "Planejamento da transição com metas e cronograma", "Ajustes no manejo do solo e nutrição", "Controle alternativo de pragas e doenças", "Escolha adequada de culturas e cultivares", "Registros e documentação do processo", "Viabilidade econômica e acompanhamento técnico"],
    steps: ["Diagnóstico da propriedade", "Levantamento de culturas, solo, histórico de manejo e principais problemas", "Definição dos objetivos do produtor", "Planejamento da transição", "Ajustes no manejo do solo e da adubação", "Implantação de práticas agroecológicas", "Monitoramento de pragas, doenças e produtividade", "Organização de registros", "Acompanhamento técnico e melhoria contínua"],
    services: ["Diagnóstico técnico da propriedade", "Visita técnica e acompanhamento especializado", "Agricultura orgânica para hortaliças", "Manejo de pragas e doenças", "Produção de mudas", "Controle alternativo e caldas", "Planejamento de cultivos", "Apoio para organização de informações técnicas"],
    ctaText: "Falar pelo contato",
  },
};

export const sitePageFallbacks: Record<string, SitePage> = {
  home: {
    slug: "home",
    title: "Consultoria agrícola inteligente para produção orgânica e decisões no campo",
    subtitle:
      "Una inteligência artificial, conhecimento agronômico e revisão humana especializada para diagnosticar problemas, planejar manejos e apoiar a conversão da sua propriedade para agricultura orgânica.",
    image_url: "",
    content: {
      heroText:
        "A Plantasã ajuda produtores a organizarem informações da lavoura, enviarem fotos, receberem uma triagem inicial por IA e, quando necessário, contarem com revisão técnica humana conduzida por especialista em produção vegetal, olericultura e agricultura orgânica.",
      primaryButtonText: "Conhecer consultoria orgânica",
      primaryButtonUrl: "/agricultura-organica",
      secondaryButtonText: "Iniciar consultoria com IA",
      secondaryButtonUrl: "/consultoria-ia",
      organicSectionTitle:
        "Pensando em converter sua propriedade para produção orgânica?",
      organicSectionText:
        "A conversão para a agricultura orgânica pode abrir novas oportunidades de mercado, valorizar a produção e melhorar a sustentabilidade da propriedade. Mas esse processo exige diagnóstico, planejamento e acompanhamento técnico.",
      cards: [],
    },
  },
  especialista: especialistaFallback,
  "agricultura-organica": agriculturaOrganicaFallback,
};

export async function getSitePage(slug: string): Promise<SitePage> {
  const fallback = sitePageFallbacks[slug];
  try {
    const config = getSupabaseConfig();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = serviceRoleKey || config.anonKey;
    const rows = await supabaseRequest<SitePage[]>(`/rest/v1/site_pages?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`, { method: "GET" }, token, serviceRoleKey ? { ...config, anonKey: serviceRoleKey } : config);
    return rows[0] ?? fallback;
  } catch {
    return fallback;
  }
}
