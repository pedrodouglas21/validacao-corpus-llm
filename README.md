# Validação clínica do corpus — LLM-Council

Interface web utilizada para a validação independente de casos clínicos farmacoterapêuticos sintéticos.

## Estrutura

- `index.html`: painel do especialista
- `app.js`: fluxo de autenticação, apresentação dos casos e salvamento
- `styles.css`: interface
- `config.js`: configuração pública do Supabase e do TCLE
- `tcle.html`: TCLE em formato web
- `TCLE_LLM_Atualizado_20-09-2026.pdf`: TCLE em PDF
- `admin.html` / `admin.js`: painel administrativo restrito

Os casos não ficam armazenados no repositório. Eles são recuperados do banco Supabase após autenticação válida.

## Validação

O painel registra, por caso:

- pertinência farmacoterapêutica;
- complexidade decisória;
- representatividade clínica;
- adequação global;
- presença de incoerência ou ausência impeditiva;
- motivo do impedimento, quando aplicável;
- comentário opcional.

O corpus é apresentado em PT-BR por padrão, com a versão-fonte em inglês disponível para conferência.

## Privacidade

Não publicar neste repositório códigos dos especialistas, mapeamentos internos dos casos ou credenciais administrativas do banco.
