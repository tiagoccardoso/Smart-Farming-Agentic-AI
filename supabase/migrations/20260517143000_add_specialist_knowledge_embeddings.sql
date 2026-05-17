-- Enable pgvector-based semantic search for specialist-maintained knowledge.

create extension if not exists vector;

alter table public.specialist_knowledge
  add column if not exists embedding vector(1536);

create index if not exists specialist_knowledge_embedding_idx
  on public.specialist_knowledge
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

create or replace function public.match_specialist_knowledge(
  query_embedding vector(1536),
  match_count int default 6,
  crop_filter text default null
)
returns table (
  id uuid,
  title text,
  category text,
  crop text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    specialist_knowledge.id,
    specialist_knowledge.title,
    specialist_knowledge.category,
    specialist_knowledge.crop,
    specialist_knowledge.content,
    1 - (specialist_knowledge.embedding <=> query_embedding) as similarity
  from public.specialist_knowledge
  where specialist_knowledge.active is true
    and specialist_knowledge.embedding is not null
    and specialist_knowledge.content is not null
    and btrim(specialist_knowledge.content) <> ''
    and (
      crop_filter is null
      or btrim(crop_filter) = ''
      or specialist_knowledge.crop is null
      or btrim(specialist_knowledge.crop) = ''
      or specialist_knowledge.crop ilike '%' || crop_filter || '%'
    )
  order by specialist_knowledge.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 6), 20));
$$;
