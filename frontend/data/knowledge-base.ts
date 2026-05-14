export type KnowledgeItem = {
  id: string;
  title: string;
  content: string;
  keywords: string[];
};

export const knowledgeBase: KnowledgeItem[] = [
  {
    id: "tomate-irrigacao",
    title: "Irrigação de tomate",
    content: "Tomateiros geralmente precisam de umidade constante, sem encharcar. Em clima quente, irrigue a cada 2 a 3 dias e ajuste conforme textura do solo, chuva e fase da planta.",
    keywords: ["tomate", "tomateiro", "água", "agua", "irrigação", "irrigacao", "regar"]
  },
  {
    id: "arroz-plantio",
    title: "Plantio de arroz",
    content: "O arroz se desenvolve melhor em períodos quentes e úmidos, com boa disponibilidade de água. Antes do plantio, confirme a cultivar indicada para sua região e prepare o solo para manter lâmina ou umidade adequada.",
    keywords: ["arroz", "plantio", "plantar", "época", "epoca", "água", "agua"]
  },
  {
    id: "solo-ph",
    title: "Correção de pH do solo",
    content: "A maioria das culturas produz melhor com pH entre 5,5 e 7,0. Faça análise de solo antes de aplicar calcário ou corretivos, pois a dose depende da acidez, textura e cultura desejada.",
    keywords: ["ph", "solo", "calcário", "calcario", "acidez", "correção", "correcao"]
  },
  {
    id: "npk-adubacao",
    title: "Adubação NPK",
    content: "Nitrogênio favorece crescimento vegetativo, fósforo ajuda raízes e estabelecimento inicial, e potássio melhora vigor, enchimento e resistência. A recomendação correta deve partir de análise de solo.",
    keywords: ["npk", "nitrogênio", "nitrogenio", "fósforo", "fosforo", "potássio", "potassio", "adubo", "fertilizante"]
  },
  {
    id: "doencas-folhas",
    title: "Sinais de doenças em folhas",
    content: "Manchas, amarelecimento, mofo, necrose e murcha podem indicar doenças, pragas ou estresse hídrico. Use fotos nítidas, observe os dois lados da folha e procure orientação técnica para confirmação.",
    keywords: ["doença", "doenca", "folha", "mancha", "mofo", "murcha", "praga", "amarelamento"]
  },
  {
    id: "milho-manejo",
    title: "Manejo básico do milho",
    content: "O milho responde bem a boa disponibilidade de nitrogênio, população adequada de plantas e controle inicial de plantas daninhas. Evite déficit hídrico em florescimento e enchimento de grãos.",
    keywords: ["milho", "nitrogênio", "nitrogenio", "plantas daninhas", "irrigação", "graos", "grãos"]
  },
  {
    id: "feijao-manejo",
    title: "Manejo básico do feijão",
    content: "O feijão prefere solo bem drenado, pH próximo de 6 e irrigação regular. Excesso de água aumenta risco de doenças radiculares, então monitore drenagem e espaçamento.",
    keywords: ["feijão", "feijao", "solo", "drenagem", "irrigação", "ph"]
  },
  {
    id: "algodao-clima",
    title: "Condições para algodão",
    content: "O algodão se adapta melhor a clima quente, boa luminosidade e menor excesso de umidade. Chuvas intensas em fases finais podem prejudicar qualidade da fibra.",
    keywords: ["algodão", "algodao", "clima", "fibra", "chuva", "umidade"]
  }
];
