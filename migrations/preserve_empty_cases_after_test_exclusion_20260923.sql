-- Correção aplicada em 23-09-2026.
-- Mantém os 85 casos visíveis e exclui somente avaliações de códigos técnicos
-- (rótulo iniciado por TESTE) dos indicadores oficiais.
create or replace view public.v_case_cvi as
select
  c.id as case_id,
  c.case_code,
  count(e.id) filter (where e.is_complete) as n_ratings,
  count(e.id) filter (where e.is_complete and e.global_adequacy >= 3) as n_valid,
  round(avg(
    case
      when e.is_complete then
        case when e.global_adequacy >= 3 then 1.0 else 0.0 end
      else null::numeric
    end
  ), 3) as i_cvi,
  round(avg(e.pertinence) filter (where e.is_complete), 2) as mean_pertinence,
  round(avg(e.complexity) filter (where e.is_complete), 2) as mean_complexity,
  round(avg(e.representativeness) filter (where e.is_complete), 2) as mean_representativeness,
  round(avg(e.global_adequacy) filter (where e.is_complete), 2) as mean_global_adequacy,
  count(e.id) filter (where e.is_complete and e.blocking_issue = true) as blocking_flags
from public.cases c
left join (
  select e.*
  from public.evaluations e
  where not exists (
    select 1
    from public.evaluator_profiles ep
    join public.evaluator_codes ec on ec.id = ep.code_id
    where ep.user_id = e.evaluator_id
      and coalesce(ec.label, '') ilike 'TESTE%'
  )
) e on e.case_id = c.id
where c.active = true
group by c.id, c.case_code;
