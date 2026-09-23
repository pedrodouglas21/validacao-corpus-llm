# Correções pré-painel e teste técnico

Este pacote contém `app.js`, `admin.js`, `admin.html`, `index.html`, `config.js` e as migrações SQL aplicadas em 23-09-2026. A coleta foi liberada após a confirmação do pesquisador sobre a autorização ética e o armazenamento das alterações para emenda.

## Teste técnico de 23-09-2026

Foi usada uma chave técnica separada, identificada no banco como `TESTE TÉCNICO 85 CASOS 23-09-2026`. O fluxo percorreu os 85 casos e gravou 85/85 avaliações completas. Os cinco alertas foram marcados aleatoriamente para testar a exigência de justificativa; todos possuem motivo, pontuações válidas, timestamps, release e hashes dos snapshots.

As avaliações da chave técnica permanecem preservadas para auditoria, mas não alimentam os indicadores oficiais. As migrações `exclude_technical_test_from_official_metrics_20260923` e `preserve_empty_cases_after_test_exclusion_20260923` atualizam `v_case_cvi` sem remover os casos sem avaliação oficial, e `admin.js` exclui os perfis/códigos com rótulo iniciado por `TESTE` dos contadores administrativos.

## Publicação

1. Substituir os cinco arquivos da raiz do repositório pelos homônimos deste pacote em um commit. As migrações já foram aplicadas no Supabase; copiá-las apenas para controle de versão, sem executá-las novamente.
2. Verificar no ambiente publicado que a tela de acesso está liberada e que a chave técnica continua excluída dos indicadores oficiais.
3. Conferir a proveniência pontual dos 14 casos `SOURCE_CHECK_PENDING` antes de consolidar o corpus. Congelar qualquer revisão de snapshot em um novo manifesto e registrar os hashes.
4. Fazer teste supervisionado do fluxo de acesso, salvamento parcial, motivo obrigatório, alternância de idioma, navegação e exportação administrativa antes do primeiro uso por especialista.

O painel identifica a ordem reprodutível por avaliador. Isto não equivale a sorteio uniforme. O acesso anônimo está vinculado ao navegador; em troca de dispositivo, a equipe deve autenticar a identidade do especialista e definir uma recuperação controlada da conta, preservando as avaliações já feitas. Não reatribuir códigos nem alterar `claimed_by` diretamente sem trilha de auditoria.

O S-CVI/Ave aparece apenas com os 80 casos principais avaliados pelos seis especialistas. Os cinco reservas continuam visíveis para monitoramento; qualquer substituição precisa ser documentada antes de recalcular o índice final.
