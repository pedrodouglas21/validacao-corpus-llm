-- Let the existing claim RPC bridge to one-time session recovery.
CREATE OR REPLACE FUNCTION public.claim_evaluator_code(
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
  v_uid uuid:=auth.uid();
  v_code_id uuid;
  v_consent text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão não autenticada.');
  END IF;
  IF NOT public.collection_open() THEN
    RETURN jsonb_build_object('ok',false,'message','A coleta ainda não está aberta.');
  END IF;
  IF NOT EXISTS(select 1 from auth.users where id=v_uid) THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada. Entre novamente.');
  END IF;

  SELECT consent_version INTO v_consent
  FROM public.collection_control
  WHERE singleton;

  IF p_consent_version IS DISTINCT FROM v_consent
     OR nullif(btrim(p_professional_area),'') IS NULL
     OR nullif(btrim(p_highest_degree),'') IS NULL
     OR p_years_experience IS NULL
     OR p_years_experience NOT BETWEEN 0 AND 80
     OR length(btrim(p_professional_area))>120
     OR length(btrim(p_highest_degree))>120 THEN
    RETURN jsonb_build_object('ok',false,'message','Preencha os dados exigidos e confirme o TCLE vigente.');
  END IF;

  SELECT id INTO v_code_id
  FROM public.evaluator_codes
  WHERE active
    AND code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
    AND (claimed_by IS NULL OR claimed_by=v_uid)
  FOR UPDATE;

  IF v_code_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.evaluator_codes
      WHERE active
        AND code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
    ) THEN
      RETURN public.resume_evaluator_code(
        p_code,p_professional_area,p_highest_degree,
        p_years_experience,p_consent_version
      );
    END IF;
    RETURN jsonb_build_object(
      'ok',false,
      'message','Código inválido ou já utilizado. Se mudou de dispositivo, procure a equipe da pesquisa.'
    );
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.evaluator_profiles
    WHERE user_id=v_uid AND code_id IS DISTINCT FROM v_code_id
  ) THEN
    RETURN jsonb_build_object('ok',false,'message','Esta sessão já está vinculada a outro código.');
  END IF;

  UPDATE public.evaluator_codes
  SET claimed_by=v_uid,claimed_at=coalesce(claimed_at,now())
  WHERE id=v_code_id;

  INSERT INTO public.evaluator_profiles(
    user_id,code_id,professional_area,highest_degree,
    years_experience,consent_version,consented_at
  )
  VALUES(
    v_uid,v_code_id,btrim(p_professional_area),btrim(p_highest_degree),
    p_years_experience,p_consent_version,now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    professional_area=excluded.professional_area,
    highest_degree=excluded.highest_degree,
    years_experience=excluded.years_experience,
    consent_version=excluded.consent_version,
    consented_at=coalesce(public.evaluator_profiles.consented_at,excluded.consented_at);

  RETURN jsonb_build_object('ok',true,'message','Acesso validado.');
END;
$function$;
