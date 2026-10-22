-- Histórico de aberturas do arquivo de um documento, por funcionária.
-- Só o servidor (função documentos-arquivos, chave de serviço) grava e lê: RLS ligado e
-- SEM políticas, para a funcionária não conseguir forjar nem apagar o registro.
create table if not exists public.documento_leituras (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.documentos(id) on delete cascade,
  func_id bigint not null references public.funcionarias(id) on delete cascade,
  empresa_id bigint,
  primeira_abertura timestamptz not null default now(),
  ultima_abertura timestamptz not null default now(),
  total_aberturas integer not null default 1,
  unique (documento_id, func_id)
);
alter table public.documento_leituras enable row level security;
comment on table public.documento_leituras is 'Quando a funcionária abriu/baixou o arquivo do documento (link assinado emitido pela função documentos-arquivos).';
