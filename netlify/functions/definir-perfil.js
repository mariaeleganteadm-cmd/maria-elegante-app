// Netlify Function: definir-perfil
// Gestor troca o perfil (vendedora <-> gerente) de uma funcionária. O servidor grava o perfil
// em duas partes: na tabela funcionarias (para as telas) e no app_metadata do usuário no
// Supabase Auth (que é o que as functions realmente usam para autorizar).
// Não promove ninguém a gestor e não altera quem já é gestor: isso é feito direto no banco.
//
// POST { funcId, perfil }  com Authorization: Bearer <JWT do Supabase Auth> de um gestor.

var identidade = require('./lib/identidade');

function resp(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { codigo: 'METODO_NAO_PERMITIDO', mensagem: 'Use POST.' });
  var sbUrl = process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
  var svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return resp(500, { codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'Servidor sem configuração.' });
  var H = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

  var m = /^Bearer (.+)$/.exec((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  var quem = await identidade.identificar(m ? m[1] : '');
  if (!quem.ok) return resp(quem.status, { codigo: quem.codigo, mensagem: quem.mensagem });
  if (quem.perfil !== 'gestor') return resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'Apenas gestores podem alterar perfis.' });

  var corpo = {};
  try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  var funcId = parseInt(corpo.funcId, 10);
  var perfil = String(corpo.perfil || '');
  if (!funcId || (perfil !== 'vendedora' && perfil !== 'gerente')) {
    return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Informe a funcionária e o perfil (vendedora ou gerente).' });
  }

  var eq = quem.funcionaria.empresa_id ? '&empresa_id=eq.' + quem.funcionaria.empresa_id : '';
  var rf = await fetch(sbUrl + '/rest/v1/funcionarias?id=eq.' + funcId + eq + '&select=id,auth_user_id', { headers: H });
  var fs = rf.ok ? await rf.json() : [];
  if (!fs.length) return resp(404, { codigo: 'NAO_ENCONTRADA', mensagem: 'Funcionária não encontrada.' });
  var alvo = fs[0];

  // Quem já é gestor não muda por aqui (vale o perfil do app_metadata, não o da tabela)
  if (alvo.auth_user_id) {
    var meta = await identidade.appMetadataDe(alvo.auth_user_id);
    if (meta && meta.perfil === 'gestor') return resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'O perfil de gestor não é alterado por aqui.' });
  }

  var rp = await fetch(sbUrl + '/rest/v1/funcionarias?id=eq.' + funcId, { method: 'PATCH', headers: H, body: JSON.stringify({ perfil: perfil }) });
  if (!rp.ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível salvar o perfil.' });
  if (alvo.auth_user_id) {
    var ok = await identidade.definirAppMetadata(alvo.auth_user_id, perfil, funcId);
    if (!ok) return resp(502, { codigo: 'FALHA', mensagem: 'Perfil salvo, mas não foi possível liberar o acesso. Tente de novo.' });
  }
  return resp(200, { ok: true, perfil: perfil });
};
