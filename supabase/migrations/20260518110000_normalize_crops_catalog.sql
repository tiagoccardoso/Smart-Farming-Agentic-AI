-- Normalize crops catalog with ML-compatible labels and Portuguese display names.

alter table public.crops
  add column if not exists slug text,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists model_label text,
  add column if not exists display_name_pt text,
  add column if not exists display_name_en text;

update public.crops
set
  display_name_pt = coalesce(display_name_pt, name),
  slug = coalesce(
    slug,
    case lower(name)
      when 'soja' then 'soja'
      when 'milho' then 'milho'
      when 'café' then 'cafe'
      when 'cafe' then 'cafe'
      else lower(regexp_replace(trim(name), '[^[:alnum:]]+', '-', 'g'))
    end
  ),
  aliases = case
    when aliases is null or cardinality(aliases) = 0 then array[name]
    else aliases
  end;

update public.crops
set
  model_label = 'maize',
  display_name_pt = 'Milho',
  display_name_en = 'Maize',
  aliases = array(select distinct unnest(coalesce(aliases, '{}') || array['milho', 'maize', 'corn']))
where lower(name) = 'milho' or slug = 'milho';

update public.crops
set
  model_label = 'coffee',
  display_name_pt = 'Café',
  display_name_en = 'Coffee',
  aliases = array(select distinct unnest(coalesce(aliases, '{}') || array['café', 'cafe', 'coffee']))
where lower(name) in ('café', 'cafe') or slug = 'cafe';

update public.crops
set
  model_label = null,
  display_name_pt = 'Soja',
  display_name_en = 'Soybean',
  aliases = array(select distinct unnest(coalesce(aliases, '{}') || array['soja', 'soy', 'soybean', 'soya']))
where lower(name) = 'soja' or slug = 'soja';

alter table public.crops
  alter column slug set not null,
  alter column display_name_pt set not null,
  add constraint crops_slug_check check (length(trim(slug)) > 0),
  add constraint crops_display_name_pt_check check (length(trim(display_name_pt)) > 0),
  add constraint crops_model_label_check check (model_label is null or model_label = lower(trim(model_label)));

create unique index if not exists crops_slug_unique_idx on public.crops (slug);
create unique index if not exists crops_model_label_unique_idx on public.crops (model_label) where model_label is not null;
create index if not exists crops_aliases_gin_idx on public.crops using gin (aliases);
create index if not exists crops_display_name_pt_idx on public.crops (display_name_pt);

drop function if exists public.normalize_crop_lookup_text(text);
create function public.normalize_crop_lookup_text(value text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(trim(coalesce(value, '')), '[^[:alnum:]]+', ' ', 'g')), '')
$$;

drop function if exists public.validate_crop_normalization();
create function public.validate_crop_normalization()
returns trigger
language plpgsql
as $$
declare
  alias_value text;
  normalized_alias text;
begin
  new.slug := lower(trim(new.slug));
  new.display_name_pt := trim(new.display_name_pt);
  new.display_name_en := nullif(trim(coalesce(new.display_name_en, '')), '');
  new.model_label := nullif(lower(trim(coalesce(new.model_label, ''))), '');
  new.aliases := coalesce(new.aliases, '{}');

  if new.slug = '' then
    raise exception 'slug da cultura é obrigatório';
  end if;

  if new.display_name_pt = '' then
    raise exception 'display_name_pt da cultura é obrigatório';
  end if;

  new.aliases := array(
    select distinct trim(alias_item)
    from unnest(new.aliases) as alias_item
    where trim(alias_item) <> ''
    order by trim(alias_item)
  );

  foreach alias_value in array new.aliases loop
    normalized_alias := public.normalize_crop_lookup_text(alias_value);

    if exists (
      select 1
      from public.crops c
      where c.id <> new.id
        and c.slug <> new.slug
        and (
          public.normalize_crop_lookup_text(c.slug) = normalized_alias
          or public.normalize_crop_lookup_text(c.name) = normalized_alias
          or public.normalize_crop_lookup_text(c.display_name_pt) = normalized_alias
          or public.normalize_crop_lookup_text(c.display_name_en) = normalized_alias
          or public.normalize_crop_lookup_text(c.model_label) = normalized_alias
          or exists (
            select 1
            from unnest(c.aliases) existing_alias
            where public.normalize_crop_lookup_text(existing_alias) = normalized_alias
          )
        )
    ) then
      raise exception 'alias de cultura duplicado: %', alias_value;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_crop_normalization on public.crops;
