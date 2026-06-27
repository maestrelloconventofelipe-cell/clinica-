// Exportação de relatórios para planilha (CSV).
//
// Escolha por CSV (sem dependências novas) alinhada ao princípio do MVP:
// "mais barato e simples". O arquivo abre diretamente no Excel / Google Sheets
// como planilha. Usamos:
//   • BOM UTF-8 (﻿) para o Excel reconhecer acentos corretamente
//   • separador ';' (padrão pt-BR do Excel)
//   • escaping RFC 4180 (aspas duplicadas; campos com ; " ou quebra vão entre aspas)

const SEPARADOR = ";";

function escaparCampo(valor: unknown): string {
  const s = valor == null ? "" : String(valor);
  if (s.includes(SEPARADOR) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Gera o conteúdo CSV a partir de cabeçalhos + linhas.
 */
export function montarCsv(cabecalhos: string[], linhas: Array<Array<unknown>>): string {
  const corpo = [cabecalhos, ...linhas]
    .map((linha) => linha.map(escaparCampo).join(SEPARADOR))
    .join("\r\n");
  return `﻿${corpo}`;
}

/**
 * Dispara o download de uma planilha CSV no navegador.
 * O nome recebe a extensão .csv automaticamente se ausente.
 */
export function baixarCsv(
  nomeArquivo: string,
  cabecalhos: string[],
  linhas: Array<Array<unknown>>,
): void {
  const nome = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`;
  const conteudo = montarCsv(cabecalhos, linhas);
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
