-- ============================================================================
-- Central de Marketing — Fase 1, migration 3 de 4: materiais e marca
-- Materiais (arquivos), conteúdos (textos), pacotes de publicação, aprovações,
-- identidade visual e integrações.
-- Depende de: 20261022150001_mkt_01_base.sql e 20261022150002_mkt_02_planejamento.sql
-- ADITIVA: só cria objetos novos com prefixo mkt_.
--
-- Arquivos: o banco guarda só metadados e IDs (nunca base64).
-- storage_provider 'google_drive' é o destino definitivo (Fase 6). Enquanto o Drive
-- não estiver conectado, 'supabase_storage' (bucket privado) serve de apoio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- mkt_assets
-- ---------------------------------------------------------------------------
create table public.mkt_assets (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       bigint not null references public.empresas(id) on delete restrict,
  project_id       uuid references public.mkt_projects(id) on delete restrict,
  task_id          uuid references public.mkt_tasks(id) on delete set null,
  asset_type       text not null default 'image',
  title            text not null,
  description      text,
  mime_type        text,
  file_size        bigint,
  drive_file_id    text,
  drive_folder_id  text,
  storage_provider text not null default 'google_drive',
  storage_path     text,
  width            integer,
  height           integer,
  status           text not null default 'draft',
  created_by       bigint references public.funcionarias(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint mkt_assets_type check (asset_type in ('image','video','document','logo','other')),
  constraint mkt_assets_status check (status in ('draft','in_review','approved','archived')),
  constraint mkt_assets_provider check (storage_provider in ('google_drive','supabase_storage')),
  constraint mkt_assets_title_len check (length(btrim(title)) between 1 and 200),
  constraint mkt_assets_size check (file_size is null or file_size >= 0),
  constraint mkt_assets_dims check (
    (width is null or width > 0) and (height is null or height > 0))
);
create trigger mkt_assets_updated_at before update on public.mkt_assets
  for each row execute function public.mkt_set_updated_at();
create index mkt_assets_empresa_status_idx on public.mkt_assets (empresa_id, status, created_at desc);
create index mkt_assets_project_idx on public.mkt_assets (project_id);
create unique index mkt_assets_drive_file_uk on public.mkt_assets (empresa_id, drive_file_id)
  where drive_file_id is not null;
create index mkt_assets_fts_idx on public.mkt_assets using gin (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, '')));

-- ---------------------------------------------------------------------------
-- mkt_asset_versions — versões aprovadas não podem ser apagadas.
-- ---------------------------------------------------------------------------
create table public.mkt_asset_versions (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references public.mkt_assets(id) on delete restrict,
  version_number      integer not null,
  drive_file_id       text,
  storage_path        text,
  prompt_used         text,
  generation_metadata jsonb not null default '{}'::jsonb,
  is_approved         boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint mkt_asset_versions_num check (version_number >= 1),
  constraint mkt_asset_versions_uk unique (asset_id, version_number)
);

create or replace function public.mkt_protect_approved_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_approved then
    raise exception 'Versão aprovada não pode ser excluída' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger mkt_asset_versions_protect before delete on public.mkt_asset_versions
  for each row execute function public.mkt_protect_approved_version();

-- ---------------------------------------------------------------------------
-- mkt_content / mkt_content_versions — legendas, roteiros, e-mails, etc.
-- Estados de aprovação da seção 18 da especificação.
-- ---------------------------------------------------------------------------
create table public.mkt_content (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    bigint not null references public.empresas(id) on delete restrict,
  project_id    uuid not null references public.mkt_projects(id) on delete restrict,
  title         text not null,
  content_type  text not null default 'caption',
  body          text not null default '',
  status        text not null default 'draft',
  created_by    bigint references public.funcionarias(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint mkt_content_title_len check (length(btrim(title)) between 1 and 200),
  constraint mkt_content_type check (content_type in
    ('caption','reel_script','promo_text','whatsapp','email','banner_text','headline',
     'internal_notice','briefing','other')),
  constraint mkt_content_status check (status in
    ('draft','in_review','changes_requested','approved','done'))
);
create trigger mkt_content_updated_at before update on public.mkt_content
  for each row execute function public.mkt_set_updated_at();
create index mkt_content_project_idx on public.mkt_content (project_id, status);
create index mkt_content_empresa_idx on public.mkt_content (empresa_id, created_at desc);
create index mkt_content_fts_idx on public.mkt_content using gin (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(body, '')));

create table public.mkt_content_versions (
  id              uuid primary key default gen_random_uuid(),
  content_id      uuid not null references public.mkt_content(id) on delete restrict,
  version_number  integer not null,
  body            text not null,
  created_by      bigint references public.funcionarias(id) on delete restrict,
  created_at      timestamptz not null default now(),
  constraint mkt_content_versions_num check (version_number >= 1),
  constraint mkt_content_versions_uk unique (content_id, version_number)
);

-- ---------------------------------------------------------------------------
-- mkt_publication_packages — pacote pronto para publicação MANUAL.
-- Esta versão não publica em redes sociais. Regra de negócio (backend): só passa
-- a 'ready' ou 'published_manually' se texto e arte estiverem aprovados.
-- ---------------------------------------------------------------------------
create table public.mkt_publication_packages (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    bigint not null references public.empresas(id) on delete restrict,
  project_id    uuid not null references public.mkt_projects(id) on delete restrict,
  asset_id      uuid references public.mkt_assets(id) on delete restrict,
  content_id    uuid references public.mkt_content(id) on delete restrict,
  store_id      bigint references public.filiais(id) on delete restrict,
  channel       text not null default 'instagram_feed',
  scheduled_at  timestamptz,
  published_at  timestamptz,
  status        text not null default 'preparing',
  instructions  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint mkt_pubpkg_channel check (channel in
    ('instagram_feed','instagram_story','instagram_reels','whatsapp','email','site','other')),
  constraint mkt_pubpkg_status check (status in
    ('preparing','in_review','approved','ready','published_manually','cancelled')),
  constraint mkt_pubpkg_published check (published_at is null or status = 'published_manually')
);
create trigger mkt_pubpkg_updated_at before update on public.mkt_publication_packages
  for each row execute function public.mkt_set_updated_at();
