# Validação Clínica do Corpus — LLM-Council

Aplicação estática para GitHub Pages com persistência no Supabase.

## O que o painel faz

- acesso de especialista por código individual;
- autenticação anônima do Supabase + código de convite de uso único;
- aceite do TCLE antes da avaliação;
- 85 casos em ordem individual pseudoaleatória;
- quatro escalas de 1–4: pertinência, complexidade, representatividade e adequação global;
- pergunta sobre incoerência/ausência impeditiva;
- salvamento automático e retomada da sessão;
- cálculo administrativo de I-CVI por caso;
- monitoramento de S-CVI/Ave, progresso e alertas;
- mapeamento `VAL ↔ CAND/CASE` protegido no banco e invisível aos especialistas.

## Antes de publicar

1. Crie um projeto Supabase.
2. Em **Authentication > Providers**, habilite **Anonymous Sign-Ins**.
3. Execute `supabase/schema.sql`.
4. Execute, fora do repositório público, os scripts privados entregues separadamente:
   - `01_seed_cases_PRIVADO.sql`
   - `02_seed_mapeamento_interno_PRIVADO.sql`
   - `03_seed_codigos_especialistas_PRIVADO.sql`
5. Configure um usuário administrador e execute `04_configurar_admin_PRIVADO.sql`.
6. Copie `config.js.example` para `config.js` e preencha:
   - URL do projeto;
   - chave `anon`/`publishable` do Supabase;
   - URL e versão do TCLE aprovado.
7. Publique no GitHub Pages.

**Nunca coloque a `service_role` key no frontend.** A chave `anon/publishable` pode ser usada no navegador quando as políticas RLS estão corretamente configuradas.

## CVI

O painel considera, para cada caso:

`I-CVI = nº de avaliadores que marcaram 3 ou 4 em adequação global / nº de avaliações completas`.

O limiar do SAP é I-CVI ≥ 0,78. O painel usa 6 avaliadores como quantidade esperada e exibe o S-CVI/Ave apenas como resumo dos casos que já atingiram a quantidade requerida de avaliações.

## GitHub Pages

O workflow em `.github/workflows/pages.yml` publica o conteúdo da raiz do repositório automaticamente quando houver push na branch `main`.
