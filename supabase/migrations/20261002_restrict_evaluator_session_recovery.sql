-- Keep the recovery RPC unavailable to unauthenticated requests.
REVOKE EXECUTE ON FUNCTION public.resume_evaluator_code(text,text,text,integer,text) FROM anon;
