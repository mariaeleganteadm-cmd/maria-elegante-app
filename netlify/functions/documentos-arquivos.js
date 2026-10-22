// Netlify Function: documentos-arquivos
// Arquivos anexados aos documentos enviados às funcionárias. O arquivo fica no bucket
// PRIVADO `documentos-privados` (sem políticas: só a chave de serviço acessa). A funcionária
// nunca recebe o caminho nem acesso direto: ela pede `abrir`, a função confere se o
// documento é dela e devolve um link assinado que expira em 60 segundos.
// Exige o login (JWT do Supabase Auth). A chave de serviço fica só em process.env.
//
// Ações (POST, corpo JSON { acao, ... }):
//   preparar -> gestor: { tipo_arquivo, tamanho } -> { path, upload_url } (o navegador envia o arquivo para upload_url)
//   criar    -> gestor: { nome, tipo, filial_id, func_ids[], exige_assinatura, arquivo_path, arquivo_nome }
//   abrir    -> gestor ou funcionária com acesso: { id } -> { url, nome }
//   remover  -> gestor: { id } apaga o arquivo e o documento
//
// Quem vê o documento (mesma regra da tela):
//   func_ids preenchido -> só quem está na lista; senão filial_id vazio (todas) ou igual à filial da funcionária.

var crypto = require('crypto');
var identidade = require('./lib/identidade');

var BUCKET = 'documentos-privados';
var MAX_BYTES = 15 * 1024 * 1024;
var EXT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};

