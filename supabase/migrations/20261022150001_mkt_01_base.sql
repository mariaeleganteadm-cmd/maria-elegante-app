-- ============================================================================
-- Central de Marketing — Fase 1, migration 1 de 4: base
-- Agentes, projetos, lojas do projeto, conversas, mensagens, decisões, execuções.
--
-- ADITIVA: só cria objetos novos com prefixo mkt_. Não altera nem lê dados de
-- nenhuma tabela existente (apenas referencia empresas, filiais e funcionarias
-- por chave estrangeira).
--
-- Convenções (herdadas do app atual):
--   * empresa_id, filiais.id e funcionarias.id são bigint (não uuid).
--   * "usuário" do módulo = funcionarias.id (o app não usa auth.users.id nas tabelas).
--   * Códigos de status em inglês (snake_case); a interface mostra em português.
--   * Exclusão controlada: FKs com RESTRICT; só tabelas de ligação usam CASCADE.
-- ============================================================================

-- Função genérica para manter updated_at.
create or replace function public.mkt_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- mkt_agents — agentes configuráveis (serviços lógicos, não servidores)
-- ---------------------------------------------------------------------------
create table public.mkt_agents (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    bigint not null references public.empresas(id) on delete restrict,
  code          text not null,
  name          text not null,
  description   text,
  instructions  text not null default '',
  model_config  jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint mkt_agents_code_fmt   check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint mkt_agents_empresa_code_uk unique (empresa_id, code)
);

create trigger mkt_agents_updated_at before update on public.mkt_agents
  for each row execute function public.mkt_set_updated_at();

-- ---------------------------------------------------------------------------
-- mkt_projects — projetos e campanhas
-- status segue os estados da especificação (seção 7): ideia → ... → concluída.
-- ---------------------------------------------------------------------------
create table public.mkt_projects (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   bigint not null references public.empresas(id) on delete restrict,
  title        text not null,
  slug         text not null,
  description  text,
  objective    text,
  category     text not null default 'promotional',
  status       text not null default 'idea',
  priority     text not null default 'normal',
  start_date   date,
  end_date     date,
  owner_id     bigint references public.funcionarias(id) on delete restrict,
  created_by   bigint references public.funcionarias(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint mkt_projects_title_len check (length(btrim(title)) between 1 and 200),
  constraint mkt_projects_slug_fmt  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint mkt_projects_category  check (category in
    ('promotional','seasonal','launch','institutional','internal','other')),
  constraint mkt_projects_status    check (status in
    ('idea','discussing','proposal','awaiting_approval','approved','in_progress','completed','cancelled')),
  constraint mkt_projects_priority  check (priority in ('low','normal','high')),
  constraint mkt_projects_dates     check (end_date is null or start_date is null or end_date >= start_date),
  constraint mkt_projects_empresa_slug_uk unique (empresa_id, slug)
);

create trigger mkt_projects_updated_at before update on public.mkt_projects
  for each row execute function public.mkt_set_updated_at();

create index mkt_projects_empresa_status_idx on public.mkt_projects (empresa_id, status)
  where archived_at is null;
create index mkt_projects_empresa_start_idx  on public.mkt_projects (empresa_id, start_date);
create index mkt_projects_empresa_created_idx on public.mkt_projects (empresa_id, created_at desc);
create index mkt_projects_fts_idx on public.mkt_projects using gin (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(objective, ''))
);

-- ---------------------------------------------------------------------------
-- mkt_project_stores — vínculo N:N entre projeto e lojas (filiais)
-- "Todas as lojas" = uma linha por loja.
-- ---------------------------------------------------------------------------
create table public.mkt_project_stores (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid   not null references public.mkt_projects(id) on delete cascade,
  store_id    bigint not null references public.filiais(id) on delete restrict,
  constraint mkt_project_stores_uk unique (project_id, store_id)
);
create index mkt_project_stores_store_idx on public.mkt_project_stores (store_id);

