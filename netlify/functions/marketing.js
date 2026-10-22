// Netlify Function: marketing  (Central Inteligente de Marketing — Fase 2, sem IA)
// Único caminho do app para as tabelas mkt_* (RLS ligado, sem políticas, fechadas para anon/authenticated).
// Exige login (JWT do Supabase Auth) E perfil "gestor". A chave de serviço fica só em process.env.
// Todo acesso é filtrado pela empresa do gestor que chama (empresa_id vem da identidade, nunca do corpo).
//
// POST { acao, ... }. Ações:
//   painel
//   lojas
//   projetos_listar {status?, busca?, arquivados?}   projeto_obter {id}
//   projeto_criar {...}   projeto_atualizar {id, ...}
//   tarefas_listar {project_id?}  tarefa_criar {...}  tarefa_atualizar {id, ...}
//   eventos_listar {de?, ate?, project_id?, store_id?, tipo?, status?}
//   evento_criar {...}  evento_atualizar {id, ...}
//   materiais_listar {project_id?, tipo?, status?}
//   config_obter   config_salvar {marca:{...}, orcamento:{...}}
//   atividades_listar {limite?}

var identidade = require('./lib/identidade');

var STATUS_PROJ = ['idea', 'discussing', 'proposal', 'awaiting_approval', 'approved', 'in_progress', 'completed', 'cancelled'];
var CATEG = ['promotional', 'seasonal', 'launch', 'institutional', 'internal', 'other'];
var PRIOR = ['low', 'normal', 'high'];
var STATUS_TAREFA = ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'];
var TIPO_TAREFA = ['strategy', 'planning', 'copywriting', 'design', 'video', 'publication', 'review', 'other'];
var TIPO_EVENTO = ['campaign', 'task', 'publication', 'deadline', 'reminder', 'other'];
var STATUS_EVENTO = ['suggested', 'confirmed', 'done', 'cancelled'];
var TIPO_ASSET = ['image', 'video', 'document', 'logo', 'other'];
var STATUS_ASSET = ['draft', 'in_review', 'approved', 'archived'];

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATA = /^\d{4}-\d{2}-\d{2}$/;
var HEX = /^#[0-9A-Fa-f]{6}$/;

