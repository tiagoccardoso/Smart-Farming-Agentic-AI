begin;

alter table public.acompanhamento_diseases
  add column if not exists crop_id uuid;

alter table public.acompanhamento_diseases
  drop constraint if exists acompanhamento_diseases_crop_id_fkey;

alter table public.acompanhamento_diseases
  add constraint acompanhamento_diseases_crop_id_fkey
  foreign key (crop_id)
  references public.crops(id)
  on delete set null;

create index if not exists acompanhamento_diseases_crop_id_idx
  on public.acompanhamento_diseases(crop_id);

commit;
