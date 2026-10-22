// Teste local da function marketing com fetch simulado (nada vai à rede). Rodar: node netlify/functions/__tests__/marketing.test.js
process.env.SUPABASE_SERVICE_KEY = 'svc-test';
process.env.SUPABASE_URL = 'http://sb.test';
var perfil = 'gestor', empresa = 7, calls = [], falhaPost = false;
var PID = '11111111-1111-4111-8111-111111111111';
global.fetch = async function (url, opt) {
  opt = opt || {}; calls.push({ url: url, method: opt.method || 'GET', body: opt.body });
  var J = function (s, o) { return { ok: s < 300, status: s, text: async function () { return JSON.stringify(o); }, json: async function () { return o; } }; };
  if (url.indexOf('/auth/v1/user') > 0) return J(200, { id: 'u1', app_metadata: { perfil: perfil, func_id: 3 } });
  if (url.indexOf('/rest/v1/funcionarias') > 0) return J(200, [{ id: 3, nome: 'G', empresa_id: empresa }]);
  if (url.indexOf('/rest/v1/filiais') > 0) return J(200, [{ id: 1 }]);
  if (url.indexOf('mkt_projects?id=eq.') > 0 && (opt.method || 'GET') === 'GET') return J(200, [{ id: PID, status: 'idea' }]);
  if (opt.method === 'POST') { if (falhaPost) return J(409, {}); return J(201, [{ id: PID, title: 'x' }]); }
  return J(200, []);
};
var h = require('../marketing').handler, pass = 0, fail = 0;
function ok(n, c) { if (c) pass++; else { fail++; console.log('FALHOU:', n); } }
async function call(body, tok) { calls = []; var r = await h({ httpMethod: 'POST', headers: { authorization: tok === undefined ? 'Bearer t' : tok }, body: JSON.stringify(body) }); r.j = JSON.parse(r.body); return r; }
(async function () {
  ok('GET recusado', (await h({ httpMethod: 'GET', headers: {} })).statusCode === 405);
  ok('sem token', (await call({ acao: 'painel' }, '')).statusCode === 401);
  perfil = 'gerente'; ok('gerente barrado', (await call({ acao: 'painel' })).statusCode === 403);
  perfil = 'vendedora'; ok('vendedora barrada', (await call({ acao: 'painel' })).statusCode === 403);
  perfil = 'gestor';
  var r = await call({ acao: 'painel' }); ok('painel 200', r.statusCode === 200 && r.j.projetos);
  ok('painel filtra empresa', calls.filter(function (c) { return c.url.indexOf('/rest/v1/mkt_') > 0; }).every(function (c) { return c.url.indexOf('empresa_id=eq.7') > 0; }));
  ok('acao desconhecida', (await call({ acao: 'x' })).statusCode === 400);
  ok('projeto sem titulo', (await call({ acao: 'projeto_criar' })).statusCode === 400);
  ok('categoria invalida', (await call({ acao: 'projeto_criar', title: 'a', category: 'hack' })).statusCode === 400);
  ok('datas invertidas', (await call({ acao: 'projeto_criar', title: 'a', start_date: '2026-12-10', end_date: '2026-12-01' })).statusCode === 400);
  ok('data inexistente', (await call({ acao: 'projeto_criar', title: 'a', start_date: '2026-02-31' })).statusCode === 400);
  r = await call({ acao: 'projeto_criar', title: 'Promoção de Verão!', empresa_id: 99, store_ids: [1] });
  var post = calls.filter(function (c) { return c.method === 'POST' && c.url.indexOf('mkt_projects') > 0; })[0];
  ok('criar 200', r.statusCode === 200);
  ok('empresa do corpo ignorada', JSON.parse(post.body).empresa_id === 7);
  ok('slug sem acento', JSON.parse(post.body).slug === 'promocao-de-verao');
  ok('log gravado', calls.some(function (c) { return c.url.indexOf('mkt_activity_logs') > 0; }));
  ok('uuid invalido', (await call({ acao: 'projeto_obter', id: "1' or 1=1" })).statusCode === 400);
  ok('tarefa projeto invalido', (await call({ acao: 'tarefa_criar', project_id: 'abc', title: 'a' })).statusCode === 400);
  ok('tarefa ok', (await call({ acao: 'tarefa_criar', project_id: PID, title: 'a', task_type: 'design' })).statusCode === 200);
  ok('tarefa status invalido', (await call({ acao: 'tarefa_atualizar', id: PID, status: 'zz' })).statusCode === 400);
  ok('evento sem data', (await call({ acao: 'evento_criar', title: 'a' })).statusCode === 400);
  ok('evento fim<inicio', (await call({ acao: 'evento_criar', title: 'a', start_at: '2026-11-02T10:00:00Z', end_at: '2026-11-01T10:00:00Z' })).statusCode === 400);
  ok('evento ok', (await call({ acao: 'evento_criar', title: 'a', start_at: '2026-11-02T10:00:00Z' })).statusCode === 200);
  ok('filtro status invalido', (await call({ acao: 'projetos_listar', status: "x&select=*" })).statusCode === 400);
  ok('cor invalida', (await call({ acao: 'config_salvar', marca: { primary_color: 'red' } })).statusCode === 400);
  ok('orcamento negativo', (await call({ acao: 'config_salvar', orcamento: { monthly_budget_brl: -1 } })).statusCode === 400);
  r = await call({ acao: 'config_salvar', marca: { primary_color: '#17e5c3' }, orcamento: { monthly_budget_brl: 100 } });
  ok('config ok', r.statusCode === 200);
  ok('cor normalizada', JSON.parse(calls.filter(function (c) { return c.url.indexOf('mkt_brand_settings') > 0; })[0].body).primary_color === '#17E5C3');
  falhaPost = true; ok('conflito persistente -> 502', (await call({ acao: 'projeto_criar', title: 'a' })).statusCode === 502); falhaPost = false;
  ok('resposta nao expõe chave', JSON.stringify(r).indexOf('svc-test') < 0);
  console.log('passaram', pass, 'falharam', fail); process.exit(fail ? 1 : 0);
})();
