// Netlify Function: gestor convida (ou reenvia convite/redefinição) para uma funcionária por e-mail.
// Exige o login (JWT) de um gestor ativo. A chave de serviço fica só em process.env.

function resp(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { codigo: 'METODO_NAO_PERMITIDO', mensagem: 'Use POST.' });
  var sbUrl = process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
  var svc = process.env.SUPABASE_SERVICE_KEY;
  var site = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!svc || !site) return resp(500, { codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'Servidor sem configuração.' });
  var H = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

  // 1) Quem chama? Precisa de JWT válido de um gestor ativo.
  var m = /^Bearer (.+)$/.exec((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  if (!m) return resp(401, { codigo: 'NAO_AUTENTICADO', mensagem: 'Faça login.' });
  var ru = await fetch(sbUrl + '/auth/v1/user', { headers: { apikey: svc, Authorization: 'Bearer ' + m[1] } });
  if (!ru.ok) return resp(401, { codigo: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida. Entre novamente.' });
  var uid = (await ru.json()).id;
  var rg = await fetch(sbUrl + '/rest/v1/funcionarias?auth_user_id=eq.' + encodeURIComponent(uid) + '&perfil=eq.gestor&ativa=eq.true&or=(data_demissao.is.null,data_demissao.gt.' + new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) + ')&select=id', { headers: H });
  var gs = rg.ok ? await rg.json() : [];
  if (!gs.length) return resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'Apenas gestores podem convidar.' });

  // 2) Quem será convidada?
  var corpo = {};
  try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  var funcId = parseInt(corpo.funcId, 10);
  if (!funcId) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Funcionária não informada.' });
  var rf = await fetch(sbUrl + '/rest/v1/funcionarias?id=eq.' + funcId + '&select=id,nome,email,auth_user_id', { headers: H });
  var fs = rf.ok ? await rf.json() : [];
  if (!fs.length) return resp(404, { codigo: 'NAO_ENCONTRADA', mensagem: 'Funcionária não encontrada.' });
  var f = fs[0];
  var email = String(f.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp(400, { codigo: 'EMAIL_INVALIDO', mensagem: 'Cadastre um e-mail válido para ' + f.nome + '.' });

  var redirect = encodeURIComponent(site);
  var tipo = 'convite';
  var ri = await fetch(sbUrl + '/auth/v1/invite?redirect_to=' + redirect, { method: 'POST', headers: H, body: JSON.stringify({ email: email }) });
  var ji = {};
  try { ji = await ri.json(); } catch (e) {}
  var authId = ji.id;
  if (!ri.ok) {
    // Já existe conta: manda e-mail de redefinição de senha
    var jaExiste = ri.status === 422 || /already|registered|exists/i.test(JSON.stringify(ji));
    if (!jaExiste) return resp(502, { codigo: 'FALHA_CONVITE', mensagem: 'Não foi possível enviar o e-mail agora.' });
    tipo = 'redefinicao';
    var rr = await fetch(sbUrl + '/auth/v1/recover?redirect_to=' + redirect, { method: 'POST', headers: H, body: JSON.stringify({ email: email }) });
    if (!rr.ok) return resp(502, { codigo: 'FALHA_CONVITE', mensagem: 'Não foi possível enviar o e-mail agora.' });
    if (!f.auth_user_id) {
      var rl = await fetch(sbUrl + '/auth/v1/admin/users?per_page=1000', { headers: H });
      var lj = rl.ok ? await rl.json() : {};
      var achou = (lj.users || []).filter(function (u) { return String(u.email || '').toLowerCase() === email; })[0];
      if (achou) authId = achou.id;
    }
  }
  if (authId && !f.auth_user_id) {
    await fetch(sbUrl + '/rest/v1/funcionarias?id=eq.' + funcId, { method: 'PATCH', headers: H, body: JSON.stringify({ auth_user_id: authId }) });
  }
  return resp(200, { ok: true, tipo: tipo, email: email });
};
