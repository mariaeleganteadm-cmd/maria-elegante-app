# Central de Marketing — Fase 2: interface (sem IA)

Estado: **pronta na branch `marketing`, ainda não publicada**. Nada vai ao ar até a branch ser mesclada na `main`, o que depende de autorização do Jonatas.

## O que entrega
- Card **Marketing** na tela inicial, **só para o perfil gestor**.
- Telas: Painel, Projetos (lista, detalhe, criar/editar/arquivar, tarefas e datas do projeto), Calendário (mês, filtros por loja/tipo/situação, criar/editar datas), Biblioteca (somente leitura por enquanto), Configurações (identidade da marca `#17E5C3`, orçamento de IA, estado das conexões).
- Assistente de IA e Estúdio aparecem como "em breve" (Fases 3 e 7). Nenhuma chamada a IA é feita.
- Visual do app (verde-água). A cor da marca só aparece na prévia das configurações e nos materiais futuros.

## Arquivos
| Arquivo | Para quê |
|---|---|
| `netlify/functions/marketing.js` | único caminho para as tabelas `mkt_*` (chave de serviço só no servidor) |
| `marketing/marketing.js`, `marketing/marketing.css` | telas, carregadas só quando o gestor abre o módulo |
| `index.html` | 4 pontos mínimos: card, entrada do módulo, barra inferior e carregador |
| `netlify/functions/__tests__/marketing.test.js` | teste com `fetch` simulado: `node netlify/functions/__tests__/marketing.test.js` |

## Segurança
- Exige JWT válido e `perfil = gestor` (vindo do `app_metadata`, via `lib/identidade.js`). Gerente e vendedora recebem 403.
- `empresa_id` vem sempre da identidade; o que vier no corpo é ignorado. Todas as consultas filtram por ele.
- Entradas validadas (uuid, datas, listas de valores, tamanhos); filtros nunca são concatenados sem validação.
- Alterações gravam em `mkt_activity_logs` (sem segredos). Projetos são arquivados, não apagados.
- Respostas de erro não expõem detalhes internos nem chaves.

## Testes realizados
- Função: 29 verificações passando (permissões, isolamento por empresa, validações, slug, conflito).
- Telas: navegador (Chromium) em 390 px com API simulada: 5 telas + detalhe + formulários, sem erro de JavaScript, sem rolagem horizontal, texto escapado.
- **Não testado com dados reais**: a função não roda contra produção a partir daqui (a chave de serviço só existe no Netlify). Verificar após o deploy.

## Limitações
- Biblioteca só lista; envio de arquivos vem com o Google Drive (Fase 6).
- Mensagens de erro/sucesso usam o aviso nativo do navegador (`alert`); pode ser trocado por toast depois.
- O service worker não guarda `/marketing/*` em cache offline (sempre rede).
