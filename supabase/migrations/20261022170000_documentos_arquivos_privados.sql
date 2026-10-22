-- Documentos com arquivo anexo (privado) e assinatura opcional.
--  arquivo_path     caminho do arquivo no bucket privado (empresa_id/uuid.ext)
--  arquivo_nome     nome original, só para exibir
--  exige_assinatura true = a funcionária precisa assinar (regra antiga, por isso o default)
alter table public.documentos
  add column if not exists arquivo_path text,
  add column if not exists arquivo_nome text,
  add column if not exists exige_assinatura boolean not null default true;

-- Bucket PRIVADO: sem políticas em storage.objects, só a chave de serviço (função do
-- servidor) lê e grava. A funcionária recebe um link assinado de 60 s depois que a função
-- confere se o documento é dela.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos-privados', 'documentos-privados', false, 15728640,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;