function resp(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function inteiro(v, min, max) { var n = parseInt(v, 10); return n >= min && n <= max ? n : null; }

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

  // URL do storage devolvida pelo Supabase vem relativa (/object/...): completa com o host.
  function urlStorage(rel) {
    if (/^https?:\/\//.test(rel)) return rel;
    return sbUrl + '/storage/v1' + (rel.charAt(0) === '/' ? rel : '/' + rel);
  }

  // 1) Quem chama? JWT válido de uma funcionária ativa, com perfil liberado.
  var m = /^Bearer (.+)$/.exec((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  var id = await identidade.identificar(m ? m[1] : '');
  if (!id.ok) return resp(id.status, { codigo: id.codigo, mensagem: id.mensagem });
  var quem = { id: id.funcId, perfil: id.perfil, empresa_id: id.funcionaria.empresa_id };
  var ehGestor = quem.perfil === 'gestor';
  var emp = quem.empresa_id;
  if (!emp) return resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'Usuária sem empresa vinculada.' });

  var corpo = {};
  try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  var acao = String(corpo.acao || '');

  function exigirGestor() { return ehGestor ? null : resp(403, { codigo: 'SEM_PERMISSAO', mensagem: 'Somente a gestora pode fazer isso.' }); }

  try {
    // ── gestor: reserva o lugar do arquivo e devolve o endereço de envio ──
    if (acao === 'preparar') {
      var n1 = exigirGestor(); if (n1) return n1;
      var ext = EXT[String(corpo.tipo_arquivo || '')];
      var tam = inteiro(corpo.tamanho, 1, MAX_BYTES);
      if (!ext) return resp(400, { codigo: 'TIPO_INVALIDO', mensagem: 'Tipo de arquivo não permitido. Use PDF, imagem, Word ou Excel.' });
      if (!tam) return resp(400, { codigo: 'TAMANHO_INVALIDO', mensagem: 'O arquivo precisa ter no máximo 15 MB.' });
      var path = emp + '/' + crypto.randomUUID() + '.' + ext;
      var rs = await fetch(sbUrl + '/storage/v1/object/upload/sign/' + BUCKET + '/' + path, { method: 'POST', headers: H, body: '{}' });
      var js = {};
      try { js = await rs.json(); } catch (e) {}
      if (!rs.ok || !js.url) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível preparar o envio do arquivo.' });
      return resp(200, { path: path, upload_url: urlStorage(js.url) });
    }

    // ── gestor: registra o documento (o arquivo já foi enviado) ──
    if (acao === 'criar') {
      var n2 = exigirGestor(); if (n2) return n2;
      var nome = String(corpo.nome || '').trim().slice(0, 200);
      var tipo = String(corpo.tipo || 'outro').slice(0, 40);
      if (!nome) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Digite o nome do documento.' });
      var ap = String(corpo.arquivo_path || '');
      var okPath = new RegExp('^' + emp + '/[0-9a-f-]{36}\\.(pdf|jpg|png|webp|docx|xlsx)$').test(ap);
      if (!okPath) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Arquivo inválido.' });
      var ri = await fetch(sbUrl + '/storage/v1/object/info/' + BUCKET + '/' + ap, { headers: H });
      if (!ri.ok) return resp(400, { codigo: 'ARQUIVO_NAO_ENVIADO', mensagem: 'O arquivo não chegou ao servidor. Tente enviar de novo.' });

      var ids = (Array.isArray(corpo.func_ids) ? corpo.func_ids : []).map(function (v) { return parseInt(v, 10); }).filter(Boolean);
      ids = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
      var filial = corpo.filial_id ? inteiro(corpo.filial_id, 1, 2147483647) : null;
      if (ids.length) {
        if (ids.length > 500) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Vendedoras demais.' });
        var rf = await rest('GET', 'funcionarias?id=in.(' + ids.join(',') + ')&empresa_id=eq.' + emp + '&select=id');
        if (!rf.ok || rf.j.length !== ids.length) return resp(400, { codigo: 'FUNCIONARIA_INVALIDA', mensagem: 'Há vendedoras que não pertencem à empresa.' });
        filial = null;
      }
      var rc = await rest('POST', 'documentos', {
        nome: nome, tipo: tipo, empresa_id: emp, filial_id: filial,
        func_ids: ids.length ? ids : null,
        exige_assinatura: corpo.exige_assinatura !== false,
        arquivo_path: ap, arquivo_nome: String(corpo.arquivo_nome || '').slice(0, 200)
      }, true);
      if (!rc.ok || !rc.j.length) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível registrar o documento.' });
      return resp(200, { ok: true, id: rc.j[0].id });
    }

    // ── gestor ou funcionária: link temporário do arquivo ──
    if (acao === 'abrir') {
      var idD = inteiro(corpo.id, 1, 9007199254740991);
      if (!idD) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Documento inválido.' });
      var rd = await rest('GET', 'documentos?id=eq.' + idD + '&empresa_id=eq.' + emp + '&select=id,nome,filial_id,func_ids,arquivo_path,arquivo_nome');
      var d = rd.ok && rd.j.length ? rd.j[0] : null;
      // mesma resposta para "não existe" e "não é para você": não revela que o documento existe
      if (!d || !d.arquivo_path) return resp(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Arquivo não encontrado.' });
      if (!ehGestor) {
        var pode = false;
        if (Array.isArray(d.func_ids) && d.func_ids.length) {
          pode = d.func_ids.indexOf(quem.id) >= 0;
        } else {
          var rme = await rest('GET', 'funcionarias?id=eq.' + quem.id + '&select=filial_id');
          var minhaFilial = rme.ok && rme.j.length ? rme.j[0].filial_id : null;
          pode = !d.filial_id || d.filial_id === minhaFilial;
        }
        if (!pode) return resp(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Arquivo não encontrado.' });
      }
      var rsg = await fetch(sbUrl + '/storage/v1/object/sign/' + BUCKET + '/' + d.arquivo_path, { method: 'POST', headers: H, body: JSON.stringify({ expiresIn: 60 }) });
      var jsg = {};
      try { jsg = await rsg.json(); } catch (e) {}
      if (!rsg.ok || !jsg.signedURL) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível abrir o arquivo agora.' });
      return resp(200, { url: urlStorage(jsg.signedURL), nome: d.arquivo_nome || d.nome });
    }

    // ── gestor: apaga o arquivo e o documento ──
    if (acao === 'remover') {
      var n3 = exigirGestor(); if (n3) return n3;
      var idR = inteiro(corpo.id, 1, 9007199254740991);
      if (!idR) return resp(400, { codigo: 'DADOS_INVALIDOS', mensagem: 'Documento inválido.' });
      var rr = await rest('GET', 'documentos?id=eq.' + idR + '&empresa_id=eq.' + emp + '&select=id,arquivo_path');
      if (!rr.ok || !rr.j.length) return resp(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Documento não encontrado.' });
      if (rr.j[0].arquivo_path) {
        var rdel = await fetch(sbUrl + '/storage/v1/object/' + BUCKET + '/' + rr.j[0].arquivo_path, { method: 'DELETE', headers: H });
        if (!rdel.ok && rdel.status !== 404) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível apagar o arquivo.' });
      }
      await rest('DELETE', 'documento_assinaturas?documento_id=eq.' + idR);
      var rdoc = await rest('DELETE', 'documentos?id=eq.' + idR + '&empresa_id=eq.' + emp);
      if (!rdoc.ok) return resp(502, { codigo: 'FALHA', mensagem: 'Não foi possível remover o documento.' });
      return resp(200, { ok: true });
    }

    return resp(400, { codigo: 'ACAO_INVALIDA', mensagem: 'Ação desconhecida.' });
  } catch (e) {
    console.error('documentos-arquivos:', e);
    return resp(500, { codigo: 'ERRO', mensagem: 'Erro inesperado.' });
  }
};