create index mkt_pubpkg_project_idx on public.mkt_publication_packages (project_id, status);
create index mkt_pubpkg_empresa_sched_idx on public.mkt_publication_packages (empresa_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- mkt_approvals — vínculo polimórfico (sem FK convencional).
-- O gatilho confere que a entidade existe, é da mesma empresa e não muda depois.
-- As entidades do módulo nunca são apagadas de verdade (FKs RESTRICT + arquivamento),
-- então não ficam aprovações órfãs.
-- ---------------------------------------------------------------------------
create table public.mkt_approvals (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    bigint not null references public.empresas(id) on delete restrict,
  entity_type   text not null,
  entity_id     uuid not null,
  requested_by  bigint not null references public.funcionarias(id) on delete restrict,
  reviewed_by   bigint references public.funcionarias(id) on delete restrict,
  status        text not null default 'pending',
  comments      text,
  requested_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  constraint mkt_approvals_entity check (entity_type in
    ('project','decision','content','asset','publication_package')),
  constraint mkt_approvals_status check (status in
    ('pending','approved','rejected','changes_requested')),
  constraint mkt_approvals_reviewed_has_who check (
    status = 'pending' or (reviewed_by is not null and reviewed_at is not null))
);
create index mkt_approvals_entity_idx on public.mkt_approvals (entity_type, entity_id);
create index mkt_approvals_empresa_status_idx on public.mkt_approvals (empresa_id, status, requested_at desc);

create or replace function public.mkt_check_approval_entity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean := false;
begin
  if tg_op = 'UPDATE'
     and (old.entity_type is distinct from new.entity_type
          or old.entity_id is distinct from new.entity_id
          or old.empresa_id is distinct from new.empresa_id) then
    raise exception 'A entidade de uma aprovação não pode ser alterada' using errcode = '23514';
  end if;

  if new.entity_type = 'project' then
    select exists (select 1 from public.mkt_projects x
                    where x.id = new.entity_id and x.empresa_id = new.empresa_id) into v_ok;
  elsif new.entity_type = 'decision' then
    select exists (select 1 from public.mkt_project_decisions x
                    where x.id = new.entity_id and x.empresa_id = new.empresa_id) into v_ok;
  elsif new.entity_type = 'content' then
    select exists (select 1 from public.mkt_content x
                    where x.id = new.entity_id and x.empresa_id = new.empresa_id) into v_ok;
  elsif new.entity_type = 'asset' then
    select exists (select 1 from public.mkt_assets x
                    where x.id = new.entity_id and x.empresa_id = new.empresa_id) into v_ok;
  elsif new.entity_type = 'publication_package' then
    select exists (select 1 from public.mkt_publication_packages x
                    where x.id = new.entity_id and x.empresa_id = new.empresa_id) into v_ok;
  end if;

  if not v_ok then
    raise exception 'Entidade da aprovação não encontrada (% / %)', new.entity_type, new.entity_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger mkt_approvals_check before insert or update on public.mkt_approvals
  for each row execute function public.mkt_check_approval_entity();

-- ---------------------------------------------------------------------------
-- mkt_brand_settings — identidade visual (uma linha por empresa).
-- Os arquivos oficiais (logo etc.) ficam em mkt_assets; aqui só a referência.
-- ---------------------------------------------------------------------------
create table public.mkt_brand_settings (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        bigint not null references public.empresas(id) on delete restrict,
  brand_name        text not null default 'Maria Elegante',
  slogan            text default 'Aqui é simples ser elegante',
  primary_color     text not null default '#17E5C3',
  secondary_color   text not null default '#000000',
  logo_asset_id     uuid references public.mkt_assets(id) on delete set null,
  brand_guidelines  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint mkt_brand_empresa_uk unique (empresa_id),
  constraint mkt_brand_primary_hex check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint mkt_brand_secondary_hex check (secondary_color ~ '^#[0-9A-Fa-f]{6}$')
);
create trigger mkt_brand_updated_at before update on public.mkt_brand_settings
  for each row execute function public.mkt_set_updated_at();

-- ---------------------------------------------------------------------------
-- mkt_integrations — estado das conexões (OpenAI, Google Drive...).
-- NUNCA guardar tokens/chaves aqui: a constraint recusa chaves com esses nomes.
-- Segredos ficam em variáveis do Netlify (ou Supabase Vault).
-- ---------------------------------------------------------------------------
create table public.mkt_integrations (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     bigint not null references public.empresas(id) on delete restrict,
  provider       text not null,
  status         text not null default 'pending',
  configuration  jsonb not null default '{}'::jsonb,
  connected_by   bigint references public.funcionarias(id) on delete restrict,
  connected_at   timestamptz,
  updated_at     timestamptz not null default now(),
  constraint mkt_integrations_provider check (provider in
    ('openai','google_drive','google_calendar','instagram')),
  constraint mkt_integrations_status check (status in ('pending','connected','error','revoked')),
  constraint mkt_integrations_no_secrets check (
    not (configuration ?| array['access_token','refresh_token','api_key','apikey','secret',
                                'client_secret','password','token','authorization'])),
  constraint mkt_integrations_uk unique (empresa_id, provider)
);
create trigger mkt_integrations_updated_at before update on public.mkt_integrations
  for each row execute function public.mkt_set_updated_at();
