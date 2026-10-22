// Central de Marketing — telas (Fase 2, sem IA). Carregado sob demanda pelo index.html.
// Fala só com /.netlify/functions/marketing (gestor). Nada de chave ou segredo aqui.
(function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';
  var L = {
    proj: { idea: 'Ideia', discussing: 'Em discussão', proposal: 'Proposta', awaiting_approval: 'Aguardando aprovação', approved: 'Aprovado', in_progress: 'Em andamento', completed: 'Concluído', cancelled: 'Cancelado' },
    cat: { promotional: 'Promocional', seasonal: 'Sazonal', launch: 'Lançamento', institutional: 'Institucional', internal: 'Interno', other: 'Outro' },
    pri: { low: 'Baixa', normal: 'Normal', high: 'Alta' },
    tar: { todo: 'A fazer', in_progress: 'Em andamento', blocked: 'Bloqueada', review: 'Em revisão', done: 'Concluída', cancelled: 'Cancelada' },
    tipoT: { strategy: 'Estratégia', planning: 'Planejamento', copywriting: 'Texto', design: 'Design', video: 'Vídeo', publication: 'Publicação', review: 'Revisão', other: 'Outra' },
    evt: { campaign: 'Campanha', task: 'Tarefa', publication: 'Publicação', deadline: 'Prazo', reminder: 'Lembrete', other: 'Outro' },
    evs: { suggested: 'Sugerida (IA)', confirmed: 'Confirmada', done: 'Feita', cancelled: 'Cancelada' },
    ast: { image: 'Imagem', video: 'Vídeo', document: 'Documento', logo: 'Logo', other: 'Outro' },
    ass: { draft: 'Rascunho', in_review: 'Em revisão', approved: 'Aprovado', archived: 'Arquivado' },
    prov: { openai: 'OpenAI (IA)', google_drive: 'Google Drive', google_calendar: 'Google Agenda', instagram: 'Instagram' },
    provSt: { pending: 'Não conectado', connected: 'Conectado', error: 'Com erro', revoked: 'Revogado' }
  };
  var ABAS = [['painel', 'Painel'], ['projetos', 'Projetos'], ['calendario', 'Calendário'], ['biblioteca', 'Biblioteca'], ['config', 'Configurações']];

  var M = { view: 'painel', projetoId: null, mes: null, dia: null, lojas: null, fProj: { status: '', busca: '' }, fCal: { loja: '', tipo: '', status: '' }, fBib: { tipo: '', status: '' } };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function ct() { return $('ct'); }
  function opts(map, sel, vazio) {
    var h = vazio !== undefined ? '<option value="">' + esc(vazio) + '</option>' : '';
    Object.keys(map).forEach(function (k) { h += '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; });
    return h;
  }
  function fmtDia(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }) : ''; }
  function fmtDataHora(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; }
  function fmtData(d) { return d ? d.split('-').reverse().join('/') : ''; }
  function chaveDia(iso) { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ }); }
  function brl(n) { return 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ','); }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function paraLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  var COR_ST = { idea: 'no', discussing: 'tl', proposal: 'tl', awaiting_approval: 'wn', approved: 'ok', in_progress: 'ok', completed: 'ok', cancelled: 'no' };
  function badge(txt, cls) { return '<span class="bx ' + (cls || 'no') + '">' + esc(txt) + '</span>'; }

  // ── chamada ao servidor ──
  async function api(acao, dados) {
    var tk = await authToken();
    if (!tk) return { ok: false, j: { mensagem: 'Sessão expirada. Entre novamente.' } };
    try {
      var r = await fetch('/.netlify/functions/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
        body: JSON.stringify(Object.assign({ acao: acao }, dados || {}))
      });
      var j = {}; try { j = await r.json(); } catch (e) {}
      return { ok: r.ok, j: j };
    } catch (e) {
      return { ok: false, j: { mensagem: 'Sem conexão. Tente de novo.' } };
    }
  }
  function aviso(msg) { window.alert(msg); }
  function erroTela(r) {
    ct().innerHTML = '<div class="card" style="margin-top:20px;text-align:center;padding:24px"><i class="ti ti-alert-circle" style="font-size:34px;color:#E24B4A;display:block;margin-bottom:8px"></i>' +
      '<div style="font-weight:600">' + esc((r.j && r.j.mensagem) || 'Não foi possível carregar.') + '</div>' +
      '<button class="btn bp" style="margin-top:14px" onclick="mktIr(\'' + M.view + '\')">Tentar de novo</button></div>';
  }
  async function lojas() {
    if (M.lojas) return M.lojas;
    var r = await api('lojas');
    M.lojas = r.ok ? (r.j.lojas || []) : [];
    return M.lojas;
  }

  // ── estrutura comum ──
  function moldura(corpo) {
    var tabs = '<div class="mk-tabs">' + ABAS.map(function (a) {
      return '<button class="mk-tab' + (a[0] === M.view ? ' on' : '') + '" onclick="mktIr(\'' + a[0] + '\')">' + a[1] + '</button>';
    }).join('') + '</div>';
    ct().innerHTML = '<div class="h1" style="margin:14px 0 10px;font-size:22px;font-weight:800">Marketing</div>' + tabs + corpo;
  }
  function vazio(icone, txt) { return '<div class="mk-vazio"><i class="ti ' + icone + '"></i>' + esc(txt) + '</div>'; }

  function folha(titulo, html) {
    fechar();
    var d = document.createElement('div');
    d.className = 'mk-sheet'; d.id = 'mk-sheet';
    d.onclick = function (e) { if (e.target === d) fechar(); };
    d.innerHTML = '<div><h3>' + esc(titulo) + '</h3>' + html + '</div>';
    document.body.appendChild(d);
  }
  function fechar() { var s = $('mk-sheet'); if (s) s.remove(); }
  function val(id) { var e = $(id); return e ? e.value : ''; }

  // ── PAINEL ──
  async function painel() {
    var r = await api('painel');
    if (!r.ok) return erroTela(r);
    var p = r.j, o = p.orcamento || {};
    var pct = o.limite_brl > 0 ? Math.min(100, Math.round(o.gasto_mes_brl / o.limite_brl * 100)) : 0;
    var cls = pct >= 100 ? 'al' : pct >= (o.alerta_pct || 80) ? 'wn' : '';
    var ativos = (p.projetos.por_status.in_progress || 0) + (p.projetos.por_status.approved || 0);
    var h = '<div class="mk-kpis">' +
      kpi('Projetos', p.projetos.total, ativos + ' ativos') +
      kpi('Tarefas abertas', p.tarefas.abertas, p.tarefas.atrasadas ? p.tarefas.atrasadas + ' atrasadas' : 'nenhuma atrasada') +
      kpi('Materiais', p.materiais, 'na biblioteca') +
      '<div class="mk-kpi"><div class="l">IA no mês</div><div class="v">' + brl(o.gasto_mes_brl) + '</div><div class="s">de ' + brl(o.limite_brl) + '</div><div class="mk-bar ' + cls + '"><i style="width:' + pct + '%"></i></div></div></div>';
    h += '<div class="mk-soon"><b>Assistente de marketing (em breve)</b>Aqui você vai conversar com a IA para planejar campanhas, e ela organiza projetos, tarefas e datas. Por enquanto, tudo é cadastrado manualmente.</div>';
    h += '<div class="card"><div class="mk-h">Próximos 30 dias</div>' + (p.proximos_eventos.length ? p.proximos_eventos.map(function (e) {
      return '<div class="mk-row" onclick="mktIr(\'calendario\')"><div class="m"><div class="t">' + esc(e.title) + '</div><div class="d">' + fmtDataHora(e.start_at) + ' · ' + esc(L.evt[e.event_type]) + '</div></div>' + badge(L.evs[e.status], e.status === 'suggested' ? 'wn' : 'ok') + '</div>';
    }).join('') : vazio('ti-calendar', 'Nada agendado nos próximos 30 dias.')) + '</div>';
    h += '<div class="card"><div class="mk-h">Atividade recente</div>' + (p.atividades.length ? p.atividades.map(function (a) {
      return '<div class="mk-row" style="cursor:default"><div class="m"><div class="t">' + esc(rotuloAtv(a)) + '</div><div class="d">' + fmtDataHora(a.created_at) + '</div></div></div>';
    }).join('') : vazio('ti-history', 'Sem atividade ainda.')) + '</div>';
    moldura(h);
  }
  function kpi(l, v, s) { return '<div class="mk-kpi"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function rotuloAtv(a) {
    var ent = { project: 'Projeto', task: 'Tarefa', calendar_event: 'Evento', settings: 'Configurações' }[a.entity_type] || a.entity_type;
    var ac = { created: 'criado(a)', updated: 'atualizado(a)' }[a.action] || a.action;
    var t = a.details && a.details.title ? ': ' + a.details.title : '';
    return ent + ' ' + ac + t;
  }

  // ── PROJETOS ──
  async function projetos() {
    var f = M.fProj;
    var r = await api('projetos_listar', { status: f.status || undefined, busca: f.busca || undefined });
    if (!r.ok) return erroTela(r);
    var h = '<div class="mk-filtros"><select class="mk-in" id="mk-fs" onchange="mktFiltroProj()">' + opts(L.proj, f.status, 'Todos os status') + '</select>' +
      '<input class="mk-in" id="mk-fb" placeholder="Buscar projeto" value="' + esc(f.busca) + '" onchange="mktFiltroProj()"></div>' +
      '<button class="btn bp" style="width:100%;margin-bottom:12px" onclick="mktFormProjeto()"><i class="ti ti-plus"></i> Novo projeto</button>';
    h += '<div class="card">' + (r.j.projetos.length ? r.j.projetos.map(function (p) {
      var datas = p.start_date ? fmtData(p.start_date) + (p.end_date ? ' → ' + fmtData(p.end_date) : '') : 'Sem datas';
      return '<div class="mk-row" onclick="mktAbrirProjeto(\'' + p.id + '\')"><div class="m"><div class="t">' + esc(p.title) + '</div><div class="d">' + esc(L.cat[p.category]) + ' · ' + datas + '</div></div>' + badge(L.proj[p.status], COR_ST[p.status]) + '</div>';
    }).join('') : vazio('ti-folders', 'Nenhum projeto ainda. Crie o primeiro.')) + '</div>';
    moldura(h);
  }
  window.mktFiltroProj = function () { M.fProj = { status: val('mk-fs'), busca: val('mk-fb').trim() }; projetos(); };

  async function lojasChecks(sel) {
    var ls = await lojas();
    if (!ls.length) return '<div class="d" style="color:var(--t2);font-size:12px">Nenhuma loja cadastrada.</div>';
    return '<div class="mk-chips">' + ls.map(function (l) {
      return '<label><input type="checkbox" name="mk-loja" value="' + l.id + '"' + (sel.indexOf(l.id) >= 0 ? ' checked' : '') + '>' + esc(l.nome) + '</label>';
    }).join('') + '</div>';
  }
  function lojasMarcadas() { return Array.prototype.map.call(document.querySelectorAll('input[name=mk-loja]:checked'), function (e) { return parseInt(e.value, 10); }); }

  window.mktFormProjeto = async function (id) {
    var p = { title: '', description: '', objective: '', category: 'promotional', status: 'idea', priority: 'normal', start_date: '', end_date: '', mkt_project_stores: [] };
    if (id) { var r = await api('projeto_obter', { id: id }); if (!r.ok) return aviso(r.j.mensagem || 'Erro.'); p = Object.assign(p, r.j.projeto); }
    var sel = (p.mkt_project_stores || []).map(function (s) { return s.store_id; });
    var chk = await lojasChecks(sel);
    folha(id ? 'Editar projeto' : 'Novo projeto',
      '<label class="mk-lab">Título</label><input class="mk-in" id="mkp-t" maxlength="200" value="' + esc(p.title) + '">' +
      '<label class="mk-lab">Objetivo</label><textarea class="mk-in" id="mkp-o" rows="2" maxlength="2000">' + esc(p.objective) + '</textarea>' +
      '<label class="mk-lab">Descrição</label><textarea class="mk-in" id="mkp-d" rows="3" maxlength="4000">' + esc(p.description) + '</textarea>' +
      '<div class="g2"><div><label class="mk-lab">Categoria</label><select class="mk-in" id="mkp-c">' + opts(L.cat, p.category) + '</select></div>' +
      '<div><label class="mk-lab">Prioridade</label><select class="mk-in" id="mkp-p">' + opts(L.pri, p.priority) + '</select></div></div>' +
      '<div class="g2"><div><label class="mk-lab">Início</label><input class="mk-in" type="date" id="mkp-i" value="' + esc(p.start_date || '') + '"></div>' +
      '<div><label class="mk-lab">Fim</label><input class="mk-in" type="date" id="mkp-f" value="' + esc(p.end_date || '') + '"></div></div>' +
      (id ? '<label class="mk-lab">Status</label><select class="mk-in" id="mkp-s">' + opts(L.proj, p.status) + '</select>' : '') +
      '<label class="mk-lab">Lojas (nenhuma marcada = sem loja específica)</label>' + chk +
      '<div class="mk-acoes"><button class="btn" onclick="mktFechar()">Cancelar</button><button class="btn bp" id="mkp-ok" onclick="mktSalvarProjeto(' + (id ? "'" + id + "'" : '') + ')">Salvar</button></div>');
  };
  window.mktFechar = fechar;
  window.mktSalvarProjeto = async function (id) {
    var d = { title: val('mkp-t'), objective: val('mkp-o'), description: val('mkp-d'), category: val('mkp-c'), priority: val('mkp-p'), start_date: val('mkp-i') || null, end_date: val('mkp-f') || null, store_ids: lojasMarcadas() };
    if (!d.title.trim()) return aviso('Informe o título do projeto.');
    if (id) { d.id = id; d.status = val('mkp-s'); }
    var b = $('mkp-ok'); b.disabled = true;
    var r = await api(id ? 'projeto_atualizar' : 'projeto_criar', d);
    b.disabled = false;
    if (!r.ok) return aviso(r.j.mensagem || 'Não foi possível salvar.');
    fechar();
    if (id) mktAbrirProjeto(id); else if (r.j.projeto) mktAbrirProjeto(r.j.projeto.id); else projetos();
  };

  window.mktAbrirProjeto = async function (id) {
    M.view = 'projetos'; M.projetoId = id;
    var r = await api('projeto_obter', { id: id });
    if (!r.ok) return erroTela(r);
    var p = r.j.projeto, ls = await lojas();
    var nomes = (p.mkt_project_stores || []).map(function (s) { var l = ls.filter(function (x) { return x.id === s.store_id; })[0]; return l ? l.nome : ''; }).filter(Boolean);
    var h = '<button class="btn" style="margin-bottom:10px" onclick="mktIr(\'projetos\')"><i class="ti ti-arrow-left"></i> Projetos</button>' +
      '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="mk-h" style="margin:0">' + esc(p.title) + '</div>' + badge(L.proj[p.status], COR_ST[p.status]) + '</div>' +
      '<div class="d" style="color:var(--t2);font-size:13px;margin:6px 0">' + esc(L.cat[p.category]) + ' · Prioridade ' + esc(L.pri[p.priority]).toLowerCase() + (p.start_date ? ' · ' + fmtData(p.start_date) + (p.end_date ? ' → ' + fmtData(p.end_date) : '') : '') + '</div>' +
      (nomes.length ? '<div style="font-size:13px;margin-bottom:6px"><b>Lojas:</b> ' + esc(nomes.join(', ')) + '</div>' : '') +
      (p.objective ? '<div style="font-size:13px;margin-bottom:6px"><b>Objetivo:</b> ' + esc(p.objective) + '</div>' : '') +
      (p.description ? '<div style="font-size:13px;white-space:pre-wrap">' + esc(p.description) + '</div>' : '') +
      '<div class="mk-acoes"><button class="btn" onclick="mktFormProjeto(\'' + id + '\')">Editar</button><button class="btn" onclick="mktArquivar(\'' + id + '\',' + (p.archived_at ? 'false' : 'true') + ')">' + (p.archived_at ? 'Desarquivar' : 'Arquivar') + '</button></div></div>';

    h += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="mk-h" style="margin:0">Tarefas</div><button class="btn bsm" onclick="mktFormTarefa(\'' + id + '\')"><i class="ti ti-plus"></i> Tarefa</button></div>' +
      (r.j.tarefas.length ? r.j.tarefas.map(function (t) {
        var feita = t.status === 'done';
        return '<div class="mk-row" style="cursor:default"><input type="checkbox" style="width:22px;height:22px" ' + (feita ? 'checked' : '') + ' onchange="mktTarefaFeita(\'' + t.id + '\',this.checked)"><div class="m"><div class="t" style="' + (feita ? 'text-decoration:line-through;color:var(--t2)' : '') + '">' + esc(t.title) + '</div><div class="d">' + esc(L.tipoT[t.task_type]) + (t.due_at ? ' · até ' + fmtDia(t.due_at) : '') + ' · ' + esc(L.tar[t.status]) + '</div></div></div>';
      }).join('') : vazio('ti-checklist', 'Sem tarefas.')) + '</div>';

    h += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="mk-h" style="margin:0">Datas</div><button class="btn bsm" onclick="mktFormEvento(null,\'' + id + '\')"><i class="ti ti-plus"></i> Data</button></div>' +
      (r.j.eventos.length ? r.j.eventos.map(function (e) {
        return '<div class="mk-row" onclick="mktFormEvento(\'' + e.id + '\')"><div class="m"><div class="t">' + esc(e.title) + '</div><div class="d">' + fmtDataHora(e.start_at) + ' · ' + esc(L.evt[e.event_type]) + '</div></div>' + badge(L.evs[e.status], e.status === 'suggested' ? 'wn' : 'ok') + '</div>';
      }).join('') : vazio('ti-calendar', 'Sem datas.')) + '</div>';

    h += '<div class="card"><div class="mk-h">Materiais</div>' + (r.j.materiais.length ? r.j.materiais.map(function (a) {
      return '<div class="mk-row" style="cursor:default"><div class="m"><div class="t">' + esc(a.title) + '</div><div class="d">' + esc(L.ast[a.asset_type]) + '</div></div>' + badge(L.ass[a.status], a.status === 'approved' ? 'ok' : 'no') + '</div>';
    }).join('') : vazio('ti-photo', 'Sem materiais ainda.')) + '</div>';
    moldura(h);
  };
  window.mktArquivar = async function (id, arq) {
    if (arq && !window.confirm('Arquivar este projeto? Ele sai da lista, mas nada é apagado.')) return;
    var r = await api('projeto_atualizar', { id: id, arquivar: arq });
    if (!r.ok) return aviso(r.j.mensagem || 'Erro.');
    mktIr('projetos');
  };
  window.mktTarefaFeita = async function (tid, feita) {
    var r = await api('tarefa_atualizar', { id: tid, status: feita ? 'done' : 'todo' });
    if (!r.ok) aviso(r.j.mensagem || 'Erro.');
    mktAbrirProjeto(M.projetoId);
  };
  window.mktFormTarefa = function (pid) {
    folha('Nova tarefa',
      '<label class="mk-lab">Título</label><input class="mk-in" id="mkt-t" maxlength="200">' +
      '<label class="mk-lab">Descrição</label><textarea class="mk-in" id="mkt-d" rows="2" maxlength="4000"></textarea>' +
      '<div class="g2"><div><label class="mk-lab">Tipo</label><select class="mk-in" id="mkt-ty">' + opts(L.tipoT, 'other') + '</select></div>' +
      '<div><label class="mk-lab">Prioridade</label><select class="mk-in" id="mkt-p">' + opts(L.pri, 'normal') + '</select></div></div>' +
      '<label class="mk-lab">Prazo (opcional)</label><input class="mk-in" type="datetime-local" id="mkt-due">' +
      '<div class="mk-acoes"><button class="btn" onclick="mktFechar()">Cancelar</button><button class="btn bp" onclick="mktSalvarTarefa(\'' + pid + '\')">Salvar</button></div>');
  };
  window.mktSalvarTarefa = async function (pid) {
    var t = val('mkt-t').trim(); if (!t) return aviso('Informe o título da tarefa.');
    var due = val('mkt-due');
    var r = await api('tarefa_criar', { project_id: pid, title: t, description: val('mkt-d'), task_type: val('mkt-ty'), priority: val('mkt-p'), due_at: due ? new Date(due).toISOString() : null });
    if (!r.ok) return aviso(r.j.mensagem || 'Erro.');
    fechar(); mktAbrirProjeto(pid);
  };

  // ── EVENTOS (usado no projeto e no calendário) ──
  var EV = {}; // cache dos eventos carregados, por id
  window.mktFormEvento = async function (eid, pid, diaPadrao) {
    var e = { title: '', description: '', event_type: 'other', status: 'confirmed', start_at: '', end_at: '', project_id: pid || '', store_id: '' };
    if (eid) { e = Object.assign(e, EV[eid] || {}); }
    var ls = await lojas();
    var inicio = e.start_at ? paraLocalInput(e.start_at) : (diaPadrao ? diaPadrao + 'T09:00' : '');
    folha(eid ? 'Editar data' : 'Nova data',
      '<label class="mk-lab">Título</label><input class="mk-in" id="mke-t" maxlength="200" value="' + esc(e.title) + '">' +
      '<div class="g2"><div><label class="mk-lab">Tipo</label><select class="mk-in" id="mke-ty">' + opts(L.evt, e.event_type) + '</select></div>' +
      '<div><label class="mk-lab">Situação</label><select class="mk-in" id="mke-s">' + opts(L.evs, e.status) + '</select></div></div>' +
      '<label class="mk-lab">Início</label><input class="mk-in" type="datetime-local" id="mke-i" value="' + esc(inicio) + '">' +
      '<label class="mk-lab">Fim (opcional)</label><input class="mk-in" type="datetime-local" id="mke-f" value="' + esc(paraLocalInput(e.end_at)) + '">' +
      '<label class="mk-lab">Loja (opcional)</label><select class="mk-in" id="mke-l"><option value="">Todas / nenhuma</option>' + ls.map(function (l) { return '<option value="' + l.id + '"' + (String(e.store_id) === String(l.id) ? ' selected' : '') + '>' + esc(l.nome) + '</option>'; }).join('') + '</select>' +
      '<label class="mk-lab">Observações</label><textarea class="mk-in" id="mke-d" rows="2" maxlength="4000">' + esc(e.description) + '</textarea>' +
      '<div class="mk-acoes"><button class="btn" onclick="mktFechar()">Cancelar</button><button class="btn bp" onclick="mktSalvarEvento(' + (eid ? "'" + eid + "'" : 'null') + ',\'' + esc(e.project_id || '') + '\')">Salvar</button></div>');
  };
  window.mktSalvarEvento = async function (eid, pid) {
    var t = val('mke-t').trim(), i = val('mke-i'), f = val('mke-f');
    if (!t) return aviso('Informe o título.');
    if (!i) return aviso('Informe a data de início.');
    if (f && new Date(f) < new Date(i)) return aviso('O fim não pode ser antes do início.');
    var d = { title: t, description: val('mke-d'), event_type: val('mke-ty'), status: val('mke-s'), start_at: new Date(i).toISOString(), end_at: f ? new Date(f).toISOString() : null, store_id: val('mke-l') ? parseInt(val('mke-l'), 10) : null };
    if (!eid && pid) d.project_id = pid;
    if (eid) d.id = eid;
    var r = await api(eid ? 'evento_atualizar' : 'evento_criar', d);
    if (!r.ok) return aviso(r.j.mensagem || 'Erro.');
    fechar();
    if (M.view === 'calendario') calendario(); else if (M.projetoId && pid) mktAbrirProjeto(M.projetoId); else calendario();
  };

  // ── CALENDÁRIO ──
  async function calendario() {
    if (!M.mes) { var n = new Date(); M.mes = new Date(n.getFullYear(), n.getMonth(), 1); }
    var ini = new Date(M.mes.getFullYear(), M.mes.getMonth(), 1), fim = new Date(M.mes.getFullYear(), M.mes.getMonth() + 1, 0);
    var gIni = new Date(ini); gIni.setDate(1 - ini.getDay());
    var gFim = new Date(fim); gFim.setDate(fim.getDate() + (6 - fim.getDay()));
    var f = M.fCal;
    var de = new Date(gIni); var ate = new Date(gFim); ate.setHours(23, 59, 59, 999);
    var r = await api('eventos_listar', { de: de.toISOString(), ate: ate.toISOString(), store_id: f.loja ? parseInt(f.loja, 10) : undefined, tipo: f.tipo || undefined, status: f.status || undefined });
    if (!r.ok) return erroTela(r);
    var ls = await lojas();
    EV = {}; var porDia = {};
    r.j.eventos.forEach(function (e) { EV[e.id] = e; (porDia[chaveDia(e.start_at)] = porDia[chaveDia(e.start_at)] || []).push(e); });
    var hoje = ymd(new Date());
    if (!M.dia) M.dia = hoje;
    var nomeMes = ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    var h = '<div class="mk-filtros" style="grid-template-columns:1fr 1fr 1fr">' +
      '<select class="mk-in" id="mkc-l" onchange="mktFiltroCal()"><option value="">Todas as lojas</option>' + ls.map(function (l) { return '<option value="' + l.id + '"' + (String(f.loja) === String(l.id) ? ' selected' : '') + '>' + esc(l.nome) + '</option>'; }).join('') + '</select>' +
      '<select class="mk-in" id="mkc-t" onchange="mktFiltroCal()">' + opts(L.evt, f.tipo, 'Todos os tipos') + '</select>' +
      '<select class="mk-in" id="mkc-s" onchange="mktFiltroCal()">' + opts(L.evs, f.status, 'Toda situação') + '</select></div>';
    h += '<div class="mk-mes"><button onclick="mktMes(-1)" aria-label="Mês anterior">‹</button><b>' + esc(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1).replace(" de "," de ")) + '</b><button onclick="mktMes(1)" aria-label="Próximo mês">›</button></div>';
    h += '<div class="mk-cal">' + ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(function (x) { return '<div class="h">' + x + '</div>'; }).join('');
    for (var d = new Date(gIni); d <= gFim; d.setDate(d.getDate() + 1)) {
      var k = ymd(d), evs = porDia[k] || [];
      h += '<button class="mk-dia' + (d.getMonth() !== ini.getMonth() ? ' fora' : '') + (k === hoje ? ' hoje' : '') + (k === M.dia ? ' sel' : '') + '" onclick="mktDia(\'' + k + '\')">' + d.getDate() +
        (evs.length ? '<div class="p">' + evs.slice(0, 4).map(function (e) { return '<i class="' + (e.status === 'suggested' ? 's' : '') + '"></i>'; }).join('') + '</div>' : '') + '</button>';
    }
    h += '</div>';
    var doDia = porDia[M.dia] || [];
    h += '<div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="mk-h" style="margin:0">' + esc(fmtData(M.dia)) + '</div><button class="btn bsm" onclick="mktFormEvento(null,null,\'' + M.dia + '\')"><i class="ti ti-plus"></i> Data</button></div>' +
      (doDia.length ? doDia.map(function (e) {
        return '<div class="mk-row" onclick="mktFormEvento(\'' + e.id + '\')"><div class="m"><div class="t">' + esc(e.title) + '</div><div class="d">' + fmtDataHora(e.start_at).slice(-5) + ' · ' + esc(L.evt[e.event_type]) + (e.mkt_projects ? ' · ' + esc(e.mkt_projects.title) : '') + '</div></div>' + badge(L.evs[e.status], e.status === 'suggested' ? 'wn' : 'ok') + '</div>';
      }).join('') : vazio('ti-calendar-off', 'Nada neste dia.')) + '</div>';
    h += '<div class="d" style="font-size:12px;color:var(--t2);margin-top:8px">Ponto laranja = data sugerida pela IA, ainda não confirmada.</div>';
    moldura(h);
  }
  window.mktFiltroCal = function () { M.fCal = { loja: val('mkc-l'), tipo: val('mkc-t'), status: val('mkc-s') }; calendario(); };
  window.mktMes = function (n) { M.mes = new Date(M.mes.getFullYear(), M.mes.getMonth() + n, 1); M.dia = ymd(M.mes); calendario(); };
  window.mktDia = function (k) { M.dia = k; calendario(); };

  // ── BIBLIOTECA ──
  async function biblioteca() {
    var f = M.fBib;
    var r = await api('materiais_listar', { tipo: f.tipo || undefined, status: f.status || undefined });
    if (!r.ok) return erroTela(r);
    var h = '<div class="mk-filtros"><select class="mk-in" id="mkb-t" onchange="mktFiltroBib()">' + opts(L.ast, f.tipo, 'Todos os tipos') + '</select>' +
      '<select class="mk-in" id="mkb-s" onchange="mktFiltroBib()">' + opts(L.ass, f.status, 'Toda situação') + '</select></div>';
    h += '<div class="mk-soon"><b>Envio de arquivos (em breve)</b>Os materiais criados pelo estúdio e os arquivos do Google Drive vão aparecer aqui, com versões e aprovação.</div>';
    h += '<div class="card">' + (r.j.materiais.length ? r.j.materiais.map(function (a) {
      return '<div class="mk-row" style="cursor:default"><div class="m"><div class="t">' + esc(a.title) + '</div><div class="d">' + esc(L.ast[a.asset_type]) + (a.mkt_projects ? ' · ' + esc(a.mkt_projects.title) : '') + ' · ' + fmtDia(a.created_at) + '</div></div>' + badge(L.ass[a.status], a.status === 'approved' ? 'ok' : 'no') + '</div>';
    }).join('') : vazio('ti-photo', 'Nenhum material ainda.')) + '</div>';
    moldura(h);
  }
  window.mktFiltroBib = function () { M.fBib = { tipo: val('mkb-t'), status: val('mkb-s') }; biblioteca(); };

  // ── CONFIGURAÇÕES ──
  async function config() {
    var r = await api('config_obter');
    if (!r.ok) return erroTela(r);
    var m = r.j.marca, o = r.j.orcamento, ints = r.j.integracoes || [];
    var h = '<div class="card"><div class="mk-h">Identidade da marca</div>' +
      '<label class="mk-lab">Nome</label><input class="mk-in" id="mkg-n" maxlength="80" value="' + esc(m.brand_name) + '">' +
      '<label class="mk-lab">Slogan</label><input class="mk-in" id="mkg-s" maxlength="160" value="' + esc(m.slogan || '') + '">' +
      '<div class="g2"><div><label class="mk-lab">Cor principal</label><div class="mk-cores"><input type="color" id="mkg-c1" value="' + esc(m.primary_color) + '" oninput="mktPrev()"></div></div>' +
      '<div><label class="mk-lab">Cor secundária</label><div class="mk-cores"><input type="color" id="mkg-c2" value="' + esc(m.secondary_color) + '" oninput="mktPrev()"></div></div></div>' +
      '<div class="mk-prev" id="mkg-prev"></div>' +
      '<div class="d" style="font-size:12px;color:var(--t2);margin-top:6px">Estas cores valem para os materiais criados. O visual do app não muda.</div></div>';
    h += '<div class="card"><div class="mk-h">Orçamento de IA</div>' +
      '<label class="mk-lab">Limite mensal (R$)</label><input class="mk-in" id="mkg-b" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(o.monthly_budget_brl) + '">' +
      '<div class="g2"><div><label class="mk-lab">Imagens por dia</label><input class="mk-in" id="mkg-id" type="number" min="0" inputmode="numeric" value="' + esc(o.image_daily_limit) + '"></div>' +
      '<div><label class="mk-lab">Imagens por mês</label><input class="mk-in" id="mkg-im" type="number" min="0" inputmode="numeric" value="' + esc(o.image_monthly_limit) + '"></div></div>' +
      '<label class="mk-lab">Avisar ao atingir (%)</label><input class="mk-in" id="mkg-a" type="number" min="1" max="100" inputmode="numeric" value="' + esc(o.alert_threshold_pct) + '">' +
      '<label class="mk-chk"><input type="checkbox" id="mkg-bl"' + (o.block_on_limit ? ' checked' : '') + '> Bloquear novas gerações ao atingir o limite</label>' +
      '<div class="d" style="font-size:12px;color:var(--t2)">Este controle é interno. Configure também um limite de gastos no painel do provedor da IA.</div></div>';
    h += '<button class="btn bp" style="width:100%;margin-bottom:12px" id="mkg-ok" onclick="mktSalvarConfig()">Salvar configurações</button>';
    var provs = ['openai', 'google_drive', 'google_calendar', 'instagram'];
    h += '<div class="card"><div class="mk-h">Conexões</div>' + provs.map(function (p) {
      var x = ints.filter(function (i) { return i.provider === p; })[0];
      var st = x ? x.status : 'pending';
      return '<div class="mk-row" style="cursor:default"><div class="m"><div class="t">' + esc(L.prov[p]) + '</div></div>' + badge(L.provSt[st], st === 'connected' ? 'ok' : st === 'error' ? 'al' : 'no') + '</div>';
    }).join('') + '<div class="d" style="font-size:12px;color:var(--t2);margin-top:8px">As conexões são ativadas nas próximas fases. Chaves e senhas nunca ficam nesta tela.</div></div>';
    moldura(h);
    mktPrev();
  }
  window.mktPrev = function () {
    var p = $('mkg-prev'); if (!p) return;
    p.style.background = val('mkg-c1'); p.style.color = val('mkg-c2'); p.textContent = val('mkg-n') || 'Marca';
  };
  window.mktSalvarConfig = async function () {
    var b = $('mkg-ok'); b.disabled = true;
    var r = await api('config_salvar', {
      marca: { brand_name: val('mkg-n'), slogan: val('mkg-s'), primary_color: val('mkg-c1'), secondary_color: val('mkg-c2') },
      orcamento: { monthly_budget_brl: val('mkg-b'), image_daily_limit: val('mkg-id'), image_monthly_limit: val('mkg-im'), alert_threshold_pct: val('mkg-a'), block_on_limit: $('mkg-bl').checked }
    });
    b.disabled = false;
    aviso(r.ok ? 'Configurações salvas.' : (r.j.mensagem || 'Não foi possível salvar.'));
  };

  var TELAS = { painel: painel, projetos: projetos, calendario: calendario, biblioteca: biblioteca, config: config };
  window.mktIr = async function (v) {
    if (!TELAS[v]) v = 'painel';
    M.view = v; if (v !== 'projetos') M.projetoId = null;
    fechar();
    ct().innerHTML = '<div class="ld"><i class="ti ti-loader"></i>Carregando...</div>';
    try { await TELAS[v](); }
    catch (e) { console.error('Marketing', e); erroTela({ j: { mensagem: 'Erro ao montar a tela.' } }); }
  };
})();
