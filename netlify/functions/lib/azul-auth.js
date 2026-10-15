// Utilitarios de autenticacao das functions da Azul (token assinado HMAC-SHA256).
// Variavel de ambiente: AZUL_TOKEN_SECRET (string aleatoria com 32+ caracteres).

var crypto = require('crypto');

var DURACAO_SEGUNDOS = 8 * 60 * 60; // 8 horas

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function assinar(dados, secret) {
  return b64u(crypto.createHmac('sha256', secret).update(dados).digest());
}

// Compara duas strings sem vazar tamanho/tempo
function iguais(a, b) {
  var ha = crypto.createHash('sha256').update(String(a)).digest();
  var hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function gerarToken(claims, secret) {
  var corpo = Object.assign({}, claims, { exp: Math.floor(Date.now() / 1000) + DURACAO_SEGUNDOS });
  var p = b64u(JSON.stringify(corpo));
  return p + '.' + assinar(p, secret);
}

// Retorna os claims se o token for valido e nao expirado; senao null
function verificarToken(token, secret) {
  if (!token || !secret) return null;
  var partes = String(token).split('.');
  if (partes.length !== 2) return null;
  var esperado = assinar(partes[0], secret);
  if (!iguais(partes[1], esperado)) return null;
  try {
    var claims = JSON.parse(b64uDecode(partes[0]).toString('utf8'));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (e) {
    return null;
  }
}

function tokenDoHeader(event) {
  var h = (event.headers || {});
  var auth = h.authorization || h.Authorization || '';
  var m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : '';
}

function resposta(status, obj, extra) {
  return {
    statusCode: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}),
    body: JSON.stringify(obj)
  };
}

module.exports = {
  gerarToken: gerarToken,
  verificarToken: verificarToken,
  tokenDoHeader: tokenDoHeader,
  iguais: iguais,
  resposta: resposta
};
