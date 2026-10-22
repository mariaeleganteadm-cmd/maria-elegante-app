-- Documentos enviados somente para vendedoras específicas.
-- func_ids preenchido = só essas funcionárias veem (ignora filial_id).
-- func_ids NULL = regra antiga (filial_id ou todas as filiais).
alter table public.documentos add column if not exists func_ids bigint[];
comment on column public.documentos.func_ids is 'Se preenchido, o documento vai somente para estas funcionárias (ignora filial_id). NULL = regra antiga: filial_id ou todas as filiais.';
