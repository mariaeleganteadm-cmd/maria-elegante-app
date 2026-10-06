// Netlify Function: enviar-holerite
// Envia holerite para assinatura digital via Autentique
// Variáveis de ambiente necessárias no painel Netlify:
//   AUTENTIQUE_API_KEY  — chave da API do Autentique (conta.autentique.com.br → API)
//   SUPABASE_URL        — https://wkiwpszvhprjkilppdbr.supabase.co
//   SUPABASE_SERVICE_KEY — service_role key do Supabase (Settings → API)

const AUTENTIQUE_GRAPHQL = 'https://api.autentique.com.br/2/graphql';

async function supabaseGet(path, supabaseUrl, serviceKey) {
  const r = await fetch(supabaseUrl + '/rest/v1/' + path, {
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey
    }
  });
  return r.json();
}

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

async function criarDocumentoAutentique(apiKey, nomeDoc, signataria) {
  // Autentique API v2 — GraphQL
  // signataria: { nome, email, telefone }
  // Cria documento com 1 signatário
  const mutation = `
    mutation CreateDocument($document: DocumentInput!, $signatories: [SignatoryInput!]!) {
      createDocument(document: $document, signatories: $signatories) {
        id
        name
        signatures {
          public_id
          link {
            short_link
          }
          action {
            name
          }
          name
          email
        }
      }
    }
  `;

  const variables = {
    document: {
      name: nomeDoc,
      message: 'Por favor, assine seu holerite digitalmente. A assinatura é juridicamente válida.',
      reminder: true
    },
    signatories: [
      {
        name: signataria.nome,
        email: signataria.email || '',
        action: 'SIGN',
        positions: []
      }
    ]
  };

  const res = await fetch(AUTENTIQUE_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({ query: mutation, variables: variables })
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error('Autentique: ' + JSON.stringify(json.errors));
  }
  return json.data.createDocument;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erro: 'Método não permitido' }) };
  }

  const AUTENTIQUE_API_KEY = process.env.AUTENTIQUE_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wkiwpszvhprjkilppdbr.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!AUTENTIQUE_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ erro: 'AUTENTIQUE_API_KEY não configurada no Netlify.' }) };
  }
  if (!SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ erro: 'SUPABASE_SERVICE_KEY não configurada no Netlify.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ erro: 'JSON inválido' }) };
  }

  const { holerite_id } = body;
  if (!holerite_id) {
    return { statusCode: 400, body: JSON.stringify({ erro: 'holerite_id obrigatório' }) };
  }

  try {
    // 1. Busca dados do holerite
    const hols = await supabaseGet(
      'holerites?id=eq.' + holerite_id + '&select=*',
      SUPABASE_URL, SUPABASE_SERVICE_KEY
    );
    if (!hols || !hols.length) {
      return { statusCode: 404, body: JSON.stringify({ erro: 'Holerite não encontrado' }) };
    }
    const hol = hols[0];

    // 2. Busca dados da funcionária
    const funcs = await supabaseGet(
      'funcionarias?id=eq.' + hol.func_id + '&select=id,nome,telefone,email',
      SUPABASE_URL, SUPABASE_SERVICE_KEY
    );
    if (!funcs || !funcs.length) {
      return { statusCode: 404, body: JSON.stringify({ erro: 'Funcionária não encontrada' }) };
    }
    const func = funcs[0];

    if (!func.email) {
      return {
        statusCode: 422,
        body: JSON.stringify({ erro: 'Funcionária ' + func.nome + ' não tem e-mail cadastrado. Cadastre o e-mail dela na tela de Equipe.' })
      };
    }

    // 3. Nome do documento
    const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const nomeDoc = 'Holerite ' + func.nome + ' — ' + MESES_NOMES[hol.mes - 1] + '/' + hol.ano;

    // 4. Cria documento no Autentique
    const docAutentique = await criarDocumentoAutentique(AUTENTIQUE_API_KEY, nomeDoc, func);

    // 5. Pega o link de assinatura
    const signLink = docAutentique.signatures && docAutentique.signatures[0]
      ? (docAutentique.signatures[0].link && docAutentique.signatures[0].link.short_link)
      : null;

    // 6. Atualiza holerite no Supabase
    await supabasePatch(
      'holerites',
      '?id=eq.' + holerite_id,
      {
        status: 'enviado',
        autentique_doc_id: docAutentique.id,
        autentique_sign_url: signLink,
        enviado_em: new Date().toISOString()
      },
      SUPABASE_URL, SUPABASE_SERVICE_KEY
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        doc_id: docAutentique.id,
        sign_url: signLink,
        funcionaria: func.nome
      })
    };

  } catch (e) {
    console.error('Erro enviar-holerite:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ erro: e.message || 'Erro interno' })
    };
  }
};
