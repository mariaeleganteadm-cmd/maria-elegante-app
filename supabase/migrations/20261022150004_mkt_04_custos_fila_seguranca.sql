-- ============================================================================
-- Central de Marketing — Fase 1, migration 4 de 4: custos, fila, logs e segurança
-- Depende das migrations 1 a 3.
-- ADITIVA: só cria objetos novos com prefixo mkt_ e fecha o acesso a eles.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- mkt_settings — orçamento interno de IA (uma linha por empresa).
-- O bloqueio interno NÃO substitui o limite de gastos configurado no provedor da API.
-- ---------------------------------------------------------------------------
create table public.mkt_settings (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           bigint not null references public.empresas(id) on delete restrict,
  monthly_budget_brl   numeric(10,2) not null default 100.00,
  image_daily_limit    integer not null default 10,
  image_monthly_limit  integer not null default 100,
  alert_threshold_pct  integer not null default 80,
  block_on_limit       boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint mkt_settings_empresa_uk unique (empresa_id),
  constraint mkt_settings_budget check (monthly_budget_brl >= 0),
  constraint mkt_settings_img_limits check (image_daily_limit >= 0 and image_monthly_limit >= 0),
  constraint mkt_settings_alert check (alert_threshold_pct between 1 and 100)
);
create trigger mkt_settings_updated_at before update on public.mkt_settings
  for each row execute function public.mkt_set_updated_at();

-- ---------------------------------------------------------------------------
-- mkt_ai_usage — cada chamada paga à IA (base do controle de custos).
-- Registros de gasto sobrevivem à remoção de execuções (ON DELETE SET NULL).
-- ---------------------------------------------------------------------------
create table public.mkt_ai_usage (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           bigint not null references public.empresas(id) on delete restrict,
  agent_run_id         uuid references public.mkt_agent_runs(id) on delete set null,
  agent_id             uuid references public.mkt_agents(id) on delete set null,
  user_id              bigint references public.funcionarias(id) on delete restrict,
  provider             text not null,
  model                text not null,
  operation_type       text not null,
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  image_count          integer not null default 0,
  estimated_cost_usd   numeric(12,6) not null default 0,
  actual_cost_usd      numeric(12,6),
  fx_usd_brl           numeric(8,4),
  estimated_cost_brl   numeric(12,4),
  created_at           timestamptz not null default now(),
  constraint mkt_ai_usage_op check (operation_type in
    ('chat','classification','text_generation','image_generation','other')),
  constraint mkt_ai_usage_nonneg check (
    input_tokens >= 0 and output_tokens >= 0 and image_count >= 0
    and estimated_cost_usd >= 0 and (actual_cost_usd is null or actual_cost_usd >= 0))
);
create index mkt_ai_usage_empresa_date_idx on public.mkt_ai_usage (empresa_id, created_at desc);
create index mkt_ai_usage_agent_idx on public.mkt_ai_usage (agent_id, created_at desc);
create index mkt_ai_usage_op_idx on public.mkt_ai_usage (empresa_id, operation_type, created_at desc);

-- ---------------------------------------------------------------------------
-- mkt_activity_logs — histórico de ações (de pessoas ou de agentes).
-- Nunca registrar tokens ou segredos em details (a constraint barra os nomes óbvios).
-- ---------------------------------------------------------------------------
create table public.mkt_activity_logs (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      bigint not null references public.empresas(id) on delete restrict,
  actor_user_id   bigint references public.funcionarias(id) on delete restrict,
  actor_agent_id  uuid references public.mkt_agents(id) on delete set null,
  entity_type     text not null,
  entity_id       uuid,
  action          text not null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint mkt_activity_no_secrets check (
    not (details ?| array['access_token','refresh_token','api_key','apikey','secret',
                          'client_secret','password','token','authorization']))
);
create index mkt_activity_empresa_idx on public.mkt_activity_logs (empresa_id, created_at desc);
create index mkt_activity_entity_idx on public.mkt_activity_logs (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- mkt_jobs — fila persistente para tarefas longas (ex.: gerar imagens).
-- Não depende de uma requisição HTTP aberta nem do navegador.
-- Ciclo: queued → running → succeeded | failed (tenta de novo) → dead.
-- ---------------------------------------------------------------------------
create table public.mkt_jobs (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       bigint not null references public.empresas(id) on delete restrict,
  job_type         text not null,
  status           text not null default 'queued',
  payload          jsonb not null default '{}'::jsonb,
  result           jsonb,
  error_message    text,
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  run_after        timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  idempotency_key  text,
  created_by       bigint references public.funcionarias(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint mkt_jobs_status check (status in
    ('queued','running','succeeded','failed','dead','cancelled')),
  constraint mkt_jobs_attempts check (attempts >= 0 and max_attempts >= 1)
);
create trigger mkt_jobs_updated_at before update on public.mkt_jobs
  for each row execute function public.mkt_set_updated_at();
create unique index mkt_jobs_idem_uk on public.mkt_jobs (empresa_id, idempotency_key)
  where idempotency_key is not null;
create index mkt_jobs_pending_idx on public.mkt_jobs (run_after, created_at)
  where status in ('queued','failed','running');

-- Reserva o próximo job de forma segura entre execuções simultâneas (SKIP LOCKED).
-- Também reaproveita jobs 'running' parados há mais de 15 minutos (execução que caiu).
-- Quem chama (função de servidor) marca succeeded / failed / dead ao terminar.
create or replace function public.mkt_claim_job(p_worker text, p_types text[] default null)
returns setof public.mkt_jobs
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.mkt_jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         attempts = j.attempts + 1
   where j.id = (
     select c.id
       from public.mkt_jobs c
      where c.run_after <= now()
        and c.attempts < c.max_attempts
        and (c.status in ('queued','failed')
             or (c.status = 'running' and c.locked_at < now() - interval '15 minutes'))
        and (p_types is null or c.job_type = any (p_types))
      order by c.run_after, c.created_at
      for update skip locked
      limit 1)
  returning j.*;
end;
$$;

revoke all on function public.mkt_claim_job(text, text[]) from public, anon, authenticated;
grant execute on function public.mkt_claim_job(text, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- SEGURANÇA — acesso fechado por padrão.
-- RLS ligado e SEM nenhuma política: a chave pública (anon) e usuários logados
-- não leem nem escrevem nada aqui. Só as funções de servidor (Netlify), com a
-- chave de serviço, acessam — depois de conferir no JWT que a pessoa é gestora.
-- (O aviso "RLS enabled, no policy" do Supabase é esperado e intencional.)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'mkt_agents','mkt_projects','mkt_project_stores','mkt_conversations','mkt_messages',
    'mkt_project_decisions','mkt_agent_runs','mkt_tasks','mkt_task_dependencies',
    'mkt_calendar_events','mkt_assets','mkt_asset_versions','mkt_content',
    'mkt_content_versions','mkt_publication_packages','mkt_approvals','mkt_brand_settings',
    'mkt_integrations','mkt_settings','mkt_ai_usage','mkt_activity_logs','mkt_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$$;
