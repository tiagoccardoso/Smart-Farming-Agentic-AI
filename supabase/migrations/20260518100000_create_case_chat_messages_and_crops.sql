-- Advanced AI case chat history and crop knowledge catalog.

create extension if not exists "pgcrypto";

create table if not exists public.case_chat_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint case_chat_messages_role_check check (role in ('user', 'assistant')),
  constraint case_chat_messages_message_check check (length(trim(message)) > 0)
);

create index if not exists case_chat_messages_case_created_idx on public.case_chat_messages(case_id, created_at);
create index if not exists case_chat_messages_user_idx on public.case_chat_messages(user_id);

alter table public.case_chat_messages enable row level security;

drop policy if exists "Users can view own case chat messages" on public.case_chat_messages;
create policy "Users can view own case chat messages"
  on public.case_chat_messages for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.agronomic_cases c
      where c.id = case_chat_messages.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  );

drop policy if exists "Users can insert own case chat messages" on public.case_chat_messages;
create policy "Users can insert own case chat messages"
  on public.case_chat_messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.agronomic_cases c
      where c.id = case_chat_messages.case_id
        and c.user_id = auth.uid()
    )
  );

create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scientific_name text,
  recommended_soil text,
  ideal_climate text,
  common_diseases text,
  common_pests text,
  growth_cycle text,
  irrigation_notes text,
  fertilization_notes text,
  recommended_region text,
  known_risks text,
  management_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crops_name_check check (length(trim(name)) > 0)
);

create unique index if not exists crops_name_unique_idx on public.crops (lower(name));
create index if not exists crops_active_name_idx on public.crops(active, name);

alter table public.crops enable row level security;

drop trigger if exists set_crops_updated_at on public.crops;
create trigger set_crops_updated_at
  before update on public.crops
  for each row execute function public.set_updated_at();

drop policy if exists "Authenticated users can view active crops" on public.crops;
create policy "Authenticated users can view active crops"
  on public.crops for select
  to authenticated
  using (active = true or public.is_specialist_or_admin());

drop policy if exists "Specialists can insert crops" on public.crops;
create policy "Specialists can insert crops"
  on public.crops for insert
  to authenticated
  with check (public.is_specialist_or_admin());

drop policy if exists "Specialists can update crops" on public.crops;
create policy "Specialists can update crops"
  on public.crops for update
  to authenticated
  using (public.is_specialist_or_admin())
  with check (public.is_specialist_or_admin());

insert into public.crops (name, scientific_name, recommended_soil, ideal_climate, common_diseases, common_pests, growth_cycle, irrigation_notes, fertilization_notes, recommended_region, known_risks, management_notes)
values
  ('Soja', 'Glycine max', 'Solos bem drenados, pH corrigido e boa fertilidade.', 'Clima quente e úmido, com boa disponibilidade hídrica no florescimento e enchimento de grãos.', 'Ferrugem asiática, oídio, mancha-alvo, antracnose.', 'Lagartas, percevejos, mosca-branca, ácaros.', 'Aproximadamente 100 a 140 dias, conforme cultivar e ambiente.', 'Evitar déficit hídrico em florescimento e enchimento; monitorar encharcamento.', 'Calagem e adubação conforme análise de solo; atenção a fósforo, potássio e inoculação.', 'Regiões com janela de plantio adequada, boa drenagem e histórico sanitário monitorado.', 'Alta umidade favorece doenças foliares; monocultivo aumenta pressão de pragas e patógenos.', 'Monitoramento frequente, rotação de culturas, cultivares adaptadas e manejo integrado de pragas e doenças.'),
  ('Milho', 'Zea mays', 'Solos profundos, férteis, bem drenados e com bom teor de matéria orgânica.', 'Clima quente, alta luminosidade e disponibilidade de água em pendoamento e enchimento.', 'Mancha branca, cercosporiose, ferrugens, enfezamentos.', 'Cigarrinha, lagarta-do-cartucho, percevejos, pulgões.', 'Aproximadamente 90 a 160 dias, conforme híbrido e época.', 'Fases de florescimento e enchimento são críticas para água.', 'Exigente em nitrogênio; planejar adubação conforme produtividade esperada e análise.', 'Regiões com boa radiação, temperatura favorável e janela que reduza estresse hídrico.', 'Estresse hídrico e cigarrinha podem causar perdas expressivas.', 'Manejo de palhada, plantio na janela, monitoramento de cigarrinha e rotação de princípios de manejo.'),
  ('Café', 'Coffea arabica / Coffea canephora', 'Solos profundos, bem drenados, estruturados e com fertilidade corrigida.', 'Clima ameno para arábica; robusta/conilon tolera maior temperatura, evitando extremos.', 'Ferrugem, cercosporiose, phoma, mancha aureolada.', 'Bicho-mineiro, broca-do-café, cochonilhas, ácaros.', 'Cultura perene; produção varia por ciclo fenológico anual.', 'Irrigação pode estabilizar produção em regiões com déficit hídrico.', 'Adubação parcelada conforme análise de solo/foliar e expectativa de safra.', 'Regiões com altitude, temperatura e regime hídrico compatíveis com a espécie/cultivar.', 'Geada, déficit hídrico, bienalidade e pressão de ferrugem podem elevar risco.', 'Poda, nutrição equilibrada, monitoramento fitossanitário e conservação do solo.')
on conflict do nothing;
