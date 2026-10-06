// Netlify Function: autentique-webhook
// Recebe notificação do Autentique quando documento é assinado
// Configurar no Autentique: conta.autentique.com.br → Webhooks
// URL: https://maria-elegante.netlify.app/.netlify/functions/autentique-webhook
// Variáveis de ambiente:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   AUTENTIQUE_WEBHOOK_SECRET (opcional — string secreta para validar chamadas)

async function supabasePatch(table, filter, body, supabaseUrl, serviceKey) {
  await fetch(supabaseUrl + '/rest/v1/' + table + filter, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function supabaseGet(path, supabaseUrl, serviceKey) {
  const r = await fetch(supabaseUrl + '/rest/v1/' + path, {
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey
    }
  });
  return r.json();
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const WEBHOOK_SECRET = process.env.AUTENTIQUE_WEBHOOK_SECRET;

  // Validação do secret (se configurado)
  if (WEBHOOK_SECRET) {
    const receivedSecret = event.headers['x-autentique-secret'] || event.headers['authorization'];
    if (receivedSecret !== WEBHOOK_SECRET && receivedSecret !== 'Bearer ' + WEBHOOK_SECRET) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  console.log('Autentique webhook:', JSON.stringify(payload));

  // Eventos que indicam assinatura completa
  // O Autentique envia: event = "DOCUMENT_SIGNED" ou "SIGNATORY_SIGNED"
  const evento = payload.event || payload.type || '';
  const docId = payload.document && payload.document.id;

  if (!docId) {
    return { statusCode: 200, body: 'ok (sem doc_id)' };
  }

  try {
    // Busca o holerite pelo autentique_doc_id
    const hols = await supabaseGet(
      'holerites?autentique_doc_id=eq.' + docId + '&select=id,status,func_id',
      SUPABASE_URL, SUPABASE_SERVICE_KEY
    );

    if (!hols || !hols.length) {
      console.log('Holerite não encontrado para doc_id:', docId);
      return { statusCode: 200, body: 'ok (holerite não encontrado)' };
    }

    const hol = hols[0];

    // Marca como assinado
    if (evento.indexOf('SIGN') >= 0 || evento.indexOf('sign') >= 0) {
      await supabasePatch(
        'holerites',
        '?id=eq.' + hol.id,
        {
          status: 'assinado',
          assinado_em: new Date().toISOString()
        },
        SUPABASE_URL, SUPABASE_SERVICE_KEY
      );
      console.log('Holerite ' + hol.id + ' marcado como assinado.');
    }

    // Evento de rejeição
    if (evento.indexOf('REJECT') >= 0 || evento.indexOf('reject') >= 0) {
      await supabasePatch(
        'holerites',
        '?id=eq.' + hol.id,
        { status: 'rejeitado' },
        SUPABASE_URL, SUPABASE_SERVICE_KEY
      );
    }

    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    console.error('Erro webhook:', e);
    return { statusCode: 500, body: 'Erro interno: ' + e.message };
  }
};
