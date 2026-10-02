-- One-time recovery for a specialist whose browser session was lost.
-- Applied to Supabase project tixlqodhusvhfhcnwyvp on 2026-10-02.

ALTER TABLE public.evaluator_codes
  ADD COLUMN IF NOT EXISTS recovery_used_at timestamptz;

CREATE OR REPLACE FUNCTION public.resume_evaluator_code(
  p_code text,
  p_professional_area text DEFAULT NULL::text,
  p_highest_degree text DEFAULT NULL::text,
  p_years_experience integer DEFAULT NULL::integer,
  p_consent_version text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_anonymous boolean;
  v_code_id uuid;
  v_claimed_by uuid;
  v_recovery_used_at timestamptz;
  v_consent text;
  v_old_area text;
  v_old_degree text;
  v_old_years integer;
  v_old_consent text;
  v_current_evaluations integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão não autenticada.');
  END IF;

  SELECT u.is_anonymous INTO v_is_anonymous
  FROM auth.users u
  WHERE u.id=v_uid;

  IF NOT COALESCE(v_is_anonymous,false) THEN
    RETURN jsonb_build_object('ok',false,'message','A recuperação exige a sessão anônima da validação.');
  END IF;

  IF NOT public.collection_open() THEN
    RETURN jsonb_build_object('ok',false,'message','A coleta ainda não está aberta.');
  END IF;

  SELECT consent_version INTO v_consent
  FROM public.collection_control
  WHERE singleton;

  IF p_consent_version IS DISTINCT FROM v_consent
     OR NULLIF(btrim(p_professional_area),'') IS NULL
     OR NULLIF(btrim(p_highest_degree),'') IS NULL
     OR p_years_experience IS NULL
     OR p_years_experience NOT BETWEEN 0 AND 80
     OR length(btrim(p_professional_area)) > 120
     OR length(btrim(p_highest_degree)) > 120 THEN
    RETURN jsonb_build_object('ok',false,'message','Preencha os dados exigidos e confirme o TCLE vigente.');
  END IF;

  SELECT c.id, c.claimed_by, c.recovery_used_at
    INTO v_code_id, v_claimed_by, v_recovery_used_at
  FROM public.evaluator_codes c
  WHERE c.active
    AND c.code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
  FOR UPDATE;

  IF v_code_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Código inválido ou já utilizado.');
  END IF;

  IF v_claimed_by = v_uid THEN
    RETURN jsonb_build_object('ok',true,'recovered',false,'message','Acesso validado.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.evaluator_profiles
    WHERE user_id=v_uid
  ) OR EXISTS (
    SELECT 1 FROM public.evaluations
    WHERE evaluator_id=v_uid
  ) THEN
    RETURN jsonb_build_object('ok',false,'message','Esta sessão já possui dados de outra avaliação.');
  END IF;

  IF v_claimed_by IS NULL THEN
    UPDATE public.evaluator_codes
       SET claimed_by=v_uid, claimed_at=COALESCE(claimed_at,now())
     WHERE id=v_code_id;

    INSERT INTO public.evaluator_profiles(
      user_id,code_id,professional_area,highest_degree,
      years_experience,consent_version,consented_at
    )
    VALUES (
      v_uid,v_code_id,btrim(p_professional_area),btrim(p_highest_degree),
      p_years_experience,p_consent_version,now()
    );

    RETURN jsonb_build_object('ok',true,'recovered',false,'message','Acesso validado.');
  END IF;

  IF v_recovery_used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',false,
      'message','A recuperação deste código já foi utilizada. Use o navegador original ou contate a equipe da pesquisa.'
    );
  END IF;

  SELECT p.professional_area,p.highest_degree,p.years_experience,p.consent_version
    INTO v_old_area,v_old_degree,v_old_years,v_old_consent
  FROM public.evaluator_profiles p
  WHERE p.user_id=v_claimed_by
    AND p.code_id=v_code_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'message','Não foi possível localizar o cadastro anterior. Contate a equipe da pesquisa.');
  END IF;

  IF lower(btrim(COALESCE(v_old_area,''))) IS DISTINCT FROM lower(btrim(p_professional_area))
     OR lower(btrim(COALESCE(v_old_degree,''))) IS DISTINCT FROM lower(btrim(p_highest_degree))
     OR v_old_years IS DISTINCT FROM p_years_experience
     OR v_old_consent IS DISTINCT FROM v_consent THEN
    RETURN jsonb_build_object(
      'ok',false,
      'message','Os dados informados não conferem com o cadastro anterior. Verifique área, titulação e experiência.'
    );
  END IF;

  SELECT count(*) INTO v_current_evaluations
  FROM public.evaluations
  WHERE evaluator_id=v_uid;

  IF v_current_evaluations > 0 THEN
    RETURN jsonb_build_object('ok',false,'message','Esta sessão já possui avaliações registradas.');
  END IF;

  UPDATE public.evaluations
     SET evaluator_id=v_uid
   WHERE evaluator_id=v_claimed_by;

  UPDATE public.evaluator_profiles
     SET user_id=v_uid
   WHERE user_id=v_claimed_by
     AND code_id=v_code_id;

  UPDATE public.evaluator_codes
     SET claimed_by=v_uid,
         recovery_used_at=now()
   WHERE id=v_code_id;

  RETURN jsonb_build_object(
    'ok',true,
    'recovered',true,
    'message','Sessão recuperada. Suas respostas anteriores foram preservadas.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_evaluator_code(text,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resume_evaluator_code(text,text,text,integer,text) TO authenticated;
