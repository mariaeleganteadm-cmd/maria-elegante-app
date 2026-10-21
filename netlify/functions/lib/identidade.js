// Identidade de quem chama as functions, a partir do JWT do Supabase Auth.
//
// O PERFIL (gestor / gerente / vendedora) e o id da funcionaria vem de app_metadata do
// usuario no Supabase Auth. Esse campo so o servidor (service_role) consegue alterar.
// NUNCA ler o perfil da tabela `funcionarias`: enquanto ela estiver editavel com a chave
// anon (publica no index.html), qualquer pessoa logada poderia se promover a gestora.
//
// Atencao: ativa, data_demissao, empresa_id, modulos, azul_vendedor_codigo e a filial ainda
// vem da tabela e continuam editaveis ate o RLS por perfil ser concluido.

var PERFIS = ['gestor', 'gerente', 'vendedora'];

function sbUrl() {
  return process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
}

function hoje() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function falha(status, codigo, mensagem) {
  return { ok: false, status: status, codigo: codigo, mensagem: mensagem };
}

// Retorna { ok:true, uid, perfil, funcId, funcionaria } ou { ok:false, status, codigo, mensagem }
async function identificar(token) {
  var svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return falha(500, 'SERVIDOR_NAO_CONFIGURADO', 'Servidor sem configuração.');
  if (!token) return falha(401, 'NAO_AUTENTICADO', 'Faça login com seu e-mail.');
  var H = { apikey: svc, Authorization: 'Bearer ' + svc };
  try {
    var ru = await fetch(sbUrl() + '/auth/v1/user', { headers: { apikey: svc, Authorization: 'Bearer ' + token } });
    if (!ru.ok) return falha(401, 'NAO_AUTENTICADO', 'Sessão inválida. Entre novamente.');
    var u = await ru.json();
    var am = u.app_metadata || {};
    var funcId = parseInt(am.func_id, 10);
    if (PERFIS.indexOf(am.perfil) < 0 || !funcId) {
      return falha(403, 'PERFIL_NAO_CONFIGURADO', 'Seu acesso ainda não foi liberado. Fale com a gestora.');
    }
    var rf = await fetch(sbUrl() + '/rest/v1/funcionarias?id=eq.' + funcId + '&ativa=eq.true&or=(data_demissao.is.null,data_demissao.gt.' + hoje() + ')&select=id,nome,empresa_id,modulos,azul_vendedor_codigo,filiais(azul_filial)', { headers: H });
    var rows = rf.ok ? await rf.json() : [];
    if (!rows.length) return falha(403, 'SEM_PERMISSAO', 'Usuária não encontrada ou inativa.');
    return { ok: true, uid: u.id, perfil: am.perfil, funcId: funcId, funcionaria: rows[0] };
  } catch (e) {
    return falha(502, 'FALHA', 'Não foi possível verificar o acesso agora.');
  }
}

// Grava perfil e func_id no app_metadata (mescla com o que ja existe). So o servidor chama.
async function definirAppMetadata(uid, perfil, funcId) {
  var svc = process.env.SUPABASE_SERVICE_KEY;
  var r = await fetch(sbUrl() + '/auth/v1/admin/users/' + encodeURIComponent(uid), {
    method: 'PUT',
    headers: { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_metadata: { perfil: perfil, func_id: funcId } })
  });
  return r.ok;
}

async function appMetadataDe(uid) {
  var svc = process.env.SUPABASE_SERVICE_KEY;
  var r = await fetch(sbUrl() + '/auth/v1/admin/users/' + encodeURIComponent(uid), {
    headers: { apikey: svc, Authorization: 'Bearer ' + svc }
  });
  if (!r.ok) return null;
  var j = await r.json();
  return j.app_metadata || {};
}

module.exports = {
  PERFIS: PERFIS,
  identificar: identificar,
  definirAppMetadata: definirAppMetadata,
  appMetadataDe: appMetadataDe
};