-- ---------------------------------------------------------------------------
-- mkt_conversations / mkt_messages — assistente de IA
-- ---------------------------------------------------------------------------
create table public.mkt_conversations (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  bigint not null references public.empresas(id) on delete restrict,
  project_id  uuid references public.mkt_projects(id) on delete set null,
  title       text not null default 'Nova conversa',
  status      text not null default 'active',
  created_by  bigint references public.funcionarias(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mkt_conversations_status check (status in ('active','archived')),
  constraint mkt_conversations_title_len check (length(btrim(title)) between 1 and 200)
);
create trigger mkt_conversations_updated_at before update on public.mkt_conversations
  for each row execute function public.mkt_set_updated_at();
create index mkt_conversations_empresa_upd_idx on public.mkt_conversations (empresa_id, updated_at desc);
create index mkt_conversations_project_idx on public.mkt_conversations (project_id);

create table public.mkt_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.mkt_conversations(id) on delete restrict,
  role             text not null,
  content          text not null,
  metadata         jsonb not null default '{}'::jsonb,
  model_name       text,
  tokens_input     integer,
  tokens_output    integer,
  created_at       timestamptz not null default now(),
  constraint mkt_messages_role check (role in ('system','user','assistant','tool')),
  constraint mkt_messages_tokens check (
    (tokens_input is null or tokens_input >= 0) and (tokens_output is null or tokens_output >= 0))
);
create index mkt_messages_conv_idx on public.mkt_messages (conversation_id, created_at);
create index mkt_messages_fts_idx on public.mkt_messages using gin (to_tsvector('portuguese', content));

-- ---------------------------------------------------------------------------
-- mkt_project_decisions — separa o que foi só discutido do que foi decidido.
-- Uma decisão só vira 'confirmed' com quem decidiu e quando (regra no banco).
-- ---------------------------------------------------------------------------
create table public.mkt_project_decisions (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        bigint not null references public.empresas(id) on delete restrict,
  project_id        uuid not null references public.mkt_projects(id) on delete restrict,
  conversation_id   uuid references public.mkt_conversations(id) on delete set null,
  source_message_id uuid references public.mkt_messages(id) on delete set null,
  decision_text     text not null,
  status            text not null default 'proposed',
  decided_by        bigint references public.funcionarias(id) on delete restrict,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint mkt_decisions_status check (status in ('proposed','confirmed','rejected','superseded')),
  constraint mkt_decisions_confirmed_has_who check (
    status <> 'confirmed' or (decided_by is not null and decided_at is not null))
);
create index mkt_decisions_project_idx on public.mkt_project_decisions (project_id, created_at desc);
create index mkt_decisions_empresa_status_idx on public.mkt_project_decisions (empresa_id, status);

-- ---------------------------------------------------------------------------
-- mkt_agent_runs — cada execução de um agente (auditoria e idempotência)
-- idempotency_key evita repetir a mesma ação após falha/reenvio.
-- ---------------------------------------------------------------------------
create table public.mkt_agent_runs (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       bigint not null references public.empresas(id) on delete restrict,
  agent_id         uuid not null references public.mkt_agents(id) on delete restrict,
  project_id       uuid references public.mkt_projects(id) on delete set null,
  conversation_id  uuid references public.mkt_conversations(id) on delete set null,
  status           text not null default 'queued',
  idempotency_key  text,
  input_data       jsonb not null default '{}'::jsonb,
  output_data      jsonb,
  error_message    text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint mkt_agent_runs_status check (status in ('queued','running','succeeded','failed','cancelled'))
);
create unique index mkt_agent_runs_idem_uk on public.mkt_agent_runs (empresa_id, idempotency_key)
  where idempotency_key is not null;
create index mkt_agent_runs_agent_idx on public.mkt_agent_runs (agent_id, created_at desc);
create index mkt_agent_runs_empresa_idx on public.mkt_agent_runs (empresa_id, created_at desc);
