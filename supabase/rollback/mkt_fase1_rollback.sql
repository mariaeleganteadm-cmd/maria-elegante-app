-- ============================================================================
-- ROLLBACK da Central de Marketing — Fase 1
-- Remove TODAS as tabelas, funções e gatilhos criados pelas migrations
-- 20261022150001 a 20261022150004 (somente objetos com prefixo mkt_).
--
-- ⚠ DESTRUTIVO: apaga os dados das tabelas mkt_*. NÃO toca em nenhuma tabela do app
-- (empresas, filiais, funcionarias, vendas, estoque, holerites etc.).
-- NÃO rodar automaticamente. Só executar com autorização expressa e, se já houver
-- dados reais no módulo, depois de um backup.
-- ============================================================================

begin;

-- Esta função devolve linhas de mkt_jobs; precisa sair antes das tabelas.
drop function if exists public.mkt_claim_job(text, text[]);

drop table if exists
  public.mkt_jobs,
  public.mkt_activity_logs,
  public.mkt_ai_usage,
  public.mkt_settings,
  public.mkt_integrations,
  public.mkt_brand_settings,
  public.mkt_approvals,
  public.mkt_publication_packages,
  public.mkt_content_versions,
  public.mkt_content,
  public.mkt_asset_versions,
  public.mkt_assets,
  public.mkt_calendar_events,
  public.mkt_task_dependencies,
  public.mkt_tasks,
  public.mkt_agent_runs,
  public.mkt_project_decisions,
  public.mkt_messages,
  public.mkt_conversations,
  public.mkt_project_stores,
  public.mkt_projects,
  public.mkt_agents;

-- Funções de gatilho: só podem sair depois que as tabelas (e seus gatilhos) foram removidas.
drop function if exists public.mkt_check_approval_entity();
drop function if exists public.mkt_protect_approved_version();
drop function if exists public.mkt_check_task_dependency();
drop function if exists public.mkt_tasks_before_write();
drop function if exists public.mkt_set_updated_at();

commit;
