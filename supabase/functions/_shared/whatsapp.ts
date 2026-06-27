// Adapter de WhatsApp — ponto único de envio de mensagens.
//
// Provider selecionável via env WHATSAPP_PROVIDER (padrão: "meta_cloud").
// Hoje só a Cloud API oficial da Meta (Graph API v21.0) é implementada — o
// CLAUDE.md proíbe Evolution API e wrappers não-oficiais. A estrutura abaixo
// permite plugar um 2º provider na Fase 2 sem tocar em nenhum chamador:
// enviarTexto()/enviarTemplate() mantêm a mesma assinatura.
//
// Importado por whatsapp-webhook, enviar-confirmacoes, expirar-ofertas e
// recuperar-vaga (indiretamente via listaEspera).

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

// ---------------------------------------------------------------------------
// Contrato do provider
// ---------------------------------------------------------------------------

interface ProvedorWhatsapp {
  enviarTexto(
    phoneNumberId: string,
    destinatario: string,
    texto: string,
    token: string,
  ): Promise<void>;

  enviarTemplate(
    phoneNumberId: string,
    destinatario: string,
    nomeTemplate: string,
    parametrosCorpo: string[],
    token: string,
    codigoIdioma: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Provider: Meta Cloud API (oficial)
// ---------------------------------------------------------------------------

const provedorMetaCloud: ProvedorWhatsapp = {
  async enviarTexto(phoneNumberId, destinatario, texto, token) {
    await postarMensagemMeta(phoneNumberId, token, {
      messaging_product: "whatsapp",
      to:   destinatario,
      type: "text",
      text: { body: texto },
    });
  },

  async enviarTemplate(phoneNumberId, destinatario, nomeTemplate, parametrosCorpo, token, codigoIdioma) {
    await postarMensagemMeta(phoneNumberId, token, {
      messaging_product: "whatsapp",
      to:   destinatario,
      type: "template",
      template: {
        name:     nomeTemplate,
        language: { code: codigoIdioma },
        components: parametrosCorpo.length
          ? [
              {
                type: "body",
                parameters: parametrosCorpo.map((text) => ({ type: "text", text })),
              },
            ]
          : [],
      },
    });
  },
};

async function postarMensagemMeta(
  phoneNumberId: string,
  token: string,
  corpo: unknown,
): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(corpo),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API ${res.status}: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Seleção do provider
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, ProvedorWhatsapp> = {
  meta_cloud: provedorMetaCloud,
};

function obterProvedor(): ProvedorWhatsapp {
  const nome = Deno.env.get("WHATSAPP_PROVIDER") ?? "meta_cloud";
  const provedor = PROVIDERS[nome];
  if (!provedor) {
    throw new Error(
      `WHATSAPP_PROVIDER desconhecido: "${nome}". Providers disponíveis: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return provedor;
}

// ---------------------------------------------------------------------------
// API pública (assinaturas preservadas — chamadores não mudam)
// ---------------------------------------------------------------------------

/**
 * Mensagem de texto livre — válida apenas dentro da janela de 24 h do paciente.
 */
export function enviarTexto(
  phoneNumberId: string,
  destinatario: string,
  texto: string,
  token: string,
): Promise<void> {
  return obterProvedor().enviarTexto(phoneNumberId, destinatario, texto, token);
}

/**
 * Mensagem via template pré-aprovado — obrigatório para mensagens proativas
 * (fora da janela de 24 h ou para iniciar conversa).
 *
 * parametrosCorpo: valores para {{1}}, {{2}}, … no corpo do template.
 */
export function enviarTemplate(
  phoneNumberId: string,
  destinatario: string,
  nomeTemplate: string,
  parametrosCorpo: string[],
  token: string,
  codigoIdioma = "pt_BR",
): Promise<void> {
  return obterProvedor().enviarTemplate(
    phoneNumberId,
    destinatario,
    nomeTemplate,
    parametrosCorpo,
    token,
    codigoIdioma,
  );
}
