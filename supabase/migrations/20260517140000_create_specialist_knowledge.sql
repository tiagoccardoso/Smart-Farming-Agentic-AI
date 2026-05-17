-- Create a specialist-maintained knowledge base for future AI answer enrichment.

create table if not exists public.specialist_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text,
  category text,
  crop text,
  content text,
  file_url text,
  created_by uuid references auth.users(id),
  active boolean default true,
  created_at timestamptz default now(),
  constraint specialist_knowledge_category_check check (
    category is null
    or category in (
      'protocolo',
      'artigo',
      'aula',
      'recomendacao',
      'faq',
      'caso_pratico',
      'manejo',
      'solo',
      'pragas',
      'doencas'
    )
  )
);

alter table public.specialist_knowledge enable row level security;

create policy "Specialists can view knowledge materials"
  on public.specialist_knowledge for select
  to authenticated
  using (public.is_specialist_or_admin());

create policy "Specialists can insert knowledge materials"
  on public.specialist_knowledge for insert
  to authenticated
  with check (
    public.is_specialist_or_admin()
    and (created_by = auth.uid() or public.is_admin())
  );

create policy "Specialists can update their knowledge materials"
  on public.specialist_knowledge for update
  to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());

create index if not exists specialist_knowledge_crop_idx on public.specialist_knowledge(crop);
create index if not exists specialist_knowledge_category_idx on public.specialist_knowledge(category);
create index if not exists specialist_knowledge_active_idx on public.specialist_knowledge(active);
create index if not exists specialist_knowledge_created_by_idx on public.specialist_knowledge(created_by);