create trigger validate_crop_normalization
  before insert or update on public.crops
  for each row execute function public.validate_crop_normalization();

with seed(name, slug, aliases, model_label, display_name_pt, display_name_en, scientific_name, recommended_soil, ideal_climate, common_diseases, common_pests, growth_cycle, irrigation_notes, fertilization_notes, recommended_region, known_risks, management_notes, active) as (
  values
    ('Maçã','maca',array['maçã','maca','apple'],'apple','Maçã','Apple','Malus domestica','Solos profundos, bem drenados e ricos em matéria orgânica, com pH corrigido.','Clima temperado a subtropical de altitude, com frio hibernal conforme cultivar.','Sarna, oídio, podridões e manchas foliares.','Mosca-das-frutas, pulgões, ácaros e lagartas.','Perene; produção por ciclo anual após formação do pomar.','Evitar déficit em brotação, floração e enchimento dos frutos; manejar drenagem.','Adubação baseada em análise de solo e foliar, com atenção a potássio, cálcio e boro.','Regiões de altitude ou microclimas com frio suficiente e baixa pressão de doenças.','Geada, granizo, baixa frutificação e doenças favorecidas por alta umidade.','Poda, raleio, monitoramento fitossanitário e manejo de cobertura do solo.',true),
    ('Banana','banana',array['banana'],'banana','Banana','Banana','Musa spp.','Solos profundos, férteis, bem drenados e com boa disponibilidade de água.','Clima quente e úmido, sem frio intenso ou ventos fortes.','Sigatoka, mal-do-panamá, moko e podridões.','Broca-do-rizoma, nematoides, tripes e ácaros.','Aproximadamente 10 a 18 meses até o primeiro cacho, conforme sistema.','Manter umidade regular sem encharcamento; déficit reduz tamanho do cacho.','Exigente em potássio e nitrogênio; parcelar conforme análise e produtividade.','Regiões tropicais e subtropicais quentes com proteção contra ventos.','Ventos, encharcamento, nematoides e doenças vasculares elevam perdas.','Desbaste, escoramento, eliminação de folhas doentes e mudas sadias.',true),
    ('Feijão-preto / Black gram','feijao-preto',array['feijão-preto','feijao preto','blackgram','black gram','urad'],'blackgram','Feijão-preto / Black gram','Black gram','Vigna mungo','Solos bem drenados, de média fertilidade e pH próximo de 6,0.','Clima quente, com umidade moderada e baixa chuva na colheita.','Manchas foliares, antracnose, ferrugem e murchas.','Mosca-branca, pulgões, tripes e lagartas.','Ciclo curto, geralmente 70 a 100 dias.','Evitar estresse hídrico na floração e excesso de água no enchimento.','Inoculação e adubação conforme análise; atenção a fósforo e potássio.','Áreas de clima quente com colheita em período seco.','Excesso de umidade favorece doenças e prejudica colheita.','Usar sementes sadias, rotação de culturas e monitoramento de pragas.',true),
    ('Grão-de-bico','grao-de-bico',array['grão-de-bico','grao-de-bico','grao de bico','grão de bico','chickpea'],'chickpea','Grão-de-bico','Chickpea','Cicer arietinum','Solos bem drenados, pH levemente ácido a neutro e baixa compactação.','Clima ameno a quente e seco, com baixa umidade na maturação.','Ascochyta, fusariose, podridões e manchas.','Lagartas, pulgões e minadores.','Aproximadamente 90 a 130 dias.','Sensível a encharcamento; irrigar de forma criteriosa em florescimento.','Adubação conforme análise e inoculação quando recomendada.','Regiões com estação seca definida e temperaturas moderadas.','Alta umidade, solos encharcados e calor extremo no florescimento.','Rotação, sementes tratadas/sadias e manejo preventivo de doenças.',true),
    ('Coco','coco',array['coco','coconut'],'coconut','Coco','Coconut','Cocos nucifera','Solos profundos, arenosos a areno-argilosos, bem drenados e com matéria orgânica.','Clima tropical quente, úmido e sem frio intenso.','Lixa, queima-das-folhas, podridões e anel-vermelho.','Ácaros, brocas, cochonilhas e besouros.','Perene; produção inicia em anos após plantio conforme variedade.','Necessita água regular; irrigação é importante em déficit hídrico.','Adubação parcelada com atenção a potássio, cloro, magnésio e boro.','Litoral e regiões tropicais quentes com boa disponibilidade hídrica.','Seca prolongada, salinidade excessiva e pragas de difícil controle.','Cobertura do solo, adubação equilibrada e monitoramento de pragas.',true),
    ('Café','cafe',array['café','cafe','coffee'],'coffee','Café','Coffee','Coffea arabica / Coffea canephora','Solos profundos, bem drenados, estruturados e com fertilidade corrigida.','Clima ameno para arábica; robusta/conilon tolera maior temperatura, evitando extremos.','Ferrugem, cercosporiose, phoma, mancha aureolada.','Bicho-mineiro, broca-do-café, cochonilhas, ácaros.','Cultura perene; produção varia por ciclo fenológico anual.','Irrigação pode estabilizar produção em regiões com déficit hídrico.','Adubação parcelada conforme análise de solo/foliar e expectativa de safra.','Regiões com altitude, temperatura e regime hídrico compatíveis com a espécie/cultivar.','Geada, déficit hídrico, bienalidade e pressão de ferrugem podem elevar risco.','Poda, nutrição equilibrada, monitoramento fitossanitário e conservação do solo.',true),
    ('Algodão','algodao',array['algodão','algodao','cotton'],'cotton','Algodão','Cotton','Gossypium hirsutum','Solos profundos, bem drenados, férteis e sem compactação.','Clima quente, alta luminosidade e baixa umidade na colheita.','Ramulária, mancha angular, murchas e podridões.','Bicudo, lagartas, pulgões, mosca-branca e ácaros.','Aproximadamente 140 a 180 dias.','Exige água no florescimento e enchimento de maçãs; evitar excesso no fim do ciclo.','Exigente em potássio, nitrogênio e boro; corrigir conforme análise.','Cerrado e regiões quentes com janela seca para colheita.','Bicudo, chuva na colheita, plantas daninhas e estresse hídrico.','MIP rigoroso, destruição de soqueiras, rotação e monitoramento.',true),
    ('Uva','uva',array['uva','uvas','grape','grapes'],'grapes','Uva','Grapes','Vitis spp.','Solos bem drenados, profundos e com vigor controlado.','Clima seco na maturação; varia de temperado a tropical conforme manejo.','Míldio, oídio, antracnose e podridões de cacho.','Traças, ácaros, cochonilhas e tripes.','Perene; ciclos de produção variam com poda e região.','Irrigação controlada para equilibrar vigor, produção e qualidade.','Adubação conforme análise de solo/foliar; atenção a potássio, cálcio e magnésio.','Regiões de clima seco ou com manejo protegido contra chuvas.','Chuva na maturação, rachaduras, podridões e desequilíbrio vegetativo.','Poda, condução, controle de dossel e monitoramento fitossanitário.',true),
    ('Juta','juta',array['juta','jute'],'jute','Juta','Jute','Corchorus spp.','Solos aluviais, férteis, úmidos e bem preparados.','Clima quente e úmido, com alta disponibilidade de água.','Podridões, manchas foliares e murchas.','Lagartas, besouros e sugadores.','Aproximadamente 100 a 150 dias para fibra.','Demanda boa umidade; evitar seca prolongada no crescimento vegetativo.','Adubação conforme análise, com atenção a nitrogênio e potássio.','Regiões tropicais úmidas e áreas de várzea manejadas.','Encharcamento excessivo, seca e baixa qualidade da fibra.','Manejo de densidade, controle de plantas daninhas e colheita no ponto adequado.',true),
    ('Feijão-vermelho / Kidney bean','feijao-vermelho',array['feijão-vermelho','feijao vermelho','kidneybeans','kidney bean','kidney beans'],'kidneybeans','Feijão-vermelho / Kidney bean','Kidney bean','Phaseolus vulgaris','Solos bem drenados, férteis e pH entre 5,8 e 7,0.','Clima ameno a quente, evitando calor extremo no florescimento.','Antracnose, mancha angular, ferrugem e murchas.','Mosca-branca, vaquinhas, pulgões e lagartas.','Aproximadamente 80 a 110 dias.','Água regular em florescimento e enchimento, sem encharcamento.','Adubação conforme análise; inoculação e nitrogênio conforme sistema.','Regiões com temperatura moderada e baixa chuva na colheita.','Doenças em alta umidade e abortamento floral por calor.','Sementes sadias, rotação, MIP e manejo de irrigação.',true),
    ('Lentilha','lentilha',array['lentilha','lentil'],'lentil','Lentilha','Lentil','Lens culinaris','Solos bem drenados, textura média e pH próximo de neutro.','Clima ameno, seco na maturação e sem encharcamento.','Ferrugem, antracnose, mofo cinzento e podridões.','Pulgões, lagartas e tripes.','Aproximadamente 90 a 120 dias.','Baixa tolerância a encharcamento; irrigar apenas quando necessário.','Adubação moderada e inoculação quando indicada.','Regiões de clima ameno e estação seca na colheita.','Umidade excessiva e solos compactados elevam risco de doenças.','Rotação, sementes sadias e controle preventivo de plantas daninhas.',true),
    ('Milho','milho',array['milho','maize','corn'],'maize','Milho','Maize','Zea mays','Solos profundos, férteis, bem drenados e com bom teor de matéria orgânica.','Clima quente, alta luminosidade e disponibilidade de água em pendoamento e enchimento.','Mancha branca, cercosporiose, ferrugens, enfezamentos.','Cigarrinha, lagarta-do-cartucho, percevejos, pulgões.','Aproximadamente 90 a 160 dias, conforme híbrido e época.','Fases de florescimento e enchimento são críticas para água.','Exigente em nitrogênio; planejar adubação conforme produtividade esperada e análise.','Regiões com boa radiação, temperatura favorável e janela que reduza estresse hídrico.','Estresse hídrico e cigarrinha podem causar perdas expressivas.','Manejo de palhada, plantio na janela, monitoramento de cigarrinha e rotação de princípios de manejo.',true),
    ('Manga','manga',array['manga','mango'],'mango','Manga','Mango','Mangifera indica','Solos profundos, bem drenados e com fertilidade equilibrada.','Clima quente, seco na floração e baixa chuva na maturação.','Antracnose, oídio, seca-de-ponteiros e podridões.','Mosca-das-frutas, cochonilhas, ácaros e tripes.','Perene; produção por fluxos e safra anual/induzida.','Irrigação ajuda indução e pegamento, evitando excesso na floração.','Adubação conforme análise, com atenção a potássio, cálcio e boro.','Regiões tropicais/subtropicais com estação seca ou manejo de indução floral.','Chuva na floração, mosca-das-frutas e alternância de produção.','Poda, indução floral responsável, ensacamento/monitoramento e colheita correta.',true),
    ('Feijão-moth / Moth bean','feijao-moth',array['feijão-moth','feijao moth','mothbeans','moth bean','moth beans'],'mothbeans','Feijão-moth / Moth bean','Moth bean','Vigna aconitifolia','Solos leves, bem drenados e tolerantes a baixa fertilidade relativa.','Clima quente e seco; cultura tolerante à seca.','Manchas foliares, murchas e podridões em excesso de umidade.','Pulgões, tripes e lagartas.','Aproximadamente 70 a 100 dias.','Baixa exigência hídrica; evitar encharcamento.','Adubação conforme análise, usualmente moderada.','Regiões semiáridas ou quentes com chuvas limitadas.','Excesso de chuva e solos pesados reduzem desempenho.','Plantio em janela adequada, rotação e controle inicial de plantas daninhas.',true),
    ('Feijão-mungo','feijao-mungo',array['feijão-mungo','feijao mungo','mungbean','mung bean'],'mungbean','Feijão-mungo','Mung bean','Vigna radiata','Solos bem drenados, pH levemente ácido a neutro e boa estrutura.','Clima quente, com baixa chuva na colheita.','Oídio, cercosporiose, murchas e viroses.','Mosca-branca, pulgões, tripes e lagartas.','Ciclo curto, aproximadamente 60 a 90 dias.','Evitar déficit na floração; excesso de água favorece doenças.','Inoculação e adubação conforme análise, com atenção a fósforo.','Regiões quentes com janela de colheita seca.','Viroses transmitidas por insetos e chuva na colheita.','Sementes sadias, MIP e colheita no ponto para evitar perdas.',true),
    ('Melão','melao',array['melão','melao','muskmelon','melon'],'muskmelon','Melão','Muskmelon','Cucumis melo','Solos leves a médios, bem drenados e férteis.','Clima quente, seco, alta luminosidade e baixa umidade na frutificação.','Oídio, míldio, fusariose e viroses.','Mosca-branca, pulgões, tripes e minadores.','Aproximadamente 60 a 90 dias.','Irrigação frequente e controlada; evitar molhamento foliar e excesso no amadurecimento.','Exigente em potássio e cálcio; fertirrigação conforme análise.','Regiões quentes e secas, especialmente semiárido irrigado.','Viroses, salinidade, rachaduras e podridões de fruto.','Manejo de irrigação, polinização, MIP e colheita por maturação.',true),
    ('Laranja','laranja',array['laranja','orange'],'orange','Laranja','Orange','Citrus sinensis','Solos profundos, bem drenados, com pH corrigido e boa aeração.','Clima subtropical a tropical, evitando geadas fortes.','Greening/HLB, cancro cítrico, pinta preta e gomose.','Psilídeo, ácaros, cochonilhas e moscas-das-frutas.','Perene; produção por safra anual.','Irrigação reduz estresse e queda de frutos em períodos secos.','Adubação parcelada conforme análise, com atenção a N, K, Ca, Mg e micronutrientes.','Regiões citrícolas com boa sanidade e clima adequado.','HLB, seca, geada e pragas vetoras podem comprometer pomar.','Monitoramento de psilídeo, mudas certificadas, poda sanitária e nutrição equilibrada.',true),
    ('Mamão','mamao',array['mamão','mamao','papaya'],'papaya','Mamão','Papaya','Carica papaya','Solos profundos, bem drenados, férteis e sem encharcamento.','Clima tropical quente, com boa umidade e sem frio.','Viroses, antracnose, podridões e oídio.','Ácaros, mosca-branca, pulgões e cochonilhas.','Aproximadamente 8 a 12 meses para início de colheita.','Água regular é essencial; evitar encharcamento e déficit prolongado.','Adubação parcelada, exigente em nitrogênio, potássio, cálcio e boro.','Regiões tropicais quentes com boa drenagem e baixa incidência de viroses.','Viroses, ventos, encharcamento e queda de flores/frutos.','Renovação sanitária, controle de vetores, tutoramento e manejo nutricional.',true),
    ('Feijão-guandu','feijao-guandu',array['feijão-guandu','feijao guandu','guandu','pigeonpeas','pigeon peas'],'pigeonpeas','Feijão-guandu','Pigeon peas','Cajanus cajan','Solos bem drenados, tolerando fertilidade média e alguma acidez.','Clima tropical/subtropical, com boa tolerância à seca.','Ferrugem, cercosporiose, murchas e podridões.','Lagartas, percevejos, brocas e pulgões.','Aproximadamente 120 a 180 dias ou uso perene/semiperene.','Tolerante à seca após estabelecimento; irrigação ajuda no início.','Baixa a moderada exigência; inoculação e fósforo favorecem estabelecimento.','Regiões tropicais, integração lavoura-pecuária e adubação verde.','Geada, excesso de água e ataque de lagartas em flores/vagens.','Usar em rotação, cobertura, quebra-vento ou produção de grãos conforme objetivo.',true),
    ('Romã','roma',array['romã','roma','pomegranate'],'pomegranate','Romã','Pomegranate','Punica granatum','Solos bem drenados, até moderadamente calcários, com fertilidade equilibrada.','Clima quente e seco, tolerante a déficit moderado.','Manchas foliares, podridões de fruto e antracnose.','Pulgões, cochonilhas, mosca-das-frutas e brocas.','Perene; produção por safra anual.','Irrigação regular melhora calibre; excesso favorece rachaduras e doenças.','Adubação conforme análise; atenção a potássio e cálcio.','Regiões semiáridas e subtropicais secas com baixa chuva na maturação.','Rachadura de frutos, salinidade e podridões em umidade alta.','Poda, raleio, manejo de irrigação e colheita no ponto.',true),
    ('Arroz','arroz',array['arroz','rice'],'rice','Arroz','Rice','Oryza sativa','Solos de várzea ou bem nivelados para irrigado; solos corrigidos para sequeiro.','Clima quente e alta disponibilidade hídrica durante o ciclo.','Brusone, mancha-parda, queima-da-bainha e doenças de panícula.','Percevejos, lagartas, bicheira-da-raiz e plantas daninhas aquáticas.','Aproximadamente 100 a 150 dias.','Manter lâmina ou umidade adequada conforme sistema; evitar estresse na floração.','Adubação conforme análise, com atenção a nitrogênio, fósforo, potássio e zinco.','Várzeas irrigadas e regiões com disponibilidade hídrica e temperatura favorável.','Déficit hídrico, brusone e manejo inadequado de plantas daninhas.','Escolha de cultivar, semeadura na época, manejo da água e rotação.',true),
    ('Melancia','melancia',array['melancia','watermelon'],'watermelon','Melancia','Watermelon','Citrullus lanatus','Solos leves a médios, férteis, profundos e bem drenados.','Clima quente, seco e ensolarado.','Oídio, míldio, fusariose, antracnose e viroses.','Mosca-branca, pulgões, tripes, ácaros e brocas.','Aproximadamente 75 a 110 dias.','Irrigação regular até enchimento; reduzir excesso próximo à colheita.','Exigente em potássio e cálcio; fertirrigação conforme análise.','Regiões quentes com boa disponibilidade de água e baixa chuva na colheita.','Viroses, rachadura, salinidade e podridões de fruto.','MIP, polinização, rotação com não cucurbitáceas e colheita por maturação.',true),
    ('Soja','soja',array['soja','soy','soybean','soya'],null,'Soja','Soybean','Glycine max','Solos bem drenados, pH corrigido e boa fertilidade.','Clima quente e úmido, com boa disponibilidade hídrica no florescimento e enchimento de grãos.','Ferrugem asiática, oídio, mancha-alvo, antracnose.','Lagartas, percevejos, mosca-branca, ácaros.','Aproximadamente 100 a 140 dias, conforme cultivar e ambiente.','Evitar déficit hídrico em florescimento e enchimento; monitorar encharcamento.','Calagem e adubação conforme análise de solo; atenção a fósforo, potássio e inoculação.','Regiões brasileiras com janela de plantio adequada, boa drenagem e histórico sanitário monitorado.','Alta umidade favorece doenças foliares; monocultivo aumenta pressão de pragas e patógenos.','Monitoramento frequente, rotação de culturas, cultivares adaptadas e manejo integrado de pragas e doenças.',true)
)
insert into public.crops (name, slug, aliases, model_label, display_name_pt, display_name_en, scientific_name, recommended_soil, ideal_climate, common_diseases, common_pests, growth_cycle, irrigation_notes, fertilization_notes, recommended_region, known_risks, management_notes, active)
select * from seed
on conflict (slug) do update set
  name = excluded.name,
  aliases = excluded.aliases,
  model_label = excluded.model_label,
  display_name_pt = excluded.display_name_pt,
  display_name_en = excluded.display_name_en,
  scientific_name = excluded.scientific_name,
  recommended_soil = excluded.recommended_soil,
  ideal_climate = excluded.ideal_climate,
  common_diseases = excluded.common_diseases,
  common_pests = excluded.common_pests,
  growth_cycle = excluded.growth_cycle,
  irrigation_notes = excluded.irrigation_notes,
  fertilization_notes = excluded.fertilization_notes,
  recommended_region = excluded.recommended_region,
  known_risks = excluded.known_risks,
  management_notes = excluded.management_notes,
  active = excluded.active;
