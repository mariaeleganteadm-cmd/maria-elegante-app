# Central de Marketing — Fase 1: banco de dados

Estado: **aplicada no Supabase de produção em 22/10/2026**, com autorização do Jonatas, depois de testada
em Postgres local.

## Aplicação em produção

Foram aplicadas as 4 migrations, em ordem, pelo `apply_migration`. No Supabase elas ficaram registradas
como `mkt_01_base`, `mkt_02_planejamento`, `mkt_03_materiais` e `mkt_04_custos_fila_seguranca`
(versões 20261022135536 a 20261022135631). Os arquivos deste repositório têm numeração própria
(`20261022150001`…), mas o mesmo conteúdo; só os comentários do SQL não foram enviados.

Conferido depois da aplicação (somente leitura): 22 tabelas `mkt_*`, as 22 com RLS ligado e 0 políticas;
`anon` e `authenticated` sem nenhum acesso às tabelas e sem permissão de executar `mkt_claim_job`;
`service_role` com acesso; 6 funções e 15 gatilhos; as 27 tabelas já existentes do app sem alteração;
tabelas novas vazias (nenhum dado de teste foi inserido em produção).
O verificador de segurança do Supabase só acrescentou 22 avisos informativos "RLS enabled, no policy",
que são esperados (ver decisão 2). Os demais avisos já existiam antes.

## O que a Fase 1 entrega

22 tabelas `mkt_*` (as 20 da especificação + `mkt_settings` e `mkt_jobs`), 6 funções, índices,
regras de integridade e acesso fechado. Não existe interface nem chamada a IA ainda (Fases 2 em diante).

Arquivos:

| Arquivo | Para quê |
|---|---|
| `supabase/migrations/20261022150001_mkt_01_base.sql` | agentes, projetos, lojas do projeto, conversas, mensagens, decisões, execuções |
| `supabase/migrations/20261022150002_mkt_02_planejamento.sql` | tarefas, dependências (sem ciclos), calendário |
| `supabase/migrations/20261022150003_mkt_03_materiais.sql` | materiais e versões, conteúdos e versões, pacotes de publicação, aprovações, marca, integrações |
| `supabase/migrations/20261022150004_mkt_04_custos_fila_seguranca.sql` | orçamento de IA, consumo, logs, fila de jobs, **RLS fechado** |
| `supabase/rollback/mkt_fase1_rollback.sql` | desfaz tudo da Fase 1 (destrutivo; só com autorização) |
| `supabase/tests/` | teste automatizado das regras, para rodar em Postgres local |

Todas as migrations são **aditivas**: só criam objetos com prefixo `mkt_`. Nenhuma tabela existente
é alterada ou lida; só há chaves estrangeiras para `empresas`, `filiais` e `funcionarias`.

## Decisões de arquitetura

1. **Schema `public` com prefixo `mkt_`**, não um schema `marketing`. A especificação aceita as duas
   formas. O schema dedicado exigiria mudar a configuração de exposição da API do Supabase; o prefixo
   não mexe em nada do que já funciona.
2. **Acesso fechado por padrão.** RLS ligado e nenhuma política; `anon` e `authenticated` sem permissão.
   Só funções Netlify, com a chave de serviço, leem e gravam, depois de confirmar pelo JWT que a pessoa
   é gestora (mesmo modelo de `holerites.js` e `lib/identidade.js`). O aviso do Supabase "RLS enabled,
   no policy" nessas tabelas é esperado e intencional.
3. **IDs compatíveis com o app.** Lojas = `filiais.id` (bigint); pessoas = `funcionarias.id` (bigint);
   todas as tabelas principais têm `empresa_id`. As chaves primárias das tabelas novas são `uuid`.
4. **Estados no banco** (CHECK), em inglês; a interface mostra em português. Projeto: `idea`,
   `discussing`, `proposal`, `awaiting_approval`, `approved`, `in_progress`, `completed`, `cancelled`.
5. **Ideia ≠ decisão.** Uma decisão só vira `confirmed` se tiver quem decidiu e quando (regra do banco).
   Data do calendário tem `suggested` (sugerida pela IA) e `confirmed`.
6. **Exclusão controlada.** FKs com RESTRICT; só tabelas de ligação usam CASCADE. Versão de material
   aprovada não pode ser apagada. Projetos e materiais são arquivados, não excluídos.
