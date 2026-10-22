-- Testes das regras de banco da Central de Marketing (Fase 1).
-- Rodam em um Postgres LOCAL descartável, nunca em produção. Como usar: ver
-- docs/central-marketing/fase-1-banco.md. Ordem: stub_supabase.sql, as 4 migrations, este arquivo.
-- Resultado esperado: todas as linhas PASS (falhou = 0).
\set ON_ERROR_STOP 0
\o /dev/null
create temp table res(nome text, ok boolean);
create or replace function pg_temp.expect_fail(nome text, cmd text) returns void language plpgsql as $$
begin
  begin execute cmd; insert into res values (nome, false);
  exception when others then insert into res values (nome, true); end;
end $$;
create or replace function pg_temp.expect_ok(nome text, cmd text) returns void language plpgsql as $$
begin
  begin execute cmd; insert into res values (nome, true);
  exception when others then insert into res values (nome || ' [' || sqlerrm || ']', false); end;
end $$;

-- dados base
insert into mkt_projects(id, empresa_id, title, slug, created_by) values
 ('00000000-0000-0000-0000-0000000000a1',1,'Rosa Poderosa','rosa-poderosa',1),
 ('00000000-0000-0000-0000-0000000000a2',1,'Outro','outro',1);
insert into mkt_tasks(id, empresa_id, project_id, title) values
 ('00000000-0000-0000-0000-0000000000b1',1,'00000000-0000-0000-0000-0000000000a1','T1'),
 ('00000000-0000-0000-0000-0000000000b2',1,'00000000-0000-0000-0000-0000000000a1','T2'),
 ('00000000-0000-0000-0000-0000000000b3',1,'00000000-0000-0000-0000-0000000000a1','T3'),
 ('00000000-0000-0000-0000-0000000000b9',1,'00000000-0000-0000-0000-0000000000a2','Tx');

