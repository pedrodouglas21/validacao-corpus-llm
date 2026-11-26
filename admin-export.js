export const SUMMARY_COLUMNS = [
  "case_code", "proposed_role", "backup_rank", "n_ratings", "i_cvi",
  "mean_pertinence", "mean_complexity", "mean_representativeness", "mean_global_adequacy",
  "blocking_flags", "status", "source_candidate_id", "original_case_id"
];

export const CASE_EXPORT_FIELDS = [...SUMMARY_COLUMNS, "case_id", "n_valid"].join(",");
export const EVALUATION_EXPORT_FIELDS = [
  "id", "case_id", "evaluator_id", "pertinence", "complexity", "representativeness",
  "global_adequacy", "blocking_issue", "blocker_reason", "comment", "is_complete", "saved_at",
  "completed_at", "release_id", "snapshot_en_sha256", "snapshot_ptbr_sha256"
].join(",");
export const PROFILE_EXPORT_FIELDS = [
  "user_id", "code_id", "professional_area", "highest_degree", "years_experience",
  "consent_version", "consented_at"
].join(",");

export const COMPLETE_COLUMNS = [
  "case_code", "evaluator_label", "evaluation_status", "pertinence", "complexity",
  "representativeness", "global_adequacy", "blocking_issue", "blocker_reason", "comment",
  "is_complete", "saved_at", "completed_at", "professional_area", "highest_degree",
  "years_experience", "consent_version", "consented_at", "evaluator_registered", "evaluator_active",
  "release_id", "snapshot_en_sha256", "snapshot_ptbr_sha256", "evaluation_id", "case_id",
  "source_candidate_id", "original_case_id", "proposed_role", "backup_rank", "case_status", "n_ratings",
  "n_valid", "i_cvi", "mean_pertinence", "mean_complexity", "mean_representativeness",
  "mean_global_adequacy", "blocking_flags", "exported_at"
];

export function isTechnicalCode(code) {
  return String(code.label ?? "").trim().toUpperCase().startsWith("TESTE");
}

function pseudonym(code) {
  const number = String(code.label ?? "").trim().match(/^Especialista\s+(\d+)\b/i)?.[1];
  return number ? `Especialista ${Number(number)}` : `EV-${code.id.replaceAll("-", "").slice(0, 12)}`;
}

export function buildCompleteRows(cases, profiles, codes, evaluations, exportedAt) {
  const knownCases = new Set(cases.map(c => c.case_id));
  const profileByCode = new Map(profiles.map(p => [p.code_id, p]));
  const profileByUser = new Map(profiles.map(p => [p.user_id, p]));
  const codeById = new Map(codes.map(c => [c.id, c]));
  const evaluationsByCase = new Map();
  const historicalCodes = new Set();

  for (const evaluation of evaluations) {
    if (!knownCases.has(evaluation.case_id)) continue;
    const code = codeById.get(profileByUser.get(evaluation.evaluator_id)?.code_id);
    if (!code) throw new Error("Há uma avaliação sem vínculo com um código de especialista.");
    if (isTechnicalCode(code)) continue;
    if (!evaluationsByCase.has(evaluation.case_id)) evaluationsByCase.set(evaluation.case_id, new Map());
    const map = evaluationsByCase.get(evaluation.case_id);
    if (map.has(code.id)) throw new Error("Há avaliações duplicadas para o mesmo caso e especialista.");
    map.set(code.id, evaluation);
    historicalCodes.add(code.id);
  }

  const officialCodes = codes
    .filter(c => !isTechnicalCode(c) && (c.active || historicalCodes.has(c.id)))
    .map(c => ({...c, exportLabel: pseudonym(c)}))
    .sort((a, b) => a.exportLabel.localeCompare(b.exportLabel, "pt-BR", {numeric:true}));
  if (!cases.length || !officialCodes.length) throw new Error("Nenhum caso ou especialista foi encontrado.");
  if (new Set(officialCodes.map(c => c.exportLabel)).size !== officialCodes.length) {
    throw new Error("Há códigos de especialistas com a mesma identificação.");
  }

  const rows = [];
  for (const c of cases) {
    const byEvaluator = evaluationsByCase.get(c.case_id);
    const complete = [...(byEvaluator?.values() ?? [])].filter(e => e.is_complete).length;
    if (complete !== Number(c.n_ratings)) {
      throw new Error("As avaliações foram atualizadas durante a exportação. Tente novamente.");
    }
    for (const code of officialCodes) {
      const e = byEvaluator?.get(code.id);
      if (!code.active && !e) continue;
      const p = profileByCode.get(code.id);
      rows.push({
        ...c,
        case_status: c.status,
        evaluator_label: code.exportLabel,
        evaluator_registered: Boolean(p),
        evaluator_active: code.active,
        evaluation_status: e ? (e.is_complete ? "CONCLUIDA" : "RASCUNHO") : "NAO_INICIADA",
        evaluation_id: e?.id,
        pertinence: e?.pertinence,
        complexity: e?.complexity,
        representativeness: e?.representativeness,
        global_adequacy: e?.global_adequacy,
        blocking_issue: e?.blocking_issue,
        blocker_reason: e?.blocker_reason,
        comment: e?.comment,
        is_complete: e?.is_complete,
        saved_at: e?.saved_at,
        completed_at: e?.completed_at,
        release_id: e?.release_id,
        snapshot_en_sha256: e?.snapshot_en_sha256,
        snapshot_ptbr_sha256: e?.snapshot_ptbr_sha256,
        professional_area: p?.professional_area,
        highest_degree: p?.highest_degree,
        years_experience: p?.years_experience,
        consent_version: p?.consent_version,
        consented_at: p?.consented_at,
        exported_at: exportedAt
      });
    }
  }
  return rows;
}

