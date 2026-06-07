-- Permite fotos capturadas por celulares no bucket de casos agronômicos.
-- iPhones e alguns navegadores mobile podem enviar imagens como HEIC/HEIF,
-- enquanto o bucket original aceitava apenas JPG, PNG, WEBP e PDF.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]
where id = 'agronomic-cases';