function resp(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
function erro(status, codigo, mensagem) { return resp(status, { codigo: codigo, mensagem: mensagem }); }
function invalido(msg) { return erro(400, 'DADOS_INVALIDOS', msg); }

function texto(v, max) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function inteiro(v, min, max) { var n = parseInt(v, 10); return n >= min && n <= max ? n : null; }
function emLista(v, lista) { return lista.indexOf(v) >= 0 ? v : null; }
function uuid(v) { return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null; }
function dataOk(v) {
  if (typeof v !== 'string' || !DATA.test(v)) return null;
  var d = new Date(v + 'T00:00:00Z');
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
function instante(v) {
  if (typeof v !== 'string' || v.length < 10 || v.length > 40) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function slugificar(t) {
  var s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || 'projeto';
}
function sufixo() { return Math.random().toString(36).slice(2, 6); }

// Valida campos opcionais de um objeto conforme um esquema { campo: fn(valor) -> valor|undefined(inválido) }.
// Só campos presentes no corpo entram. Retorna { dados } ou { erro }.
function montar(corpo, esquema) {
  var dados = {};
  var campos = Object.keys(esquema);
  for (var i = 0; i < campos.length; i++) {
    var c = campos[i];
    if (!Object.prototype.hasOwnProperty.call(corpo, c)) continue;
    var v = corpo[c];
    var r = esquema[c](v);
    if (r === undefined) return { erro: 'Valor inválido em "' + c + '".' };
    dados[c] = r;
  }
  return { dados: dados };
}
function opcional(fn) { return function (v) { return v === null || v === '' ? null : (fn(v) === null ? undefined : fn(v)); }; }
function obrigTexto(max) { return function (v) { var t = texto(v, max); return t === null ? undefined : t; }; }
function opcTexto(max) { return function (v) { return texto(v, max); }; }
function opcEnum(lista) { return function (v) { return emLista(v, lista) === null ? undefined : v; }; }
function opcData() { return opcional(dataOk); }
function opcUuid() { return opcional(uuid); }

var ESQ_PROJETO = {
  title: obrigTexto(200),
  description: opcTexto(4000),
  objective: opcTexto(2000),
  category: opcEnum(CATEG),
  status: opcEnum(STATUS_PROJ),
  priority: opcEnum(PRIOR),
  start_date: opcData(),
  end_date: opcData()
};
var ESQ_TAREFA = {
  title: obrigTexto(200),
  description: opcTexto(4000),
  task_type: opcEnum(TIPO_TAREFA),
  status: opcEnum(STATUS_TAREFA),
  priority: opcEnum(PRIOR),
  due_at: opcional(instante)
};
var ESQ_EVENTO = {
  title: obrigTexto(200),
  description: opcTexto(4000),
  event_type: opcEnum(TIPO_EVENTO),
  status: opcEnum(STATUS_EVENTO),
  start_at: function (v) { var r = instante(v); return r === null ? undefined : r; },
  end_at: opcional(instante)
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return erro(405, 'METODO_NAO_PERMITIDO', 'Use POST.');
  var sbUrl = process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
  var svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return erro(500, 'SERVIDOR_NAO_CONFIGURADO', 'Servidor sem configuração.');
  var H = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

  async function rest(metodo, caminho, corpo, retornar, extra) {
    var h = Object.assign({}, H);
    var pref = [];
    if (retornar) pref.push('return=representation');
    if (extra) pref.push(extra);
    if (pref.length) h.Prefer = pref.join(',');
    var r = await fetch(sbUrl + '/rest/v1/' + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    var tx = await r.text();
    var j = [];
    try { j = tx ? JSON.parse(tx) : []; } catch (e) {}
    return { ok: r.ok, status: r.status, j: j };
  }

  // 1) Quem chama? JWT válido + perfil gestor.
  var m = /^Bearer (.+)$/.exec((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  var id = await identidade.identificar(m ? m[1] : '');
  if (!id.ok) return erro(id.status, id.codigo, id.mensagem);
  if (id.perfil !== 'gestor') return erro(403, 'SEM_PERMISSAO', 'A Central de Marketing é exclusiva da gestora.');
  var emp = id.funcionaria.empresa_id;
  if (!emp) return erro(403, 'SEM_PERMISSAO', 'Usuária sem empresa vinculada.');
  var quem = id.funcId;
  var eq = 'empresa_id=eq.' + emp;

  var corpo = {};
  try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) corpo = {};
  var acao = String(corpo.acao || '');

  var FALHA = function () { return erro(502, 'FALHA', 'Não foi possível concluir agora.'); };

  async function log(tipo, entId, acaoLog, detalhes) {
    try {
      await rest('POST', 'mkt_activity_logs', { empresa_id: emp, actor_user_id: quem, entity_type: tipo, entity_id: entId || null, action: acaoLog, details: detalhes || {} });
    } catch (e) {}
  }
  async function projetoDaEmpresa(pid) {
    var r = await rest('GET', 'mkt_projects?id=eq.' + pid + '&' + eq + '&select=id,status');
    return r.ok && r.j.length ? r.j[0] : null;
  }
  async function lojasValidas(ids) {
    if (!ids.length) return true;
    var r = await rest('GET', 'filiais?id=in.(' + ids.join(',') + ')&' + eq + '&select=id');
    return r.ok && r.j.length === ids.length;
  }
  function listaLojas(v) {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > 100) return null;
    var ids = v.map(function (x) { return inteiro(x, 1, 9007199254740991); });
    if (ids.some(function (x) { return !x; })) return null;
    return ids.filter(function (x, i) { return ids.indexOf(x) === i; });
  }
  function validarDatas(d) {
    return !(d.start_date && d.end_date && d.end_date < d.start_date) ? null : 'A data final não pode ser anterior à inicial.';
  }

  try {
    // ── painel ──
    if (acao === 'painel') {
      var agora = new Date();
      var ini = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
      var ate30 = new Date(agora.getTime() + 30 * 86400000).toISOString();
      var rs = await Promise.all([
        rest('GET', 'mkt_projects?' + eq + '&archived_at=is.null&select=id,status'),
        rest('GET', 'mkt_tasks?' + eq + '&status=not.in.(done,cancelled)&select=id,due_at'),
        rest('GET', 'mkt_calendar_events?' + eq + '&status=in.(suggested,confirmed)&start_at=gte.' + agora.toISOString() + '&start_at=lte.' + ate30 + '&select=id,title,event_type,status,start_at,project_id&order=start_at.asc&limit=8'),
        rest('GET', 'mkt_ai_usage?' + eq + '&created_at=gte.' + ini + '&select=estimated_cost_brl'),
        rest('GET', 'mkt_settings?' + eq + '&select=monthly_budget_brl,alert_threshold_pct,block_on_limit'),
        rest('GET', 'mkt_activity_logs?' + eq + '&select=id,entity_type,action,details,created_at&order=created_at.desc&limit=8'),
        rest('GET', 'mkt_assets?' + eq + '&status=neq.archived&select=id')
      ]);
      for (var k = 0; k < rs.length; k++) if (!rs[k].ok) return FALHA();
      var porStatus = {};
      rs[0].j.forEach(function (p) { porStatus[p.status] = (porStatus[p.status] || 0) + 1; });
      var atrasadas = rs[1].j.filter(function (t) { return t.due_at && t.due_at < agora.toISOString(); }).length;
      var gasto = rs[3].j.reduce(function (a, u) { return a + (parseFloat(u.estimated_cost_brl) || 0); }, 0);
      var cfg = rs[4].j[0] || { monthly_budget_brl: 100, alert_threshold_pct: 80, block_on_limit: true };
      return resp(200, {
        projetos: { total: rs[0].j.length, por_status: porStatus },
        tarefas: { abertas: rs[1].j.length, atrasadas: atrasadas },
        proximos_eventos: rs[2].j,
        orcamento: { gasto_mes_brl: Math.round(gasto * 100) / 100, limite_brl: parseFloat(cfg.monthly_budget_brl), alerta_pct: cfg.alert_threshold_pct, bloqueia: cfg.block_on_limit },
        atividades: rs[5].j,
        materiais: rs[6].j.length
      });
    }

    if (acao === 'lojas') {
      var rl = await rest('GET', 'filiais?' + eq + '&select=id,nome&order=nome.asc');
      if (!rl.ok) return FALHA();
      return resp(200, { lojas: rl.j });
    }

    // ── projetos ──
    if (acao === 'projetos_listar') {
      var q = 'mkt_projects?' + eq + '&select=id,title,slug,category,status,priority,start_date,end_date,archived_at,created_at,mkt_project_stores(store_id)&order=created_at.desc&limit=200';
      q += corpo.arquivados ? '&archived_at=not.is.null' : '&archived_at=is.null';
      if (corpo.status) {
        if (!emLista(corpo.status, STATUS_PROJ)) return invalido('Status inválido.');
        q += '&status=eq.' + corpo.status;
      }
      var busca = texto(corpo.busca, 80);
      if (busca) q += '&title=ilike.' + encodeURIComponent('*' + busca.replace(/[*%,()]/g, ' ') + '*');
      var rp = await rest('GET', q);
      if (!rp.ok) return FALHA();
      return resp(200, { projetos: rp.j });
    }

    if (acao === 'projeto_obter') {
      var pid = uuid(corpo.id);
      if (!pid) return invalido('Projeto inválido.');
      var rr = await Promise.all([
        rest('GET', 'mkt_projects?id=eq.' + pid + '&' + eq + '&select=*,mkt_project_stores(store_id)'),
        rest('GET', 'mkt_tasks?project_id=eq.' + pid + '&' + eq + '&select=*&order=created_at.asc'),
        rest('GET', 'mkt_calendar_events?project_id=eq.' + pid + '&' + eq + '&select=*&order=start_at.asc'),
        rest('GET', 'mkt_assets?project_id=eq.' + pid + '&' + eq + '&select=id,title,asset_type,status,created_at&order=created_at.desc'),
        rest('GET', 'mkt_project_decisions?project_id=eq.' + pid + '&' + eq + '&select=id,decision_text,status,decided_at,created_at&order=created_at.desc')
      ]);
      for (var k2 = 0; k2 < rr.length; k2++) if (!rr[k2].ok) return FALHA();
      if (!rr[0].j.length) return erro(404, 'NAO_ENCONTRADO', 'Projeto não encontrado.');
      return resp(200, { projeto: rr[0].j[0], tarefas: rr[1].j, eventos: rr[2].j, materiais: rr[3].j, decisoes: rr[4].j });
    }

    if (acao === 'projeto_criar') {
      var v = montar(corpo, ESQ_PROJETO);
      if (v.erro) return invalido(v.erro);
      if (!v.dados.title) return invalido('Informe o título do projeto.');
      var de = validarDatas(v.dados); if (de) return invalido(de);
      var lojas = listaLojas(corpo.store_ids);
      if (lojas === null) return invalido('Lojas inválidas.');
      if (lojas && !(await lojasValidas(lojas))) return invalido('Há lojas que não pertencem à empresa.');
      var base = slugificar(v.dados.title);
      var criado = null;
      for (var t = 0; t < 4 && !criado; t++) {
        var reg = Object.assign({ empresa_id: emp, created_by: quem, owner_id: quem, slug: t ? base + '-' + sufixo() : base }, v.dados);
        var rc = await rest('POST', 'mkt_projects', reg, true);
        if (rc.ok && rc.j.length) criado = rc.j[0];
        else if (rc.status !== 409) return FALHA();
      }
      if (!criado) return FALHA();
      if (lojas && lojas.length) {
        var rls = await rest('POST', 'mkt_project_stores', lojas.map(function (s) { return { project_id: criado.id, store_id: s }; }));
        if (!rls.ok) return FALHA();
      }
      await log('project', criado.id, 'created', { title: criado.title });
      return resp(200, { ok: true, projeto: criado });
    }

    if (acao === 'projeto_atualizar') {
      var pidA = uuid(corpo.id);
      if (!pidA) return invalido('Projeto inválido.');
      var va = montar(corpo, ESQ_PROJETO);
      if (va.erro) return invalido(va.erro);
      var atual = await rest('GET', 'mkt_projects?id=eq.' + pidA + '&' + eq + '&select=id,start_date,end_date');
      if (!atual.ok) return FALHA();
      if (!atual.j.length) return erro(404, 'NAO_ENCONTRADO', 'Projeto não encontrado.');
      var comb = Object.assign({ start_date: atual.j[0].start_date, end_date: atual.j[0].end_date }, va.dados);
      var dea = validarDatas(comb); if (dea) return invalido(dea);
      if (Object.prototype.hasOwnProperty.call(corpo, 'arquivar')) va.dados.archived_at = corpo.arquivar ? new Date().toISOString() : null;
      var lojasA = listaLojas(corpo.store_ids);
      if (lojasA === null) return invalido('Lojas inválidas.');
      if (lojasA && !(await lojasValidas(lojasA))) return invalido('Há lojas que não pertencem à empresa.');
      if (!Object.keys(va.dados).length && lojasA === undefined) return invalido('Nada para atualizar.');
      if (Object.keys(va.dados).length) {
        var ru = await rest('PATCH', 'mkt_projects?id=eq.' + pidA + '&' + eq, va.dados, true);
        if (!ru.ok || !ru.j.length) return FALHA();
      }
      if (lojasA !== undefined) {
        var rd = await rest('DELETE', 'mkt_project_stores?project_id=eq.' + pidA);
        if (!rd.ok) return FALHA();
        if (lojasA.length) {
          var ri = await rest('POST', 'mkt_project_stores', lojasA.map(function (s) { return { project_id: pidA, store_id: s }; }));
          if (!ri.ok) return FALHA();
        }
      }
      await log('project', pidA, 'updated', { campos: Object.keys(va.dados) });
      return resp(200, { ok: true });
    }

    // ── tarefas ──
    if (acao === 'tarefas_listar') {
      var qt = 'mkt_tasks?' + eq + '&select=id,project_id,title,task_type,status,priority,due_at,completed_at,mkt_projects(title)&order=due_at.asc.nullslast,created_at.desc&limit=300';
      if (corpo.project_id) {
        var pt = uuid(corpo.project_id); if (!pt) return invalido('Projeto inválido.');
        qt += '&project_id=eq.' + pt;
      }
      if (corpo.status) {
        if (!emLista(corpo.status, STATUS_TAREFA)) return invalido('Status inválido.');
        qt += '&status=eq.' + corpo.status;
      }
      var rt = await rest('GET', qt);
      if (!rt.ok) return FALHA();
      return resp(200, { tarefas: rt.j });
    }

    if (acao === 'tarefa_criar') {
      var pidT = uuid(corpo.project_id);
      if (!pidT) return invalido('Projeto inválido.');
      var vt = montar(corpo, ESQ_TAREFA);
      if (vt.erro) return invalido(vt.erro);
      if (!vt.dados.title) return invalido('Informe o título da tarefa.');
      if (!(await projetoDaEmpresa(pidT))) return erro(404, 'NAO_ENCONTRADO', 'Projeto não encontrado.');
      var rtc = await rest('POST', 'mkt_tasks', Object.assign({ empresa_id: emp, project_id: pidT }, vt.dados), true);
      if (!rtc.ok || !rtc.j.length) return FALHA();
      await log('task', rtc.j[0].id, 'created', { title: rtc.j[0].title });
      return resp(200, { ok: true, tarefa: rtc.j[0] });
    }

    if (acao === 'tarefa_atualizar') {
      var tid = uuid(corpo.id);
      if (!tid) return invalido('Tarefa inválida.');
      var vta = montar(corpo, ESQ_TAREFA);
      if (vta.erro) return invalido(vta.erro);
      if (!Object.keys(vta.dados).length) return invalido('Nada para atualizar.');
      var rta = await rest('PATCH', 'mkt_tasks?id=eq.' + tid + '&' + eq, vta.dados, true);
      if (!rta.ok) return FALHA();
      if (!rta.j.length) return erro(404, 'NAO_ENCONTRADO', 'Tarefa não encontrada.');
      await log('task', tid, 'updated', { campos: Object.keys(vta.dados) });
      return resp(200, { ok: true, tarefa: rta.j[0] });
    }

    // ── calendário ──
    if (acao === 'eventos_listar') {
      var qe = 'mkt_calendar_events?' + eq + '&select=id,project_id,task_id,store_id,title,description,event_type,status,start_at,end_at,mkt_projects(title)&order=start_at.asc&limit=500';
      if (corpo.de) { var d1 = instante(corpo.de); if (!d1) return invalido('Data inicial inválida.'); qe += '&start_at=gte.' + encodeURIComponent(d1); }
      if (corpo.ate) { var d2 = instante(corpo.ate); if (!d2) return invalido('Data final inválida.'); qe += '&start_at=lte.' + encodeURIComponent(d2); }
      if (corpo.project_id) { var pe = uuid(corpo.project_id); if (!pe) return invalido('Projeto inválido.'); qe += '&project_id=eq.' + pe; }
      if (corpo.store_id) { var se = inteiro(corpo.store_id, 1, 9007199254740991); if (!se) return invalido('Loja inválida.'); qe += '&store_id=eq.' + se; }
      if (corpo.tipo) { if (!emLista(corpo.tipo, TIPO_EVENTO)) return invalido('Tipo inválido.'); qe += '&event_type=eq.' + corpo.tipo; }
      if (corpo.status) { if (!emLista(corpo.status, STATUS_EVENTO)) return invalido('Status inválido.'); qe += '&status=eq.' + corpo.status; }
      var re = await rest('GET', qe);
      if (!re.ok) return FALHA();
      return resp(200, { eventos: re.j });
    }

    if (acao === 'evento_criar' || acao === 'evento_atualizar') {
      var criar = acao === 'evento_criar';
      var ve = montar(corpo, ESQ_EVENTO);
      if (ve.erro) return invalido(ve.erro);
      var extraE = montar(corpo, { project_id: opcUuid(), store_id: opcional(function (x) { return inteiro(x, 1, 9007199254740991); }) });
      if (extraE.erro) return invalido(extraE.erro);
      Object.assign(ve.dados, extraE.dados);
      if (criar && (!ve.dados.title || !ve.dados.start_at)) return invalido('Informe título e data do evento.');
      if (ve.dados.project_id && !(await projetoDaEmpresa(ve.dados.project_id))) return erro(404, 'NAO_ENCONTRADO', 'Projeto não encontrado.');
      if (ve.dados.store_id && !(await lojasValidas([ve.dados.store_id]))) return invalido('Loja inválida.');
      if (ve.dados.end_at && ve.dados.start_at && ve.dados.end_at < ve.dados.start_at) return invalido('O fim não pode ser anterior ao início.');
      if (criar) {
        var rec = await rest('POST', 'mkt_calendar_events', Object.assign({ empresa_id: emp, status: 'confirmed' }, ve.dados), true);
        if (!rec.ok || !rec.j.length) return FALHA();
        await log('calendar_event', rec.j[0].id, 'created', { title: rec.j[0].title });
        return resp(200, { ok: true, evento: rec.j[0] });
      }
      var eid = uuid(corpo.id);
      if (!eid) return invalido('Evento inválido.');
      if (!Object.keys(ve.dados).length) return invalido('Nada para atualizar.');
      var reu = await rest('PATCH', 'mkt_calendar_events?id=eq.' + eid + '&' + eq, ve.dados, true);
      if (!reu.ok) return FALHA();
      if (!reu.j.length) return erro(404, 'NAO_ENCONTRADO', 'Evento não encontrado.');
      await log('calendar_event', eid, 'updated', { campos: Object.keys(ve.dados) });
      return resp(200, { ok: true, evento: reu.j[0] });
    }

    // ── biblioteca (somente leitura nesta fase; upload vem com o Drive) ──
    if (acao === 'materiais_listar') {
      var qm = 'mkt_assets?' + eq + '&select=id,project_id,asset_type,title,description,status,storage_provider,created_at,mkt_projects(title)&order=created_at.desc&limit=200';
      if (corpo.project_id) { var pm = uuid(corpo.project_id); if (!pm) return invalido('Projeto inválido.'); qm += '&project_id=eq.' + pm; }
      if (corpo.tipo) { if (!emLista(corpo.tipo, TIPO_ASSET)) return invalido('Tipo inválido.'); qm += '&asset_type=eq.' + corpo.tipo; }
      if (corpo.status) { if (!emLista(corpo.status, STATUS_ASSET)) return invalido('Status inválido.'); qm += '&status=eq.' + corpo.status; }
      var rma = await rest('GET', qm);
      if (!rma.ok) return FALHA();
      return resp(200, { materiais: rma.j });
    }

    // ── configurações ──
    if (acao === 'config_obter') {
      var rc2 = await Promise.all([
        rest('GET', 'mkt_brand_settings?' + eq + '&select=brand_name,slogan,primary_color,secondary_color,logo_asset_id,brand_guidelines'),
        rest('GET', 'mkt_settings?' + eq + '&select=monthly_budget_brl,image_daily_limit,image_monthly_limit,alert_threshold_pct,block_on_limit'),
        rest('GET', 'mkt_integrations?' + eq + '&select=provider,status,connected_at')
      ]);
      if (!rc2[0].ok || !rc2[1].ok) return FALHA();
      return resp(200, {
        marca: rc2[0].j[0] || { brand_name: 'Maria Elegante', slogan: 'Aqui é simples ser elegante', primary_color: '#17E5C3', secondary_color: '#000000' },
        orcamento: rc2[1].j[0] || { monthly_budget_brl: 100, image_daily_limit: 10, image_monthly_limit: 100, alert_threshold_pct: 80, block_on_limit: true },
        integracoes: rc2[2].ok ? rc2[2].j : []
      });
    }

    if (acao === 'config_salvar') {
      var mm = corpo.marca && typeof corpo.marca === 'object' ? corpo.marca : null;
      var oo = corpo.orcamento && typeof corpo.orcamento === 'object' ? corpo.orcamento : null;
      if (!mm && !oo) return invalido('Nada para salvar.');
      var dm = null, dorc = null;
      if (mm) {
        var vm = montar(mm, {
          brand_name: obrigTexto(80),
          slogan: opcTexto(160),
          primary_color: function (x) { return typeof x === 'string' && HEX.test(x) ? x.toUpperCase() : undefined; },
          secondary_color: function (x) { return typeof x === 'string' && HEX.test(x) ? x.toUpperCase() : undefined; }
        });
        if (vm.erro) return invalido(vm.erro);
        dm = vm.dados;
      }
      if (oo) {
        var vo = montar(oo, {
          monthly_budget_brl: function (x) { var n = Number(x); return isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : undefined; },
          image_daily_limit: function (x) { var n = inteiro(x, 0, 10000); return n === null ? undefined : n; },
          image_monthly_limit: function (x) { var n = inteiro(x, 0, 100000); return n === null ? undefined : n; },
          alert_threshold_pct: function (x) { var n = inteiro(x, 1, 100); return n === null ? undefined : n; },
          block_on_limit: function (x) { return typeof x === 'boolean' ? x : undefined; }
        });
        if (vo.erro) return invalido(vo.erro);
        dorc = vo.dados;
      }
      if (dm && Object.keys(dm).length) {
        var rb = await rest('POST', 'mkt_brand_settings?on_conflict=empresa_id', Object.assign({ empresa_id: emp }, dm), false, 'resolution=merge-duplicates');
        if (!rb.ok) return FALHA();
      }
      if (dorc && Object.keys(dorc).length) {
        var rbo = await rest('POST', 'mkt_settings?on_conflict=empresa_id', Object.assign({ empresa_id: emp }, dorc), false, 'resolution=merge-duplicates');
        if (!rbo.ok) return FALHA();
      }
      await log('settings', null, 'updated', { marca: dm ? Object.keys(dm) : [], orcamento: dorc ? Object.keys(dorc) : [] });
      return resp(200, { ok: true });
    }

    if (acao === 'atividades_listar') {
      var lim = inteiro(corpo.limite, 1, 100) || 30;
      var ra2 = await rest('GET', 'mkt_activity_logs?' + eq + '&select=id,entity_type,entity_id,action,details,created_at,actor_user_id&order=created_at.desc&limit=' + lim);
      if (!ra2.ok) return FALHA();
      return resp(200, { atividades: ra2.j });
    }

    return invalido('Ação desconhecida.');
  } catch (e) {
    return erro(500, 'ERRO_INTERNO', 'Erro inesperado.');
  }
};
