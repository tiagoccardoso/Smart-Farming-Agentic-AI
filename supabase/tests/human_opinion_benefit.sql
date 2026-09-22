-- Verificacao do beneficio de parecer agronomico humano (IA Profissional = 1,
-- Consultoria Agronomica = 3) direto no Postgres.
--
-- Uso (banco de DESENVOLVIMENTO com todas as migrations aplicadas):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/human_opinion_benefit.sql
-- Tudo roda dentro de uma transacao que termina em ROLLBACK: nada e gravado.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'teste-pro@plantasa.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'teste-outro@plantasa.invalid');

insert into public.agronomic_cases (id, user_id, crop, symptoms, status)
select ('00000000-0000-4000-8000-0000000c000' || g)::uuid,
       '00000000-0000-4000-8000-00000000a001', 'Soja', 'Manchas foliares no talhao', 'submitted'
from generate_series(1, 5) g;

insert into public.agronomic_cases (id, user_id, crop, symptoms, status)
values ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-00000000a002', 'Milho', 'Folhas amarelas', 'submitted');

do $$
declare
  u uuid := '00000000-0000-4000-8000-00000000a001';
  cs timestamptz := now() - interval '1 day';
  ce timestamptz := now() + interval '29 days';
  r jsonb;
  failed boolean;
begin
  -- 1. IA Profissional: primeiro parecer do ciclo.
  r := public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0001', 'teste-chave-0001', null, 'ia-profissional', 1, 'ref', cs, ce, 'Soja', 'Manchas foliares no talhao');
  assert (r ->> 'replayed')::boolean = false, 'primeiro envio deveria consumir';

  -- 2. Mesma chave: replay, sem novo consumo.
  r := public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0002', 'teste-chave-0001', null, 'ia-profissional', 1, 'ref', cs, ce, 'Soja', 'Manchas');
  assert (r ->> 'replayed')::boolean = true, 'mesma chave deveria ser replay';

  -- 3. Mesmo caso com outra chave: replay.
  r := public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0001', 'teste-chave-0002', null, 'ia-profissional', 1, 'ref', cs, ce, 'Soja', 'Manchas');
  assert (r ->> 'replayed')::boolean = true, 'mesmo caso deveria ser replay';

  -- 4. Segundo parecer no IA Profissional: bloqueado.
  failed := false;
  begin
    perform public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0002', 'teste-chave-0003', null, 'ia-profissional', 1, 'ref', cs, ce, 'Soja', 'Manchas');
  exception when others then failed := sqlerrm = 'HUMAN_OPINION_LIMIT_REACHED';
  end;
  assert failed, 'segundo parecer do IA Profissional deveria ser bloqueado';

  -- 5. Upgrade no mesmo ciclo (limite 3): mais 2 permitidos, o 4o bloqueado.
  perform public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0002', 'teste-chave-0004', null, 'consultoria-agronomica', 3, 'ref', cs, ce, 'Soja', 'Manchas');
  perform public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0003', 'teste-chave-0005', null, 'consultoria-agronomica', 3, 'ref', cs, ce, 'Soja', 'Manchas');
  failed := false;
  begin
    perform public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0004', 'teste-chave-0006', null, 'consultoria-agronomica', 3, 'ref', cs, ce, 'Soja', 'Manchas');
  exception when others then failed := sqlerrm = 'HUMAN_OPINION_LIMIT_REACHED';
  end;
  assert failed, 'quarto parecer da Consultoria deveria ser bloqueado';

  -- 6. Caso de outro usuario: recusado.
  failed := false;
  begin
    perform public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000d0001', 'teste-chave-0007', null, 'consultoria-agronomica', 3, 'ref', cs, ce, 'Milho', 'Folhas');
  exception when others then failed := sqlerrm = 'CASE_NOT_FOUND';
  end;
  assert failed, 'caso de outro usuario deveria ser recusado';

  -- 7. Caso vai para a fila da especialista.
  assert (select count(*) from public.agronomic_cases where user_id = u and human_review_status = 'waiting_review') = 3,
    'tres casos deveriam estar aguardando a especialista';
  assert (select count(*) from public.human_reviews h join public.agronomic_cases c on c.id = h.case_id where c.user_id = u and h.status = 'pending') = 3,
    'fila human_reviews deveria ter tres registros';

  -- 8. Recusa pela especialista devolve a franquia.
  update public.agronomic_cases set human_review_status = 'rejected' where id = '00000000-0000-4000-8000-0000000c0003';
  assert (select status from public.technical_opinions where case_id = '00000000-0000-4000-8000-0000000c0003') = 'cancelado',
    'recusa deveria cancelar o parecer';
  perform public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0004', 'teste-chave-0008', null, 'consultoria-agronomica', 3, 'ref', cs, ce, 'Soja', 'Manchas');

  -- 9. Conclusao marca o parecer como concluido.
  update public.agronomic_cases set human_review_status = 'reviewed', status = 'human_reviewed' where id = '00000000-0000-4000-8000-0000000c0002';
  assert (select status from public.technical_opinions where case_id = '00000000-0000-4000-8000-0000000c0002') = 'concluido',
    'revisao concluida deveria concluir o parecer';

  -- 10. Novo ciclo libera de novo.
  update public.technical_opinions set created_at = now() - interval '40 days' where user_id = u;
  r := public.request_case_human_opinion(u, '00000000-0000-4000-8000-0000000c0005', 'teste-chave-0009', null, 'ia-profissional', 1, 'ref2', cs, ce, 'Soja', 'Manchas');
  assert (r ->> 'replayed')::boolean = false, 'novo ciclo deveria liberar o parecer';

  raise notice 'human_opinion_benefit: todos os cenarios passaram';
end;
$$;

-- 11. Clientes (anon/authenticated) nao executam as funcoes de consumo.
do $$
begin
  assert not has_function_privilege('authenticated', 'public.request_case_human_opinion(uuid, uuid, text, uuid, text, integer, text, timestamptz, timestamptz, text, text)', 'execute'),
    'authenticated nao pode executar request_case_human_opinion';
  assert not has_function_privilege('anon', 'public.request_case_human_opinion(uuid, uuid, text, uuid, text, integer, text, timestamptz, timestamptz, text, text)', 'execute'),
    'anon nao pode executar request_case_human_opinion';
  assert not has_function_privilege('authenticated', 'public.create_technical_opinion(uuid, text, text, uuid, uuid, uuid, integer, text, timestamptz, timestamptz)', 'execute'),
    'authenticated nao pode executar create_technical_opinion';
end;
$$;

rollback;
