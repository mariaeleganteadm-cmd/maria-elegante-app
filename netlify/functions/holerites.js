// Netlify Function: holerites
// Único caminho do app para ler/gravar as tabelas `holerites` e `holerite_lotes`
// (elas ficam fechadas para a chave anon, com RLS ligado e sem políticas).
// Exige o login (JWT do Supabase Auth). A chave de serviço fica só em process.env.
//
// Ações (POST, corpo JSON { acao, ... }):
//   meus     -> qualquer funcionária ativa: lista só os próprios holerites
//   assinar  -> qualquer funcionária ativa: confirma a assinatura do próprio holerite { id }
//   listar   -> gestor: holerites e últimos lotes da empresa
//   importar -> gestor: cria o lote e os holerites { mes, ano, pdf_nome, func_ids[] }
//   marcar   -> gestor: { id, status } ou { todos:true, mes, ano } (pendente -> enviado)
//
// Variável opcional HOLERITES_ADMIN_FUNC_IDS (ex.: "1,7"): se definida, só esses ids
// de funcionária (que também precisam ser gestores) podem listar/importar/marcar.

function resp(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { codigo: 'METODO_NAO_PERMITIDO', mensagem: 'Use POST.' });
  var sbUrl = process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
  var svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return resp(500, { codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'Servidor sem configuração.' });
  var H = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

  async function rest(metodo, caminho, corpo, retornar) {
    var h = Object.assign({}, H);
    if (retornar) h.Prefer = 'return=representation';
    var r = await fetch(sbUrl + '/rest/v1/' + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    var tx = await r.text();
    var j = [];
    try { j = tx ? JSON.parse(tx) : []; } catch (e) {}
    return { ok: r.ok, status: r.status, j: j };
  }

  // 1) Quem chama? Precisa de JWT válido de uma funcionária ativa.
  var m = /^Bearer (.+)$/.exec((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  if (!m) return resp(401, { codigo: 'NAO_AUTENTICADO', mensagem: 'Faça login com seu e-mail.' });
  var ru = await fetch(sbUrl + '/auth/v1/user', { headers: { apikey: svc, Authorization: 'Bearer ' + m[1] } });
  if (!ru.ok) return resp(401, { codigo: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida. Entre novamente.' });
  var uid = (await ru.json()).id;
  var limite = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  var rq = await rest('GET', 'funcionarias?auth_user_id=eq.' + encodeURIComponent(uid) + '&ativa=eq.true&or=(data_demissao.is.null,data_demissao.gt.' + limite + ')&select=id,nome,perfil,empresa_id');
  var quem = rq.ok && rq.j.length ? rq.j[0] : null;
  if (!quem) return resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'Usuária não encontrada ou inativa.' });

  var admins = String(process.env.HOLERITES_ADMIN_FUNC_IDS || '').split(',').map(function (s) { return parseInt(s, 10); }).filter(Boolean);
  var ehAdmin = quem.perfil === 'gestor' && (!admins.length || admins.indexOf(quem.id) >= 0);

  var corpo = {};
  try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  var acao = String(corpo.acao || '');
  var emp = quem.empresa_id;
  var eq = emp ? '&empresa_id=eq.' + emp : '';

  function exigirAdmin() { return ehAdmin ? null : resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'Sem permissão para gerenciar holerites.' }); }
  function inteiro(v, min, max) { var n = parseInt(v, 10); return n >= min && n <= max ? n : null; }

  try {
    // ── funcionária: só os próprios ──
    if (acao === 'meus') {
      var rm = await rest('GET', 'holerites?func_id=eq.' + quem.id + '&select=id,mes,ano,status,assinado_em&order=ano.desc,mes.desc');
      if (!rm.ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível carregar.' });
      return resp(200, { holerites: rm.j });
    }
    if (acao === 'assinar') {
      var idA = inteiro(corpo.id, 1, 2147483647);
      if (!idA) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Holerite inválido.' });
      var ra = await rest('PATCH', 'holerites?id=eq.' + idA + '&func_id=eq.' + quem.id, { status: 'assinado', assinado_em: new Date().toISOString() }, true);
      if (!ra.ok || !ra.j.length) return resp(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Holerite não encontrado.' });
      return resp(200, { ok: true });
    }

    // ── gestor ──
    if (acao === 'listar') {
      var n1 = exigirAdmin(); if (n1) return n1;
      var rl = await Promise.all([
        rest('GET', 'holerites?select=id,func_id,mes,ano,status,enviado_em,assinado_em,lote_id' + eq + '&order=created_at.desc'),
        rest('GET', 'holerite_lotes?select=id,mes,ano,pdf_nome,total_encontrados,status,created_at' + eq + '&order=created_at.desc&limit=5')
      ]);
      if (!rl[0].ok || !rl[1].ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível carregar.' });
      return resp(200, { holerites: rl[0].j, lotes: rl[1].j });
    }

    if (acao === 'importar') {
      var n2 = exigirAdmin(); if (n2) return n2;
      var mes = inteiro(corpo.mes, 1, 12), ano = inteiro(corpo.ano, 2024, 2100);
      var ids = (Array.isArray(corpo.func_ids) ? corpo.func_ids : []).map(function (v) { return parseInt(v, 10); }).filter(Boolean);
      ids = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
      if (!mes || !ano || !ids.length || ids.length > 500) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Dados do lote inválidos.' });
      var pdfNome = String(corpo.pdf_nome || '').slice(0, 200);
      var lista = ids.join(',');

      var rf = await rest('GET', 'funcionarias?id=in.(' + lista + ')' + eq + '&select=id');
      if (!rf.ok || rf.j.length !== ids.length) return resp(400, { codigo: 'FUNCIONARIA_INVALIDA', mensagem: 'Há funcionárias que não pertencem à empresa.' });

      var rlote = await rest('POST', 'holerite_lotes', { empresa_id: emp, mes: mes, ano: ano, pdf_nome: pdfNome, total_encontrados: ids.length, status: 'pronto' }, true);
      if (!rlote.ok || !rlote.j.length) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível criar o lote.' });
      var loteId = rlote.j[0].id;

      var rex = await rest('GET', 'holerites?mes=eq.' + mes + '&ano=eq.' + ano + '&func_id=in.(' + lista + ')' + eq + '&select=id,func_id');
      var existentes = rex.ok ? rex.j : [];
      var jaTem = {};
      existentes.forEach(function (e) { jaTem[e.func_id] = e.id; });
      if (existentes.length) {
        var rp = await rest('PATCH', 'holerites?id=in.(' + existentes.map(function (e) { return e.id; }).join(',') + ')' + eq, { lote_id: loteId, status: 'pendente' });
        if (!rp.ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível atualizar os holerites.' });
      }
      var novos = ids.filter(function (id) { return !jaTem[id]; }).map(function (id) {
        return { empresa_id: emp, func_id: id, mes: mes, ano: ano, status: 'pendente', lote_id: loteId };
      });
      if (novos.length) {
        var rn = await rest('POST', 'holerites', novos);
        if (!rn.ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível criar os holerites.' });
      }
      return resp(200, { ok: true, lote_id: loteId, total: ids.length });
    }

    if (acao === 'marcar') {
      var n3 = exigirAdmin(); if (n3) return n3;
      var agora = new Date().toISOString();
      if (corpo.todos) {
        var mesT = inteiro(corpo.mes, 1, 12), anoT = inteiro(corpo.ano, 2024, 2100);
        if (!mesT || !anoT) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Mês inválido.' });
        var rt = await rest('PATCH', 'holerites?status=eq.pendente&mes=eq.' + mesT + '&ano=eq.' + anoT + eq, { status: 'enviado', enviado_em: agora }, true);
        if (!rt.ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível atualizar.' });
        return resp(200, { ok: true, total: rt.j.length });
      }
      var idM = inteiro(corpo.id, 1, 2147483647);
      var st = String(corpo.status || '');
      if (!idM || (st !== 'enviado' && st !== 'assinado')) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Dados inválidos.' });
      var dados = st === 'enviado' ? { status: 'enviado', enviado_em: agora } : { status: 'assinado', assinado_em: agora };
      var rk = await rest('PATCH', 'holerites?id=eq.' + idM + eq, dados, true);
      if (!rk.ok || !rk.j.length) return resp(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Holerite não encontrado.' });
      return resp(200, { ok: true });
    }

    return resp(400, { codigo: 'ACAO_INVALIDA', mensagem: 'Ação desconhecida.' });
  } catch (e) {
    console.error('holerites:', e);
    return resp(500, { codigo: 'ERRO', mensagem: 'Erro inesperado.' });
  }
};
