export type AcompanhamentoModule = {
  slug: string;
  title: string;
  description: string;
  icon: string;
  fields: string[];
  highlights?: string[];
};

export const acompanhamentoModules: AcompanhamentoModule[] = [
  { slug: "cadastro-propriedade", title: "Cadastro da propriedade", description: "Cadastre dados estruturais da área com foco em múltiplas propriedades por agrônomo.", icon: "🏡", fields: ["Nome da propriedade", "Proprietário", "Localização/GPS", "Área total", "Talhões/setores", "Tipo de solo", "Altitude", "Histórico da área", "Fotos da propriedade"] },
  { slug: "historico-culturas", title: "Histórico de culturas", description: "Registre rotação, plantio e colheita para manter rastreabilidade por safra.", icon: "🌾", fields: ["Cultura atual", "Culturas anteriores", "Rotação de culturas", "Datas de plantio", "Datas de colheita", "Cultivar/híbrido", "População/planta por hectare"] },
  { slug: "analise-solo", title: "Análise de solo", description: "Central de análises laboratoriais com preparo para recomendações de manejo nutricional.", icon: "🧪", fields: ["pH", "MO", "P", "K", "Ca", "Mg", "Al", "Saturação por bases", "CTC", "Micronutrientes"], highlights: ["Upload de PDFs e laudos laboratoriais", "Comparação de análises por safra", "Alertas de desequilíbrio", "Base pronta para calagem, gessagem e adubação"] },
  { slug: "mapa-area", title: "Mapa da área", description: "Estrutura inicial de mini GIS para talhões, reboleiras, focos e pontos georreferenciados.", icon: "🗺️", fields: ["Desenho de talhões", "Marcação de reboleiras", "Focos de doença", "Coleta de solo", "Pontos GPS"] },
  { slug: "monitoramento-fitossanitario", title: "Monitoramento fitossanitário", description: "Controle técnico de inspeções com base de doenças expansível.", icon: "🔬", fields: ["Doença encontrada", "Nível de severidade", "Fotos", "Data da inspeção", "Clima no período", "Produtos aplicados", "Recomendação técnica"], highlights: ["Biblioteca inicial: antracnose, ferrugem, requeima, greening, mofo-branco", "Estrutura para sintomas, fotos e descrição"] },
  { slug: "aplicacoes-manejo", title: "Aplicações e manejo", description: "Registre pulverizações e operações para histórico operacional consolidado.", icon: "🚜", fields: ["Pulverizações", "Fertilizantes aplicados", "Dose", "Volume de calda", "Equipamento utilizado", "Operador", "Condições climáticas", "Receituário agronômico"] },
  { slug: "controle-climatico", title: "Controle climático", description: "Base para futura integração com APIs climáticas e cálculo de risco por cultura.", icon: "🌦️", fields: ["Chuva acumulada", "Temperatura", "Umidade", "Horas de molhamento foliar", "Risco de doenças"], highlights: ["Compatibilidade prevista para tomate, soja, uva e citrus"] },
  { slug: "financeiro-area", title: "Financeiro da área", description: "Monitore custo, produtividade e margem por talhão e por safra.", icon: "💰", fields: ["Custo por talhão", "Custo por safra", "Produtividade", "Lucro estimado", "Custo de aplicação", "Custo nutricional"] },
  { slug: "relatorios-automaticos", title: "Relatórios automáticos", description: "Estrutura para geração de documentos técnicos com histórico e assinaturas.", icon: "📄", fields: ["Geração de PDF", "Histórico de visitas", "Anexos de fotos", "Assinatura digital", "Recomendações técnicas"] },
  { slug: "inteligencia-artificial", title: "Inteligência artificial", description: "Hub estrutural para recursos avançados de IA com foco em praticidade no campo.", icon: "🤖", fields: ["Reconhecimento de doenças por imagem", "Interpretação de análise de solo", "Sugestões de manejo", "Alertas climáticos", "Detecção de deficiência nutricional"] }
];

export const acompanhamentoRoles = ["admin", "specialist"] as const;
