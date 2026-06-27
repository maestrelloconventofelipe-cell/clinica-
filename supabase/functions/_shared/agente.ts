// Módulo reutilizável do agente Claude com tool use.
// Importado por whatsapp-webhook e por outras Edge Functions futuras.

import Anthropic from "npm:@anthropic-ai/sdk@0.106.0";
import type { DbClient } from "./db.ts";
import { estaLivre, horariosLivres } from "./agenda.ts";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface MensagemHistorico {
  papel: "user" | "assistant";
  conteudo: string;
}

export interface OpcoesChamadaAgente {
  supabase: DbClient;
  clinicaId: string;
  clinicaNome: string;
  telefone: string;
  mensagem: string;
  historico: MensagemHistorico[];
  apiKey: string;
  modelo?: string;
}

// ---------------------------------------------------------------------------
// Definição das ferramentas (imutável — compartilhada entre chamadas)
// ---------------------------------------------------------------------------

const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: "consultar_horarios",
    description:
      "Lista os horários disponíveis de um profissional nos próximos dias. " +
      "Chame SEMPRE antes de oferecer qualquer horário ao paciente.",
    input_schema: {
      type: "object" as const,
      properties: {
        profissional_id: {
          type: "string",
          description: "UUID do profissional",
        },
        dias: {
          type: "number",
          description: "Janela de consulta em dias (padrão: 7, máximo: 30)",
        },
      },
      required: ["profissional_id"],
    },
  },
  {
    name: "agendar",
    description:
      "Cria o agendamento após confirmação explícita do paciente. " +
      "Revalida a disponibilidade internamente antes de inserir — se o horário " +
      "estiver ocupado, retorna erro e orienta a chamar consultar_horarios novamente.",
    input_schema: {
      type: "object" as const,
      properties: {
        profissional_id: {
          type: "string",
          description: "UUID do profissional",
        },
        paciente_nome: {
          type: "string",
          description: "Nome completo do paciente",
        },
        inicio: {
          type: "string",
          description: "Data/hora de início em ISO 8601 UTC (ex: 2030-01-07T11:00:00.000Z)",
        },
      },
      required: ["profissional_id", "paciente_nome", "inicio"],
    },
  },
  {
    name: "entrar_lista_espera",
    description:
      "Coloca o paciente na lista de espera quando não há horário disponível. " +
      "Sempre informe o paciente de que ele será avisado assim que surgir uma vaga.",
    input_schema: {
      type: "object" as const,
      properties: {
        profissional_id: {
          type: "string",
          description: "UUID do profissional",
        },
        preferencia: {
          type: "string",
          description: "Preferência de horário declarada pelo paciente (ex: manhã, tarde, qualquer)",
        },
      },
      required: ["profissional_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// chamarAgente — loop agêntico principal
// ---------------------------------------------------------------------------

/**
 * Executa o loop agêntico até obter uma resposta final de texto.
 * Limita a 8 turnos para evitar loop infinito em caso de ferramenta que erra.
 */
export async function chamarAgente(
  opcoes: OpcoesChamadaAgente,
): Promise<string> {
  const {
    supabase,
    clinicaId,
    clinicaNome,
    telefone,
    mensagem,
    historico,
    apiKey,
    modelo = "claude-haiku-4-5-20251001",
  } = opcoes;

  const anthropic = new Anthropic({ apiKey });

  const sistemaPrompt = `Você é o assistente virtual de agendamentos da clínica *${clinicaNome}*.
Missão: ajudar pacientes a agendar, confirmar e remarcar consultas pelo WhatsApp.

REGRAS OBRIGATÓRIAS — siga sempre, sem exceção:
1. Nunca ofereça um horário sem antes chamar a ferramenta *consultar_horarios*. Inventar horários é proibido.
2. Ao apresentar opções ao paciente, liste no máximo 5 slots, com data e hora legíveis (ex: "terça-feira, 7 de janeiro às 10h").
3. Antes de chamar *agendar*, apresente os dados completos e peça confirmação explícita:
   "Para confirmar: *[dia e hora]* com *[profissional]*. Responda *SIM* para confirmar ou *NÃO* para cancelar."
4. Só chame *agendar* quando o paciente responder SIM nesta conversa.
5. Se não houver horários disponíveis, ofereça a lista de espera via *entrar_lista_espera*.
6. Responda sempre em português brasileiro, de forma cordial e concisa (no máximo 3 parágrafos curtos).
7. Se a mensagem não for sobre agendamento, informe gentilmente que você só auxilia com consultas.`;

  // Monta a conversa: histórico + mensagem atual
  const mensagens: Anthropic.MessageParam[] = [
    ...historico.map((h) => ({
      role: h.papel as "user" | "assistant",
      content: h.conteudo,
    })),
    { role: "user" as const, content: mensagem },
  ];

  // Loop agêntico — máximo de 8 turnos
  for (let turno = 0; turno < 8; turno++) {
    const resposta = await anthropic.messages.create({
      model:      modelo,
      max_tokens: 1024,
      system:     sistemaPrompt,
      tools:      FERRAMENTAS,
      messages:   mensagens,
    });

    // Resposta final de texto → encerra o loop
    if (resposta.stop_reason === "end_turn") {
      const bloco = resposta.content.find((b) => b.type === "text");
      return bloco?.type === "text"
        ? bloco.text
        : "Desculpe, ocorreu um problema interno. Tente novamente.";
    }

    // Modelo chamou uma ou mais ferramentas
    if (resposta.stop_reason === "tool_use") {
      const resultados: Anthropic.ToolResultBlockParam[] = [];

      for (const bloco of resposta.content) {
        if (bloco.type !== "tool_use") continue;

        let saida: string;
        try {
          saida = await executarFerramenta(
            supabase,
            clinicaId,
            telefone,
            bloco.name,
            bloco.input as Record<string, unknown>,
          );
        } catch (err) {
          saida = JSON.stringify({ erro: String(err) });
        }

        resultados.push({
          type:        "tool_result",
          tool_use_id: bloco.id,
          content:     saida,
        });
      }

      // Alimenta o turno do assistente + resultados de volta ao modelo
      mensagens.push({ role: "assistant", content: resposta.content });
      mensagens.push({ role: "user", content: resultados });
      continue;
    }

    // max_tokens ou stop_reason inesperado — retorna o que houver
    const bloco = resposta.content.find((b) => b.type === "text");
    return bloco?.type === "text"
      ? bloco.text
      : "Desculpe, não consegui processar sua solicitação.";
  }

  return "Desculpe, o assistente atingiu o limite de processamento. Por favor, tente novamente.";
}

// ---------------------------------------------------------------------------
// Execução das ferramentas (interno)
// ---------------------------------------------------------------------------

async function executarFerramenta(
  supabase: DbClient,
  clinicaId: string,
  telefone: string,
  nome: string,
  entrada: Record<string, unknown>,
): Promise<string> {
  switch (nome) {
    // -----------------------------------------------------------------------
    case "consultar_horarios": {
      const profId = entrada.profissional_id as string;
      const dias   = typeof entrada.dias === "number"
        ? Math.min(entrada.dias, 30)
        : 7;

      const slots = await horariosLivres(supabase, profId, dias);

      if (!slots.length) {
        return JSON.stringify({
          mensagem: "Sem horários disponíveis nos próximos dias.",
        });
      }
      return JSON.stringify(slots);
    }

    // -----------------------------------------------------------------------
    case "agendar": {
      const profId       = entrada.profissional_id as string;
      const pacienteNome = entrada.paciente_nome as string;
      const inicio       = entrada.inicio as string;

      // Buscar duração padrão do profissional para calcular o fim
      const { data: prof, error: profErr } = await supabase
        .from("profissionais")
        .select("duracao_padrao_min")
        .eq("id", profId)
        .single<{ duracao_padrao_min: number }>();

      if (profErr || !prof) {
        return JSON.stringify({ erro: "Profissional não encontrado." });
      }

      const fim = new Date(
        new Date(inicio).getTime() + prof.duracao_padrao_min * 60_000,
      ).toISOString();

      // Revalidar disponibilidade antes de inserir (corrida entre usuários)
      const livre = await estaLivre(supabase, profId, inicio, fim);
      if (!livre) {
        return JSON.stringify({
          erro: "Horário não está mais disponível. Use consultar_horarios para ver as novas opções.",
        });
      }

      // Upsert do paciente identificado pelo telefone dentro da clínica
      const { data: paciente, error: pacErr } = await supabase
        .from("pacientes")
        .upsert(
          { clinica_id: clinicaId, nome: pacienteNome, telefone },
          { onConflict: "clinica_id,telefone" },
        )
        .select("id")
        .single<{ id: string }>();

      if (pacErr || !paciente) {
        return JSON.stringify({
          erro: `Erro ao cadastrar paciente: ${pacErr?.message}`,
        });
      }

      // Criar agendamento
      const { data: ag, error: agErr } = await supabase
        .from("agendamentos")
        .insert({
          clinica_id:      clinicaId,
          profissional_id: profId,
          paciente_id:     paciente.id,
          inicio,
          fim,
          status:  "agendado",
          origem:  "whatsapp",
        })
        .select("id")
        .single<{ id: string }>();

      if (agErr || !ag) {
        return JSON.stringify({
          erro: `Erro ao criar agendamento: ${agErr?.message}`,
        });
      }

      return JSON.stringify({ sucesso: true, agendamento_id: ag.id, inicio, fim });
    }

    // -----------------------------------------------------------------------
    case "entrar_lista_espera": {
      const profId      = entrada.profissional_id as string;
      const preferencia = typeof entrada.preferencia === "string"
        ? entrada.preferencia
        : "qualquer";

      // Upsert do paciente (nome provisório — atualizado em contatos futuros)
      const { data: paciente, error: pacErr } = await supabase
        .from("pacientes")
        .upsert(
          { clinica_id: clinicaId, nome: "Paciente WhatsApp", telefone },
          { onConflict: "clinica_id,telefone" },
        )
        .select("id")
        .single<{ id: string }>();

      if (pacErr || !paciente) {
        return JSON.stringify({
          erro: `Erro ao cadastrar paciente: ${pacErr?.message}`,
        });
      }

      const { error: espErr } = await supabase
        .from("lista_espera")
        .insert({
          clinica_id:      clinicaId,
          profissional_id: profId,
          paciente_id:     paciente.id,
          preferencia,
          status: "aguardando",
        });

      if (espErr) {
        return JSON.stringify({ erro: espErr.message });
      }

      return JSON.stringify({ sucesso: true });
    }

    // -----------------------------------------------------------------------
    default:
      return JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` });
  }
}