export function buildCaseSummaryWithComments(cases, detail) {
  const labels = [...new Set(detail.map(row => row.evaluator_label))]
    .sort((a,b) => a.localeCompare(b, "pt-BR", {numeric:true}));
  const commentColumns = new Map(labels.map(label => {
    const number = label.match(/^Especialista (\d+)$/)?.[1];
    return [label, number ? `comentario_especialista_${number}` : `comentario_${label.toLowerCase().replaceAll("-", "_")}`];
  }));
  const commentsByCase = new Map();
  for (const row of detail) {
    if (row.comment == null) continue;
    if (!commentsByCase.has(row.case_id)) commentsByCase.set(row.case_id, {});
    commentsByCase.get(row.case_id)[commentColumns.get(row.evaluator_label)] = row.comment;
  }
  return {
    columns: [...SUMMARY_COLUMNS, ...commentColumns.values()],
    rows: cases.map(row => ({...row, ...commentsByCase.get(row.case_id)}))
  };
}

export async function fetchExportRows(client, table, columns, orderBy) {
  const rows = [];
  const batchSize = 500;
  let expectedCount;
  do {
    const {data, count, error} = await client.from(table).select(columns, {count:"exact"})
      .order(orderBy, {ascending:true}).range(rows.length, rows.length + batchSize - 1);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isInteger(count) || (expectedCount !== undefined && count !== expectedCount)) {
      throw new Error("A quantidade de registros mudou durante a exportação. Tente novamente.");
    }
    expectedCount = count;
    if ((!data.length && rows.length < count) || rows.length + data.length > count) {
      throw new Error("A leitura dos registros ficou incompleta. Tente novamente.");
    }
    rows.push(...data);
  } while (rows.length < expectedCount);
  if (new Set(rows.map(r => r[orderBy])).size !== rows.length) {
    throw new Error("Os registros mudaram durante a exportação. Tente novamente.");
  }
  return rows;
}

function csvCell(value) {
  let text = value == null ? "" : typeof value === "number" ? String(value).replace(".", ",") : String(value);
  // Mantém conteúdo digitado como texto ao abrir o CSV no Excel.
  if (typeof value === "string" && (/^[\t\r\n]/.test(text) || /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text))) text = "'" + text;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function makeCsv(rows, columns) {
  const body = rows.map(row => columns.map(col => csvCell(row[col])).join(";"));
  return "\uFEFF" + [columns.join(";"), ...body].join("\r\n") + "\r\n";
}
