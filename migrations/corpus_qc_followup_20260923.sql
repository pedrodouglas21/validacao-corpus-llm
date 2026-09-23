-- A trilha histórica é mantida; as decisões substituídas ficam identificadas.
alter table public.qc_case_audit add column if not exists resolution_status text not null default 'historical_reviewed';
alter table public.qc_case_audit add column if not exists resolution_note text;
update public.qc_case_audit
set resolution_status='superseded_by_source_fidelity_v2',
    resolution_note='A curadoria v2 não substituiu a TFGe por CKD-EPI. Preservou a TFGe do Synthea e omitiu a creatinina conflitante da camada apresentada; o bruto permanece íntegro.'
where flag_code='EGFR_CKD_EPI_DISCORDANCE';
update public.qc_case_audit
set resolution_status='superseded_by_source_fidelity_v2',
    resolution_note='A curadoria v2 generalizou o estágio discordante para doença renal crônica, sem reestadiamento automático.'
where flag_code='CKD_STAGE_CURRENT_EGFR_DISCORDANCE';

alter table public.qc_case_review_v2 add column if not exists source_check_required boolean not null default false;
alter table public.qc_case_review_v2 add column if not exists source_check_note text;
update public.qc_case_review_v2 q
set source_check_required=true,
    prepanel_status='SOURCE_CHECK_PENDING',
    source_check_note=concat_ws(' ',
      case when c.snapshot ~ 'eGFR: [^\n]+ mL/min \('
        then 'Confirmar unidade e significado da TFGe no Observation original: aparece em mL/min, sem indexação explícita por 1,73 m².' end,
      case when c.case_code='VAL-080'
        then 'Confirmar proveniência/data da bilirrubina total 7,2 mg/dL e AST 3,4 U/L; preservar os valores até conferência da fonte.' end)
from public.cases c
where q.case_id=c.id and
 (c.snapshot ~ 'eGFR: [^\n]+ mL/min \(' or c.case_code='VAL-080');

insert into public.qc_method_log(category,decision,rationale,status)
values ('Auditoria documental pré-painel 23-09-2026',
 'Treze casos com unidade de TFGe não indexada e VAL-080 com perfil hepático inesperado ficam em verificação de proveniência pontual. Nenhum valor foi inventado, descartado ou alterado na camada curada por esta auditoria.',
 'A checagem exige apenas os recursos Observation/Encounter pertinentes dos pacientes sintéticos correspondentes; a exportação Synthea completa não é necessária nesta fase. A adequação clínica final continua a cargo de seis especialistas.',
 'active');
