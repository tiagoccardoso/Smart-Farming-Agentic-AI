-- CMS simples para páginas públicas editáveis pela especialista/admin.
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text,
  subtitle text,
  content jsonb not null default '{}'::jsonb,
  image_url text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_pages enable row level security;

drop policy if exists "public_can_read_site_pages" on public.site_pages;
drop policy if exists "specialists_admins_can_manage_site_pages" on public.site_pages;

create policy "public_can_read_site_pages"
on public.site_pages
for select
to anon, authenticated
using (true);

create policy "specialists_admins_can_manage_site_pages"
on public.site_pages
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
);

insert into public.site_pages (slug, title, subtitle, image_url, content)
values
  (
    'especialista',
    'Jessica Cardoso',
    'Engenheira Agrônoma e Doutora em Produção Vegetal/Agronomia',
    null,
    jsonb_build_object(
      'professionalTitle', 'Especialista em agricultura orgânica, olericultura e fitossanidade de hortaliças',
      'summary', 'Engenheira Agrônoma e Doutora em Produção Vegetal, com experiência em agricultura orgânica, olericultura, manejo da cultura do tomateiro, agroecologia, fitossanidade de hortaliças, manejo integrado de pragas e doenças, experimentos de campo, docência e suporte técnico a produtores.',
      'education', jsonb_build_array('Engenharia Agronômica / Agronomia — UTFPR (Pato Branco, PR)', 'Mestrado em Agronomia / Produção Vegetal — UTFPR (Pato Branco, PR)', 'Doutorado em Agronomia / Produção Vegetal — UTFPR (Pato Branco, PR)'),
      'experiences', jsonb_build_array('Pesquisa de doutorado com melhoramento genético de tomate e estudos com porta-enxertos alternativos para controle de Meloidogyne javanica.', 'Desenvolvimento e execução de experimentos de campo com tomateiro, produtividade, qualidade e adaptação a sistemas orgânicos.', 'Vivência em produção sustentável e inovação agrícola em estágio curricular na Embrapa Agrobiologia.', 'Experiência com substratos orgânicos, iniciativas agroecológicas e implantação/acompanhamento de hortas orgânicas em escolas e comunidades.'),
      'competencies', jsonb_build_array('Agricultura orgânica e agroecologia', 'Olericultura e produção de hortaliças', 'Manejo da cultura do tomateiro', 'Fitossanidade de hortaliças', 'Manejo integrado de pragas e doenças', 'Produção de mudas e tratos culturais', 'Manejo de solo e sistemas sustentáveis', 'Avaliação agronômica e relatórios técnicos'),
      'platformText', 'Na Plantasã, a especialista revisa casos enviados por produtores, valida diagnósticos e recomendações, apoia decisões de manejo e orienta produtores interessados em produção orgânica.',
      'ctaFinal', 'Envie seu caso ou fale pelo formulário oficial para receber orientação adequada ao seu contexto produtivo.'
    )
  ),
  (
    'agricultura-organica',
    'Converta sua propriedade para agricultura orgânica com orientação especializada',
    'Planejamento técnico, diagnóstico da propriedade e acompanhamento para produtores que desejam iniciar ou aprimorar a produção orgânica.',
    '/images/organic-consulting-premium.svg',
    jsonb_build_object(
      'intro', 'A agricultura orgânica é uma oportunidade para produtores que buscam agregar valor à produção, acessar novos mercados, melhorar a saúde do solo e construir sistemas produtivos mais sustentáveis. A transição exige planejamento, conhecimento técnico e acompanhamento para reduzir riscos.',
      'benefits', jsonb_build_array('Maior valor agregado e diferenciação de mercado', 'Produção mais sustentável e melhoria da fertilidade do solo', 'Redução gradual da dependência de insumos externos', 'Conexão com consumidores que buscam alimentos saudáveis', 'Mais canais de comercialização: feiras, cestas, mercados locais e programas institucionais'),
      'challenges', jsonb_build_array('Diagnóstico completo da propriedade', 'Planejamento da transição com metas e cronograma', 'Ajustes no manejo do solo e nutrição', 'Controle alternativo de pragas e doenças', 'Escolha adequada de culturas e cultivares', 'Registros e documentação do processo', 'Viabilidade econômica e acompanhamento técnico'),
      'steps', jsonb_build_array('Diagnóstico da propriedade', 'Levantamento de culturas, solo, histórico de manejo e principais problemas', 'Definição dos objetivos do produtor', 'Planejamento da transição', 'Ajustes no manejo do solo e da adubação', 'Implantação de práticas agroecológicas', 'Monitoramento de pragas, doenças e produtividade', 'Organização de registros', 'Acompanhamento técnico e melhoria contínua'),
      'services', jsonb_build_array('Diagnóstico técnico da propriedade', 'Visita técnica e acompanhamento especializado', 'Agricultura orgânica para hortaliças', 'Manejo de pragas e doenças', 'Produção de mudas', 'Controle alternativo e caldas', 'Planejamento de cultivos', 'Apoio para organização de informações técnicas'),
      'ctaText', 'Falar pelo contato'
    )
  )
on conflict (slug) do nothing;

-- Formulário público: permitir solicitações gerais sem dados de visita e bloquear duplicidade por chave de submissão.
alter table public.specialist_visit_requests
  alter column phone drop not null,
  alter column city drop not null,
  alter column state drop not null;

alter table public.specialist_visit_requests
  add column if not exists submission_key text;

create unique index if not exists specialist_visit_requests_submission_key_idx
on public.specialist_visit_requests (submission_key)
where submission_key is not null;

drop policy if exists "specialists_admins_can_delete_visit_requests" on public.specialist_visit_requests;
create policy "specialists_admins_can_delete_visit_requests"
on public.specialist_visit_requests
for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
);
