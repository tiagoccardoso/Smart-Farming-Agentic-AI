insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-images', 'site-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "specialists_admins_manage_site_images" on storage.objects;
create policy "specialists_admins_manage_site_images"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'site-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
)
with check (
  bucket_id = 'site-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
);

insert into public.site_pages (slug, title, subtitle, image_url, content)
values (
  'home',
  'Consultoria agrícola inteligente para produção orgânica e decisões no campo',
  'Una inteligência artificial, conhecimento agronômico e revisão humana especializada para diagnosticar problemas, planejar manejos e apoiar a conversão da sua propriedade para agricultura orgânica.',
  null,
  jsonb_build_object(
    'heroText', 'A Plantasã ajuda produtores a organizarem informações da lavoura, enviarem fotos, receberem uma triagem inicial por IA e, quando necessário, contarem com revisão técnica humana conduzida por especialista em produção vegetal, olericultura e agricultura orgânica.',
    'primaryButtonText', 'Conhecer consultoria orgânica',
    'primaryButtonUrl', '/agricultura-organica',
    'secondaryButtonText', 'Iniciar consultoria com IA',
    'secondaryButtonUrl', '/consultoria-ia',
    'organicSectionTitle', 'Pensando em converter sua propriedade para produção orgânica?',
    'organicSectionText', 'A conversão para a agricultura orgânica pode abrir novas oportunidades de mercado, valorizar a produção e melhorar a sustentabilidade da propriedade. Mas esse processo exige diagnóstico, planejamento e acompanhamento técnico.',
    'cards', '[]'::jsonb
  )
)
on conflict (slug) do nothing;
