// Netlify Function: proxy entre o app Maria Elegante e a Azul API (v1.3.12)
// A chave fica SOMENTE em process.env.AZUL_API_KEY (Netlify -> Environment Variables).
// Toda chamada exige o login do app (header Authorization: Bearer <JWT do Supabase Auth>).
//
// Permissoes:
//   gestor     -> todos os endpoints
//   gerente    -> vendas, vendas/totalizador e vendas/itens, travado na filial dela
//   vendedora  -> somente vendas/totalizador, travado na filial e no codigo de vendedor dela
//
// Exemplo (gestora):
//   /.netlify/functions/azul-proxy?path=vendas&filial=1&dataInicial=2026-10-01&dataFinal=2026-10-15

var auth = require('./lib/azul-auth');
var identidade = require('./lib/identidade');

var BASE_URL = 'https://api.azulsistemas.com.br';

var PATHS_PERMITIDOS = {
  'nfe': true,
  'nfe/xml': true,
  'vendas': true,
  'vendas/itens': true,
  'vendas/pagamentos': true,
  'vendas/totalizador': true,
  'clientes': true,
  'empresas': true,
  'vendedores': true,
  'linhas': true,
  'marcas': true,
  'cores': true,
  'produtos': true,
  'produtos/variacoes': true,
  'produtos/foto': true
};

// Paths liberados para gerente e vendedora (escopo forcado no servidor)
var PATHS_METAS = { 'vendas/totalizador': true, 'vendas': true };

var PATHS_BINARIOS = { 'produtos/foto': true };

// Login novo: o token e o JWT do Supabase Auth. O perfil vem do app_metadata do usuario
// (so o servidor altera); o restante do cadastro (filial, codigo Azul, modulos) vem da tabela.
var cacheSb = {};
async function claimsDoSupabase(token) {
  if (!token) return null;
  var c = cacheSb[token];
  if (c && c.t > Date.now() - 60000) return c.v;
  var id = await identidade.identificar(token);
  if (!id.ok) return null;
  var f = id.funcionaria;
  var mods = f.modulos || [];
  var v = {
    role: id.perfil,
    fil: f.filiais && f.filiais.azul_filial,
    vend: f.azul_vendedor_codigo,
    fin: id.perfil === 'gestor' ? mods.indexOf('financeiro') >= 0 : false,
    est: mods.indexOf('estoque') >= 0
  };
  cacheSb = {};
  cacheSb[token] = { t: Date.now(), v: v };
  return v;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return auth.resposta(405, { erro: true, codigo: 'METODO_NAO_PERMITIDO', mensagem: 'Use GET.' });
  }

  var apiKey = process.env.AZUL_API_KEY;
  if (!apiKey) {
    return auth.resposta(500, { erro: true, codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'AZUL_API_KEY nao configurada no Netlify.' });
  }

  // 1) Quem esta chamando?
  var tokenRecebido = auth.tokenDoHeader(event);
  var claims = await claimsDoSupabase(tokenRecebido);
  if (!claims) {
    return auth.resposta(401, { erro: true, codigo: 'NAO_AUTENTICADO', mensagem: 'Sessao invalida ou expirada. Entre novamente.' });
  }

  var params = event.queryStringParameters || {};
  var path = String(params.path || '').replace(/^\/+|\/+$/g, '');

  if (!PATHS_PERMITIDOS[path]) {
    return auth.resposta(400, { erro: true, codigo: 'PATH_INVALIDO', mensagem: 'Endpoint nao permitido: ' + path });
  }

  // 2) O perfil pode usar esse endpoint?
  var forcados = {};
  if (claims.role === 'gestor') {
    // acesso total (gestor sem o modulo Financeiro so ve o que as Metas usam)
    if (claims.fin === false && !PATHS_METAS[path]) {
      return auth.resposta(403, { erro: true, codigo: 'SEM_PERMISSAO', mensagem: 'Seu usuario nao tem acesso ao Financeiro.' });
    }
  } else if (claims.role === 'gerente' || claims.role === 'vendedora') {
    // gerente tambem le os itens das vendas (estoque), sempre travado na filial dela; vendedora nao
    // escopo=estoque: quem tem o modulo Estoque le as vendas da loja inteira (so da propria filial) para atualizar o saldo
    var escopoEstoque = params.escopo === 'estoque' && claims.est && (path === 'vendas' || path === 'vendas/itens');
    if (!PATHS_METAS[path] && !escopoEstoque && !(claims.role === 'gerente' && path === 'vendas/itens')) {
      return auth.resposta(403, { erro: true, codigo: 'SEM_PERMISSAO', mensagem: 'Seu perfil nao tem acesso a este dado.' });
    }
    if (!claims.fil || (claims.role === 'vendedora' && !claims.vend && !escopoEstoque)) {
      return auth.resposta(403, { erro: true, codigo: 'MAPEAMENTO_AZUL_PENDENTE', mensagem: 'Seu cadastro ainda nao esta ligado a Azul. Fale com a gestora.' });
    }
    forcados.filial = String(claims.fil);
    if (claims.role === 'vendedora' && !escopoEstoque) forcados.vendedor = String(claims.vend);
  } else {
    return auth.resposta(403, { erro: true, codigo: 'SEM_PERMISSAO', mensagem: 'Perfil sem acesso.' });
  }

  // 3) Monta a consulta: parametros do cliente + escopo forcado (o forcado sempre vence)
  var qs = new URLSearchParams();
  Object.keys(params).forEach(function (k) {
    if (k !== 'path' && k !== 'escopo' && !(k in forcados)) qs.append(k, params[k]);
  });
  Object.keys(forcados).forEach(function (k) { qs.append(k, forcados[k]); });

  var url = BASE_URL + '/api/v1/' + path;
  var q = qs.toString();
  if (q) url += '?' + q;

  try {
    var r = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }
    });

    var tipo = r.headers.get('content-type') || 'application/json; charset=utf-8';
    var headers = { 'Content-Type': tipo, 'Cache-Control': 'no-store' };
    var reqId = r.headers.get('x-request-id');
    if (reqId) headers['X-Request-Id'] = reqId;

    if (PATHS_BINARIOS[path] && r.ok) {
      var buf = Buffer.from(await r.arrayBuffer());
      headers['Cache-Control'] = 'private, max-age=3600';
      return { statusCode: r.status, headers: headers, body: buf.toString('base64'), isBase64Encoded: true };
    }

    var texto = await r.text();
    return { statusCode: r.status, headers: headers, body: texto };
  } catch (e) {
    return auth.resposta(502, { erro: true, codigo: 'FALHA_AO_CHAMAR_AZUL', mensagem: 'Nao foi possivel falar com a Azul API.' });
  }
};
