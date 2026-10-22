-- ============================================================================
-- Central de Marketing — Fase 1, migration 2 de 4: planejamento
-- Tarefas, dependências (sem ciclos) e calendário.
-- Depende de: 20261022150001_mkt_01_base.sql
-- ADITIVA: só cria objetos novos com prefixo mkt_.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- mkt_tasks
-- dedupe_key: chave opcional para impedir tarefas duplicadas no mesmo projeto
-- (o backend a monta, por exemplo, com tipo + data + canal).
-- completed_at é mantido automaticamente pelo gatilho abaixo.
-- ---------------------------------------------------------------------------
create table public.mkt_tasks (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           bigint not null references public.empresas(id) on delete restrict,
  project_id           uuid not null references public.mkt_projects(id) on delete restrict,
  title                text not null,
  description          text,
  task_type            text not null default 'other',
  status               text not null default 'todo',
  priority             text not null default 'normal',
  responsible_user_id  bigint references public.funcionarias(id) on delete restrict,
  assigned_agent_id    uuid references public.mkt_agents(id) on delete restrict,
  due_at               timestamptz,
  completed_at         timestamptz,
  dedupe_key           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint mkt_tasks_title_len check (length(btrim(title)) between 1 and 200),
  constraint mkt_tasks_type check (task_type in
    ('strategy','planning','copywriting','design','video','publication','review','other')),
  constraint mkt_tasks_status check (status in ('todo','in_progress','blocked','review','done','cancelled')),
  constraint mkt_tasks_priority check (priority in ('low','normal','high'))
);

create or replace function public.mkt_tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'done' then
    new.completed_at = coalesce(new.completed_at, now());
  else
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger mkt_tasks_before_write before insert or update on public.mkt_tasks
  for each row execute function public.mkt_tasks_before_write();

create unique index mkt_tasks_dedupe_uk on public.mkt_tasks (project_id, dedupe_key)
  where dedupe_key is not null;
create index mkt_tasks_project_idx on public.mkt_tasks (project_id, status);
create index mkt_tasks_due_idx on public.mkt_tasks (empresa_id, due_at)
  where status not in ('done','cancelled');
create index mkt_tasks_responsible_idx on public.mkt_tasks (responsible_user_id)
  where responsible_user_id is not null;

-- ---------------------------------------------------------------------------
-- mkt_task_dependencies — "task_id depende de depends_on_task_id"
-- Regras no banco: sem auto-dependência, mesmo projeto, sem ciclos.
-- ---------------------------------------------------------------------------
create table public.mkt_task_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.mkt_tasks(id) on delete cascade,
  depends_on_task_id  uuid not null references public.mkt_tasks(id) on delete cascade,
  created_at          timestamptz not null default now(),
  constraint mkt_task_deps_not_self check (task_id <> depends_on_task_id),
  constraint mkt_task_deps_uk unique (task_id, depends_on_task_id)
);
create index mkt_task_deps_depends_idx on public.mkt_task_dependencies (depends_on_task_id);

create or replace function public.mkt_check_task_dependency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_proj_a uuid;
  v_proj_b uuid;
begin
  select project_id into v_proj_a from public.mkt_tasks where id = new.task_id;
  select project_id into v_proj_b from public.mkt_tasks where id = new.depends_on_task_id;

  if v_proj_a is null or v_proj_b is null or v_proj_a <> v_proj_b then
    raise exception 'Dependências só são permitidas entre tarefas do mesmo projeto'
      using errcode = '23514';
  end if;

  -- Ciclo: depends_on_task_id já depende (direta ou indiretamente) de task_id?
  if exists (
    with recursive up(id) as (
      select d.depends_on_task_id
        from public.mkt_task_dependencies d
       where d.task_id = new.depends_on_task_id and d.id <> new.id
      union
      select d.depends_on_task_id
        from public.mkt_task_dependencies d
        join up on d.task_id = up.id
       where d.id <> new.id
    )
    select 1 from up where up.id = new.task_id
  ) then
    raise exception 'Dependência cíclica não permitida' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger mkt_task_deps_check before insert or update on public.mkt_task_dependencies
  for each row execute function public.mkt_check_task_dependency();

-- ---------------------------------------------------------------------------
-- mkt_calendar_events
-- status 'suggested' = data sugerida pela IA; 'confirmed' = confirmada pelo
-- administrador (a spec exige não confundir as duas).
-- store_id é opcional (evento específico de uma loja).
-- ---------------------------------------------------------------------------
create table public.mkt_calendar_events (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  bigint not null references public.empresas(id) on delete restrict,
  project_id  uuid references public.mkt_projects(id) on delete restrict,
  task_id     uuid references public.mkt_tasks(id) on delete set null,
  store_id    bigint references public.filiais(id) on delete restrict,
  title       text not null,
  description text,
  event_type  text not null default 'other',
  start_at    timestamptz not null,
  end_at      timestamptz,
  timezone    text not null default 'America/Sao_Paulo',
  status      text not null default 'suggested',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mkt_events_title_len check (length(btrim(title)) between 1 and 200),
  constraint mkt_events_type check (event_type in
    ('campaign','task','publication','deadline','reminder','other')),
  constraint mkt_events_status check (status in ('suggested','confirmed','done','cancelled')),
  constraint mkt_events_range check (end_at is null or end_at >= start_at)
);
create trigger mkt_events_updated_at before update on public.mkt_calendar_events
  for each row execute function public.mkt_set_updated_at();
create index mkt_events_empresa_start_idx on public.mkt_calendar_events (empresa_id, start_at);
create index mkt_events_project_idx on public.mkt_calendar_events (project_id);
create index mkt_events_task_idx on public.mkt_calendar_events (task_id) where task_id is not null;
