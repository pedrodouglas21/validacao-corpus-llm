# Correções pré-painel

Este pacote contém `app.js`, `admin.js`, `admin.html`, `index.html`, `config.js` e as quatro migrações SQL aplicadas em 23-09-2026. A coleta permanece fechada no banco e em `config.js`; nenhuma resposta de especialista foi registrada.

## Publicação

1. Substituir os cinco arquivos da raiz do repositório pelos homônimos deste pacote em um commit. As migrações já foram aplicadas no Supabase; copiá-las apenas para controle de versão, sem executá-las novamente.
2. Verificar no ambiente publicado que a tela de acesso informa a coleta fechada. Confirmar também que ninguém iniciou uma avaliação durante a preparação.
3. Conferir a proveniência pontual dos 14 casos `SOURCE_CHECK_PENDING` antes de abrir a coleta. Congelar qualquer revisão de snapshot em um novo manifesto e registrar os hashes. A versão atual continua íntegra, com 85 hashes correspondentes.
4. Fazer teste supervisionado do fluxo de acesso, salvamento parcial, motivo obrigatório, alternância de idioma, navegação e exportação administrativa antes de alterar o controle de coleta no servidor e a chave `COLLECTION_ENABLED` na interface.

O painel identifica a ordem reprodutível por avaliador. Isto não equivale a sorteio uniforme. O acesso anônimo está vinculado ao navegador; em troca de dispositivo, a equipe deve autenticar a identidade do especialista e definir uma recuperação controlada da conta, preservando as avaliações já feitas. Não reatribuir códigos nem alterar `claimed_by` diretamente sem trilha de auditoria.

O S-CVI/Ave aparece apenas com os 80 casos principais avaliados pelos seis especialistas. Os cinco reservas continuam visíveis para monitoramento; qualquer substituição precisa ser documentada antes de recalcular o índice final.
