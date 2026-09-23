-- Preparação pré-painel: nenhuma avaliação registrada no momento da aplicação.
create table if not exists public.collection_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  consent_version text not null,
  updated_at timestamptz not null default now()
);
alter table public.collection_control enable row level security;
revoke all on public.collection_control from anon, authenticated;
insert into public.collection_control(singleton,enabled,consent_version)
values (true,false,'TCLE-2026-09-20')
on conflict (singleton) do update set enabled=false, updated_at=now();

create or replace function public.collection_open()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select enabled from public.collection_control where singleton),false) $$;
revoke all on function public.collection_open() from public;
grant execute on function public.collection_open() to authenticated;

create or replace function public.my_access_ok()
returns boolean language sql stable security definer set search_path=public
as $$
 select exists(
   select 1 from public.evaluator_profiles p
   join public.evaluator_codes c on c.id=p.code_id
   join public.collection_control ctrl on ctrl.singleton
   where p.user_id=auth.uid() and c.active and c.claimed_by=auth.uid()
     and p.consented_at is not null and p.consent_version=ctrl.consent_version
     and nullif(btrim(p.professional_area),'') is not null
     and nullif(btrim(p.highest_degree),'') is not null
     and p.years_experience between 0 and 80
 );
$$;

create or replace function public.claim_evaluator_code(
 p_code text,p_professional_area text default null,p_highest_degree text default null,
 p_years_experience integer default null,p_consent_version text default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions,auth
as $fn$
declare v_uid uuid:=auth.uid(); v_code_id uuid; v_consent text;
begin
 if v_uid is null then return jsonb_build_object('ok',false,'message','Sessão não autenticada.'); end if;
 if not public.collection_open() then return jsonb_build_object('ok',false,'message','A coleta ainda não está aberta.'); end if;
 if not exists(select 1 from auth.users where id=v_uid) then
   return jsonb_build_object('ok',false,'message','Sessão expirada. Entre novamente.');
 end if;
 select consent_version into v_consent from public.collection_control where singleton;
 if p_consent_version is distinct from v_consent or
    nullif(btrim(p_professional_area),'') is null or
    nullif(btrim(p_highest_degree),'') is null or
    p_years_experience not between 0 and 80 or
    length(btrim(p_professional_area))>120 or length(btrim(p_highest_degree))>120 then
   return jsonb_build_object('ok',false,'message','Preencha os dados exigidos e confirme o TCLE vigente.');
 end if;
 select id into v_code_id from public.evaluator_codes
 where active and code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
   and (claimed_by is null or claimed_by=v_uid) for update;
 if v_code_id is null then return jsonb_build_object('ok',false,'message','Código inválido ou já utilizado. Se mudou de dispositivo, procure a equipe da pesquisa.'); end if;
 if exists(select 1 from public.evaluator_profiles where user_id=v_uid and code_id is distinct from v_code_id) then
   return jsonb_build_object('ok',false,'message','Esta sessão já está vinculada a outro código.');
 end if;
 update public.evaluator_codes set claimed_by=v_uid,claimed_at=coalesce(claimed_at,now()) where id=v_code_id;
 insert into public.evaluator_profiles(user_id,code_id,professional_area,highest_degree,years_experience,consent_version,consented_at)
 values (v_uid,v_code_id,btrim(p_professional_area),btrim(p_highest_degree),p_years_experience,p_consent_version,now())
 on conflict (user_id) do update set
   professional_area=excluded.professional_area,highest_degree=excluded.highest_degree,
   years_experience=excluded.years_experience,
   consent_version=excluded.consent_version,
   consented_at=coalesce(public.evaluator_profiles.consented_at,excluded.consented_at);
 return jsonb_build_object('ok',true,'message','Acesso validado.');
end;
$fn$;
revoke all on function public.claim_evaluator_code(text,text,text,integer,text) from public;
grant execute on function public.claim_evaluator_code(text,text,text,integer,text) to authenticated;

drop policy if exists "own profile update" on public.evaluator_profiles;
revoke update on public.evaluator_profiles from authenticated;
-- Não há atualização direta de código, identidade ou consentimento pelo cliente.

-- RLS controla linhas; privilégios de coluna protegem a camada de origem e QC.
revoke select on public.cases from anon,authenticated;
grant select (id,case_code,snapshot,snapshot_ptbr,active) on public.cases to authenticated;

drop policy if exists "validated own evaluations insert" on public.evaluations;
drop policy if exists "validated own evaluations update" on public.evaluations;
create policy "validated own evaluations insert" on public.evaluations for insert to authenticated
 with check (evaluator_id=auth.uid() and public.my_access_ok() and public.collection_open());
create policy "validated own evaluations update" on public.evaluations for update to authenticated
 using (evaluator_id=auth.uid() and public.my_access_ok() and public.collection_open())
 with check (evaluator_id=auth.uid() and public.my_access_ok() and public.collection_open());

alter table public.evaluations add column if not exists release_id text;
alter table public.evaluations add column if not exists snapshot_en_sha256 text;
alter table public.evaluations add column if not exists snapshot_ptbr_sha256 text;
alter table public.evaluations add constraint evaluations_complete_valid
 check (not is_complete or (
    pertinence between 1 and 4 and complexity between 1 and 4 and
    representativeness between 1 and 4 and global_adequacy between 1 and 4 and
    blocking_issue is not null and
    (blocking_issue=false or nullif(btrim(blocker_reason),'') is not null)
 ));

create or replace function public.guard_evaluation_release()
returns trigger language plpgsql security definer set search_path=public,extensions
as $fn$
declare v_m public.corpus_release_manifest%rowtype; v_c public.cases%rowtype;
begin
 if not public.collection_open() then raise exception 'A coleta está fechada.'; end if;
 if TG_OP='UPDATE' and (new.evaluator_id is distinct from old.evaluator_id or new.case_id is distinct from old.case_id) then
   raise exception 'O avaliador e o caso não podem mudar.';
 end if;
 select * into v_m from public.corpus_release_manifest where case_id=new.case_id order by created_at desc limit 1;
 select * into v_c from public.cases where id=new.case_id;
 if v_m.case_id is null or v_c.id is null or not v_c.active or
    encode(extensions.digest(v_c.snapshot,'sha256'),'hex') is distinct from v_m.snapshot_en_sha256 or
    encode(extensions.digest(v_c.snapshot_ptbr,'sha256'),'hex') is distinct from v_m.snapshot_ptbr_sha256 then
   raise exception 'A versão do caso não coincide com o manifesto; contate a equipe.';
 end if;
 if TG_OP='UPDATE' and (old.release_id is distinct from v_m.release_id or
     old.snapshot_en_sha256 is distinct from v_m.snapshot_en_sha256 or
     old.snapshot_ptbr_sha256 is distinct from v_m.snapshot_ptbr_sha256) then
   raise exception 'A versão de uma avaliação existente não pode mudar.';
 end if;
 new.release_id:=v_m.release_id;
 new.snapshot_en_sha256:=v_m.snapshot_en_sha256;
 new.snapshot_ptbr_sha256:=v_m.snapshot_ptbr_sha256;
 new.saved_at:=now();
 if new.is_complete then
   if TG_OP='UPDATE' then new.completed_at:=coalesce(old.completed_at,now());
   else new.completed_at:=now(); end if;
 else new.completed_at:=null; end if;
 return new;
end;
$fn$;
-- Em INSERT, OLD não existe: referência a OLD fica dentro de um ramo condicional.
create trigger evaluations_release_guard before insert or update on public.evaluations
 for each row execute function public.guard_evaluation_release();

create or replace function public.guard_frozen_case()
returns trigger language plpgsql set search_path=public
as $fn$
begin
 if exists(select 1 from public.evaluations where case_id=old.id) and
    (new.snapshot is distinct from old.snapshot or new.snapshot_ptbr is distinct from old.snapshot_ptbr or
     new.active is distinct from old.active or new.case_code is distinct from old.case_code) then
   raise exception 'Caso já avaliado: crie um novo release e documente a decisão.';
 end if;
 return new;
end;
$fn$;
create trigger cases_frozen_after_rating before update on public.cases
 for each row execute function public.guard_frozen_case();

create or replace function public.guard_manifest_after_rating()
returns trigger language plpgsql set search_path=public
as $fn$
begin
 if exists(select 1 from public.evaluations where case_id=old.case_id) then
   raise exception 'Manifesto de caso avaliado é imutável.';
 end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end;
$fn$;
create trigger manifest_frozen_after_rating before update or delete on public.corpus_release_manifest
 for each row execute function public.guard_manifest_after_rating();

update public.qc_method_log set status='superseded' where id in (5,9) and status='active';