7. **Sem segredos no banco.** `mkt_integrations.configuration` e `mkt_activity_logs.details` recusam
   chaves como `api_key`, `token`, `secret`, `password`. Chaves ficam nas variáveis do Netlify.
8. **Arquivos:** só metadados. `storage_provider` = `google_drive` (definitivo, Fase 6) ou
   `supabase_storage` (apoio enquanto o Drive não estiver conectado).
9. **Fila persistente** (`mkt_jobs` + `mkt_claim_job`) para tarefas longas, sem depender do navegador
   nem de uma requisição HTTP aberta. Usa `FOR UPDATE SKIP LOCKED`, tentativas limitadas e recupera
   jobs parados há mais de 15 minutos.
10. **Idempotência:** `idempotency_key` único por empresa em `mkt_jobs` e `mkt_agent_runs`;
    `dedupe_key` único por projeto em `mkt_tasks`.

## Regras garantidas pelo banco

Sem dependência de tarefa consigo mesma, entre projetos diferentes ou em ciclo (direto ou indireto) ·
`completed_at` automático · decisão confirmada exige decisor e data · aprovação só de entidade que
existe, da mesma empresa, sem poder trocar a entidade depois · pacote "publicado manualmente" exige o
status correto · cor da marca em formato `#RRGGBB` (padrão `#17E5C3`) · orçamento padrão R$ 100,00 ·
custos e quantidades não negativos · slug único por empresa.

## Como aplicar (depois da autorização)

Ordem: as 4 migrations, na sequência do nome. Pelo Supabase (SQL Editor ou `apply_migration`).
Antes, conferir que nenhuma tabela `mkt_*` existe. Depois, rodar o verificador de segurança do Supabase.
Para desfazer: `supabase/rollback/mkt_fase1_rollback.sql`.

## Como testar localmente

Precisa de um Postgres 16 descartável (nunca produção), com banco em UTF-8:

1. `supabase/tests/stub_supabase.sql` (cria papéis e as 3 tabelas de apoio)
2. as 4 migrations, em ordem
3. `supabase/tests/mkt_fase1_tests.sql` — esperado: `falhou = 0`

Último resultado: 56 passaram, 0 falharam. O rollback também foi testado (remove tudo, preserva as
tabelas do app, e as migrations reaplicam depois).

## Limitações conhecidas

- **Busca textual em português:** o dicionário do Postgres não une singular e plural de palavras com
  "-ção" (`promoção` ≠ `promoções`). Palavras comuns como `loja`/`lojas` funcionam. Se virar problema,
  complementar com `unaccent` + `pg_trgm` (ambas disponíveis, não instaladas) na Fase 3.
- **Agentes sem cadastro inicial:** `mkt_agents` nasce vazia. Os 7 agentes e seus textos de instrução
  entram junto com o orquestrador (Fase 3).
- **`mkt_approvals` é polimórfica** (sem FK). A integridade vem do gatilho; por isso as entidades do
  módulo não são apagadas de verdade.
- **Isolamento entre empresas** depende de o backend sempre filtrar por `empresa_id` (hoje há 1 empresa).
  O gatilho de aprovações já impede cruzar empresas.
- **Datas "sexta-feira":** a conversão para data absoluta é responsabilidade do backend (Planejador),
  no fuso `America/Sao_Paulo`.

## Observação sobre o resto do banco (fora do escopo desta fase)

Na auditoria, quase todas as tabelas já existentes do app (`funcionarias`, `vendas`, `empresas`,
`comunicados` etc.) têm políticas RLS que liberam leitura, escrita e exclusão para a chave pública.
Só `holerites` foi fechada. As tabelas `mkt_*` NÃO seguem esse padrão. Corrigir as demais é um projeto
separado, porque exige mover as telas do app para funções de servidor.

Atualização (22/10/2026, após a aplicação): existe uma migration que não é desta fase,
`fase1a_politicas_authenticated`, que adicionou cerca de 100 políticas para usuários logados
(`authenticated`) nas tabelas do app. Isso parece ser o primeiro passo de um fechamento, mas as 93
políticas abertas para `anon` (em 25 tabelas) ainda existiam na conferência feita depois dela. O
conteúdo e o plano dessa migration não foram auditados aqui.

## Pendências externas (não bloqueiam a Fase 1)

Chave da OpenAI (Fase 3 e 7) · conexão com o Google Drive (Fase 6) · logo e arquivos oficiais da marca ·
conferir limites do plano do Netlify para funções em segundo plano.
