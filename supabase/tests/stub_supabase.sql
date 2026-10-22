-- Imita o mínimo do Supabase real (papéis anon/authenticated/service_role e as tabelas
-- empresas, filiais e funcionarias) para testar as migrations em um Postgres local descartável.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.empresas (id bigint generated always as identity primary key, nome text);
create table public.filiais (id bigint generated always as identity primary key, nome text, empresa_id bigint references public.empresas(id));
create table public.funcionarias (id bigint generated always as identity primary key, nome text, perfil text, empresa_id bigint references public.empresas(id));
insert into public.empresas(nome) values ('Maria Elegante');
insert into public.filiais(nome, empresa_id) select n, 1 from unnest(array['Lavras','Três Corações','Campo Belo','Elói Mendes']) n;
insert into public.funcionarias(nome, perfil, empresa_id) values ('Gestor Teste','gestor',1);
