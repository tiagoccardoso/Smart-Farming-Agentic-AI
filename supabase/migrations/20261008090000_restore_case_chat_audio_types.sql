-- Restaura os formatos de áudio do chat dos casos agronômicos.
--
-- A migration 20260607120000_allow_mobile_case_image_uploads.sql redefiniu
-- allowed_mime_types do bucket "agronomic-cases" só com imagens + PDF e, sem
-- querer, removeu os tipos de áudio adicionados em 20260518123000. Com isso o
-- storage recusava as mensagens de voz do chat.
--
-- Não destrutiva: apenas amplia a lista de formatos aceitos. Inclui audio/mp4
-- (gravação do Safari/iPhone) e audio/ogg (Firefox).

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav'
]
where id = 'agronomic-cases';