-- dependências
select pg_temp.expect_ok('dep b2->b1 aceita', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1')$$);
select pg_temp.expect_ok('dep b3->b2 aceita', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b2')$$);
select pg_temp.expect_fail('ciclo direto b1->b2 barrado', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2')$$);
select pg_temp.expect_fail('ciclo indireto b1->b3 barrado', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b3')$$);
select pg_temp.expect_fail('auto-dependência barrada', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1')$$);
select pg_temp.expect_fail('dep entre projetos barrada', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b9','00000000-0000-0000-0000-0000000000b1')$$);
select pg_temp.expect_fail('dep duplicada barrada', $$insert into mkt_task_dependencies(task_id,depends_on_task_id) values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1')$$);
select pg_temp.expect_ok('UPDATE de dep válida não acusa falso ciclo', $$update mkt_task_dependencies set created_at = now() where task_id='00000000-0000-0000-0000-0000000000b3'$$);

-- tarefas
select pg_temp.expect_ok('tarefa com dedupe_key', $$insert into mkt_tasks(empresa_id,project_id,title,dedupe_key) values (1,'00000000-0000-0000-0000-0000000000a1','Dup','suspense-2026-10-22')$$);
select pg_temp.expect_fail('dedupe_key repetida barrada', $$insert into mkt_tasks(empresa_id,project_id,title,dedupe_key) values (1,'00000000-0000-0000-0000-0000000000a1','Dup2','suspense-2026-10-22')$$);
select pg_temp.expect_ok('mesma dedupe_key em outro projeto ok', $$insert into mkt_tasks(empresa_id,project_id,title,dedupe_key) values (1,'00000000-0000-0000-0000-0000000000a2','Dup','suspense-2026-10-22')$$);
update mkt_tasks set status='done' where id='00000000-0000-0000-0000-0000000000b1';
insert into res select 'completed_at preenchido ao concluir', completed_at is not null from mkt_tasks where id='00000000-0000-0000-0000-0000000000b1';
update mkt_tasks set status='todo' where id='00000000-0000-0000-0000-0000000000b1';
insert into res select 'completed_at limpo ao reabrir', completed_at is null from mkt_tasks where id='00000000-0000-0000-0000-0000000000b1';

-- projetos
select pg_temp.expect_fail('status de projeto inválido barrado', $$insert into mkt_projects(empresa_id,title,slug,status) values (1,'x','x','aprovado')$$);
select pg_temp.expect_fail('slug repetido na empresa barrado', $$insert into mkt_projects(empresa_id,title,slug) values (1,'Y','rosa-poderosa')$$);
select pg_temp.expect_fail('slug inválido barrado', $$insert into mkt_projects(empresa_id,title,slug) values (1,'Y','Rosa Poderosa')$$);
select pg_temp.expect_fail('data fim < início barrada', $$insert into mkt_projects(empresa_id,title,slug,start_date,end_date) values (1,'Z','z','2026-10-24','2026-10-23')$$);
select pg_temp.expect_fail('loja inexistente barrada', $$insert into mkt_project_stores(project_id,store_id) values ('00000000-0000-0000-0000-0000000000a1',999)$$);
select pg_temp.expect_ok('vínculo de loja', $$insert into mkt_project_stores(project_id,store_id) select '00000000-0000-0000-0000-0000000000a1', id from filiais$$);
select pg_temp.expect_fail('empresa inexistente barrada', $$insert into mkt_projects(empresa_id,title,slug) values (99,'W','w')$$);

-- decisões
select pg_temp.expect_ok('decisão proposta sem decisor', $$insert into mkt_project_decisions(id,empresa_id,project_id,decision_text) values ('00000000-0000-0000-0000-0000000000d1',1,'00000000-0000-0000-0000-0000000000a1','Campanha sexta e sábado')$$);
select pg_temp.expect_fail('decisão confirmada sem decisor barrada', $$update mkt_project_decisions set status='confirmed' where id='00000000-0000-0000-0000-0000000000d1'$$);
select pg_temp.expect_ok('decisão confirmada com decisor e data', $$update mkt_project_decisions set status='confirmed', decided_by=1, decided_at=now() where id='00000000-0000-0000-0000-0000000000d1'$$);

-- aprovações
select pg_temp.expect_ok('aprovação de decisão existente', $$insert into mkt_approvals(id,empresa_id,entity_type,entity_id,requested_by) values ('00000000-0000-0000-0000-0000000000e1',1,'decision','00000000-0000-0000-0000-0000000000d1',1)$$);
select pg_temp.expect_fail('aprovação de entidade inexistente barrada', $$insert into mkt_approvals(empresa_id,entity_type,entity_id,requested_by) values (1,'asset','00000000-0000-0000-0000-00000000ffff',1)$$);
select pg_temp.expect_fail('aprovação com tipo errado barrada', $$insert into mkt_approvals(empresa_id,entity_type,entity_id,requested_by) values (1,'content','00000000-0000-0000-0000-0000000000d1',1)$$);
select pg_temp.expect_fail('aprovação de outra empresa barrada', $$insert into mkt_approvals(empresa_id,entity_type,entity_id,requested_by) values (1,'project','00000000-0000-0000-0000-0000000000a1',1) , (1,'project','00000000-0000-0000-0000-00000000ffff',1)$$);
select pg_temp.expect_fail('aprovar sem revisor barrado', $$update mkt_approvals set status='approved' where id='00000000-0000-0000-0000-0000000000e1'$$);
select pg_temp.expect_ok('aprovar com revisor e data', $$update mkt_approvals set status='approved', reviewed_by=1, reviewed_at=now() where id='00000000-0000-0000-0000-0000000000e1'$$);
select pg_temp.expect_fail('trocar entidade da aprovação barrado', $$update mkt_approvals set entity_id='00000000-0000-0000-0000-0000000000a1', entity_type='project' where id='00000000-0000-0000-0000-0000000000e1'$$);

-- materiais
insert into mkt_assets(id,empresa_id,project_id,title) values ('00000000-0000-0000-0000-0000000000f1',1,'00000000-0000-0000-0000-0000000000a1','Arte feed');
insert into mkt_asset_versions(id,asset_id,version_number,is_approved) values ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f1',1,true),('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f1',2,false);
select pg_temp.expect_fail('apagar versão aprovada barrado', $$delete from mkt_asset_versions where id='00000000-0000-0000-0000-0000000000f2'$$);
select pg_temp.expect_ok('apagar versão não aprovada ok', $$delete from mkt_asset_versions where id='00000000-0000-0000-0000-0000000000f3'$$);
select pg_temp.expect_fail('versão repetida barrada', $$insert into mkt_asset_versions(asset_id,version_number) values ('00000000-0000-0000-0000-0000000000f1',1)$$);
select pg_temp.expect_fail('apagar asset com versões barrado', $$delete from mkt_assets where id='00000000-0000-0000-0000-0000000000f1'$$);
select pg_temp.expect_fail('apagar projeto com tarefas barrado', $$delete from mkt_projects where id='00000000-0000-0000-0000-0000000000a1'$$);
select pg_temp.expect_fail('pacote publicado só com status correto', $$insert into mkt_publication_packages(empresa_id,project_id,status,published_at) values (1,'00000000-0000-0000-0000-0000000000a1','ready',now())$$);
select pg_temp.expect_ok('pacote publicado manualmente', $$insert into mkt_publication_packages(empresa_id,project_id,status,published_at) values (1,'00000000-0000-0000-0000-0000000000a1','published_manually',now())$$);

-- marca e integrações
select pg_temp.expect_ok('marca padrão', $$insert into mkt_brand_settings(empresa_id) values (1)$$);
insert into res select 'cor padrão #17E5C3', primary_color='#17E5C3' from mkt_brand_settings;
select pg_temp.expect_fail('cor inválida barrada', $$update mkt_brand_settings set primary_color='verde'$$);
select pg_temp.expect_fail('segredo em integração barrado', $$insert into mkt_integrations(empresa_id,provider,configuration) values (1,'openai','{"api_key":"sk-xxx"}')$$);
select pg_temp.expect_ok('integração sem segredo', $$insert into mkt_integrations(empresa_id,provider,configuration) values (1,'openai','{"model_hint":"imagem"}')$$);
select pg_temp.expect_fail('segredo no log barrado', $$insert into mkt_activity_logs(empresa_id,entity_type,action,details) values (1,'project','x','{"token":"abc"}')$$);
select pg_temp.expect_ok('log normal', $$insert into mkt_activity_logs(empresa_id,actor_user_id,entity_type,entity_id,action) values (1,1,'project','00000000-0000-0000-0000-0000000000a1','created')$$);

-- custos
select pg_temp.expect_ok('orçamento padrão', $$insert into mkt_settings(empresa_id) values (1)$$);
insert into res select 'orçamento padrão R$100', monthly_budget_brl=100 from mkt_settings;
select pg_temp.expect_fail('custo negativo barrado', $$insert into mkt_ai_usage(empresa_id,provider,model,operation_type,estimated_cost_usd) values (1,'openai','m','chat',-1)$$);
select pg_temp.expect_ok('uso de IA', $$insert into mkt_ai_usage(empresa_id,user_id,provider,model,operation_type,image_count,estimated_cost_usd) values (1,1,'openai','m','image_generation',1,0.04)$$);

-- fila
insert into mkt_jobs(id,empresa_id,job_type,idempotency_key) values ('00000000-0000-0000-0000-0000000000c1',1,'generate_image','k1');
select pg_temp.expect_fail('job com idempotency_key repetida barrado', $$insert into mkt_jobs(empresa_id,job_type,idempotency_key) values (1,'generate_image','k1')$$);
create temp table c1 as select * from mkt_claim_job('w1');
insert into res select 'claim reserva o job (running, attempts=1)', count(*)=1 and min(status)='running' and min(attempts)=1 from c1;
create temp table c2 as select * from mkt_claim_job('w2');
insert into res select 'segundo claim não pega job já reservado', count(*)=0 from c2;
update mkt_jobs set status='failed' where id='00000000-0000-0000-0000-0000000000c1';
create temp table c3 as select * from mkt_claim_job('w2');
insert into res select 'job failed é reaproveitado (attempts=2)', count(*)=1 and min(attempts)=2 from c3;
update mkt_jobs set status='failed', attempts=3 where id='00000000-0000-0000-0000-0000000000c1';
create temp table c4 as select * from mkt_claim_job('w2');
insert into res select 'job sem tentativas sobrando não é reservado', count(*)=0 from c4;
update mkt_jobs set status='running', attempts=1, locked_at=now()-interval '20 minutes' where id='00000000-0000-0000-0000-0000000000c1';
create temp table c5 as select * from mkt_claim_job('w3');
insert into res select 'job running parado >15min é recuperado', count(*)=1 from c5;

-- busca textual
insert into mkt_content(empresa_id,project_id,title,body) values (1,'00000000-0000-0000-0000-0000000000a1','Legenda','Venha conhecer a promoção Rosa Poderosa nas lojas');
-- Limitação conhecida do stemmer 'portuguese' do Postgres: 'promoção' e 'promoções' geram
-- radicais diferentes ('promoçã' x 'promoçõ'), então o plural NÃO acha o singular em palavras com -ção.
-- Por isso o teste usa a mesma forma da palavra. Ver docs/central-marketing/fase-1-banco.md.
insert into res select 'busca textual em português (mesma forma da palavra)', count(*)=1 from mkt_content where to_tsvector('portuguese', coalesce(title,'')||' '||coalesce(body,'')) @@ websearch_to_tsquery('portuguese','promoção');
insert into res select 'busca textual: loja acha lojas', count(*)=1 from mkt_content where to_tsvector('portuguese', coalesce(title,'')||' '||coalesce(body,'')) @@ websearch_to_tsquery('portuguese','loja');

\o
-- resultado
select case when ok then 'PASS' else 'FAIL' end as r, nome from res order by ok, nome;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from res;
