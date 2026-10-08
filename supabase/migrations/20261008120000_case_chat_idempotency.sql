-- Chat do caso: idempotência de envio e vínculo pergunta → resposta.
--
-- Não destrutiva: apenas adiciona colunas opcionais e índices parciais. Linhas
-- antigas ficam com NULL e continuam válidas. O código funciona com ou sem
-- esta migration (detecta a ausência das colunas), mas a proteção contra
-- respostas duplicadas em requisições concorrentes depende dela.
--
-- client_message_id   : chave gerada no navegador por envio. Reenvios da
--                       mesma mensagem (queda de rede, duplo clique) não
--                       duplicam a pergunta.
-- reply_to_message_id : mensagem do usuário que a resposta da IA atende. O
--                       índice único impede duas respostas para o mesmo turno.

alter table public.case_chat_messages
  add column if not exists client_message_id text,
  add column if not exists reply_to_message_id uuid references public.case_chat_messages(id) on delete set null;

alter table public.case_chat_messages
  drop constraint if exists case_chat_messages_client_message_id_check;

alter table public.case_chat_messages
  add constraint case_chat_messages_client_message_id_check
  check (client_message_id is null or length(client_message_id) between 1 and 120);

create unique index if not exists case_chat_messages_client_text_uidx
  on public.case_chat_messages(case_id, client_message_id)
  where client_message_id is not null and role = 'user' and message_type = 'text';

create unique index if not exists case_chat_messages_reply_uidx
  on public.case_chat_messages(reply_to_message_id)
  where reply_to_message_id is not null and role = 'assistant';
