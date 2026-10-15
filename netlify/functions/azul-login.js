// Netlify Function: azul-login
// Valida quem esta pedindo acesso aos dados da Azul e devolve um token (8h).
//
// POST /.netlify/functions/azul-login
//   Gestora:   { "modo": "gestor", "senha": "<senha do financeiro>" }
//   Func.:     { "modo": "func", "telefone": "35999990000", "senha": "<senha da funcionaria>" }
//
// Variaveis de ambiente (Netlify):
//   AZUL_FINANCEIRO_SENHA  - senha propria do modulo Financeiro (gestora)
//   AZUL_TOKEN_SECRET      - segredo aleatorio (32+ caracteres) para assinar tokens
//   SUPABASE_URL           - https://wkiwpszvhprjkilppdbr.supabase.co
//   SUPABASE_SERVICE_KEY   - service_role key (somente servidor)

var auth = require('./lib/azul-auth');

// Limite de tentativas por IP (melhor esforco: memoria da instancia)
var tentativas = {};
var JANELA_MS = 15 * 60 * 1000;
var MAX_FALHAS = 5;

function bloqueado(ip) {
  var t = tentativas[ip];
  if (!t) return false;
  if (Date.now() - t.inicio > JANELA_MS) { delete tentativas[ip]; return false; }
  return t.falhas >= MAX_FALHAS;
}

function registrarFalha(ip) {
  var t = tentativas[ip];
  if (!t || Date.now() - t.inicio > JANELA_MS) t = tentativas[ip] = { inicio: Date.now(), falhas: 0 };
  t.falhas++;
}

function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function falhaLogin(ip) {
  registrarFalha(ip);
  await pausa(800);
  return auth.resposta(401, { erro: true, codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Telefone ou senha incorretos.' });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return auth.resposta(405, { erro: true, codigo: 'METODO_NAO_PERMITIDO', mensagem: 'Use POST.' });
  }

  var secret = process.env.AZUL_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    return auth.resposta(500, { erro: true, codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'AZUL_TOKEN_SECRET ausente ou curto (min. 32 caracteres).' });
  }

  var h = event.headers || {};
  var ip = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'desconhecido';

  if (bloqueado(ip)) {
    return auth.resposta(429, { erro: true, codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas. Aguarde 15 minutos.' });
  }

  var body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return auth.resposta(400, { erro: true, codigo: 'JSON_INVALIDO', mensagem: 'Corpo invalido.' });
  }
  var senha = String(body.senha || '');
  if (!senha) {
    return auth.resposta(400, { erro: true, codigo: 'SENHA_OBRIGATORIA', mensagem: 'Informe a senha.' });
  }

  // ---- Gestora: senha propria do Financeiro ----
  if (body.modo === 'gestor') {
    var senhaFin = process.env.AZUL_FINANCEIRO_SENHA;
    if (!senhaFin) {
      return auth.resposta(500, { erro: true, codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'AZUL_FINANCEIRO_SENHA nao configurada.' });
    }
    if (!auth.iguais(senha, senhaFin)) return await falhaLogin(ip);
    var tokenG = auth.gerarToken({ role: 'gestor' }, secret);
    return auth.resposta(200, { token: tokenG, role: 'gestor' });
  }

  // ---- Gerente / vendedora: confere no Supabase ----
  if (body.modo === 'func') {
    var tel = String(body.telefone || '').replace(/\D/g, '');
    var sbUrl = process.env.SUPABASE_URL;
    var sbKey = process.env.SUPABASE_SERVICE_KEY;
    if (!tel) {
      return auth.resposta(400, { erro: true, codigo: 'TELEFONE_OBRIGATORIO', mensagem: 'Informe o telefone.' });
    }
    if (!sbUrl || !sbKey) {
      return auth.resposta(500, { erro: true, codigo: 'SERVIDOR_NAO_CONFIGURADO', mensagem: 'SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.' });
    }

    var url = sbUrl + '/rest/v1/funcionarias?telefone=eq.' + encodeURIComponent(tel)
      + '&ativa=eq.true&select=id,perfil,senha_hash,senha_criada,azul_vendedor_codigo,filiais(azul_filial)';
    var lista;
    try {
      var r = await fetch(url, { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } });
      lista = await r.json();
      if (!r.ok || !Array.isArray(lista)) throw new Error('supabase');
    } catch (e) {
      return auth.resposta(502, { erro: true, codigo: 'FALHA_AO_CONSULTAR', mensagem: 'Nao foi possivel validar o acesso agora.' });
    }

    var f = lista[0];
    if (!f || !f.senha_criada || !f.senha_hash || !auth.iguais(senha, f.senha_hash)) {
      return await falhaLogin(ip);
    }
    if (f.perfil !== 'gerente' && f.perfil !== 'vendedora') {
      return auth.resposta(403, { erro: true, codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Perfil sem acesso.' });
    }

    var fil = f.filiais && f.filiais.azul_filial ? Number(f.filiais.azul_filial) : null;
    var vend = f.azul_vendedor_codigo ? Number(f.azul_vendedor_codigo) : null;
    if (!fil || (f.perfil === 'vendedora' && !vend)) {
      return auth.resposta(403, { erro: true, codigo: 'MAPEAMENTO_AZUL_PENDENTE', mensagem: 'Seu cadastro ainda nao esta ligado ao sistema Azul. Fale com a gestora.' });
    }

    var claims = { role: f.perfil, func: f.id, fil: fil };
    if (f.perfil === 'vendedora') claims.vend = vend;
    return auth.resposta(200, { token: auth.gerarToken(claims, secret), role: f.perfil });
  }

  return auth.resposta(400, { erro: true, codigo: 'MODO_INVALIDO', mensagem: 'modo deve ser gestor ou func.' });
};
