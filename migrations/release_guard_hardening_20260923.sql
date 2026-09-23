create or replace function public.guard_evaluation_release()
returns trigger language plpgsql security definer set search_path=public,extensions
as $fn$
declare v_m public.corpus_release_manifest%rowtype; v_c public.cases%rowtype;
begin
 if not public.collection_open() then raise exception 'A coleta está fechada.'; end if;
 if TG_OP='UPDATE' then
   if new.evaluator_id is distinct from old.evaluator_id or new.case_id is distinct from old.case_id then
     raise exception 'O avaliador e o caso não podem mudar.';
   end if;
 end if;
 select * into v_m from public.corpus_release_manifest where case_id=new.case_id order by created_at desc limit 1;
 select * into v_c from public.cases where id=new.case_id;
 if v_m.case_id is null or v_c.id is null or not v_c.active or
    encode(extensions.digest(v_c.snapshot,'sha256'),'hex') is distinct from v_m.snapshot_en_sha256 or
    encode(extensions.digest(v_c.snapshot_ptbr,'sha256'),'hex') is distinct from v_m.snapshot_ptbr_sha256 then
   raise exception 'A versão do caso não coincide com o manifesto; contate a equipe.';
 end if;
 if TG_OP='UPDATE' then
   if old.release_id is distinct from v_m.release_id or
      old.snapshot_en_sha256 is distinct from v_m.snapshot_en_sha256 or
      old.snapshot_ptbr_sha256 is distinct from v_m.snapshot_ptbr_sha256 then
      raise exception 'A versão de uma avaliação existente não pode mudar.';
   end if;
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

create or replace function public.guard_manifest_after_rating()
returns trigger language plpgsql set search_path=public
as $fn$
declare v_case_id uuid;
begin
 v_case_id:=case when TG_OP='INSERT' then new.case_id else old.case_id end;
 if exists(select 1 from public.evaluations where case_id=v_case_id) then
   raise exception 'Manifesto de caso avaliado é imutável.';
 end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end;
$fn$;
drop trigger if exists manifest_frozen_after_rating on public.corpus_release_manifest;
create trigger manifest_frozen_after_rating before insert or update or delete on public.corpus_release_manifest
 for each row execute function public.guard_manifest_after_rating();
revoke execute on function public.guard_evaluation_release() from public, anon, authenticated;
revoke execute on function public.guard_manifest_after_rating() from public, anon, authenticated;
