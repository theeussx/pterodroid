# Workflow de CI (ativar no GitHub)

`workflow.yml` nesta pasta **é o pipeline oficial de CI** do Pterodroid
(Fase 0, WP-01) — testes do backend no Node 20.19/22, build do frontend e
da documentação, ShellCheck, pré-voo do `panelctl.sh doctor` numa
instalação limpa e build da imagem Docker com prova de que o painel não
executa como root.

## Por que ele não está em `.github/workflows/`?

O token da integração usada para gerar o commit desta branch não tem a
permissão **`workflows`** do GitHub, que é exigida para criar/alterar
arquivos em `.github/workflows/` por push. Para não perder o pipeline, ele
ficou versionado aqui.

## Como ativar (uma vez)

Qualquer conta com permissão de escrita no repositório pode movê-lo para o
lugar certo — via interface web do GitHub (Add file → paste do conteúdo) ou
por git:

```bash
git checkout main          # ou a branch de trabalho
mkdir -p .github/workflows
git mv contrib/ci/workflow.yml .github/workflows/ci.yml
# ajuste o caminho no comentário de "local canônico" dentro do arquivo se quiser
git commit -m "ci: ativa pipeline oficial (.github/workflows/ci.yml)"
git push
```

Alternativa definitiva: reconectar a integração do Arena ao GitHub
concedendo o escopo **workflows** — aí o próprio agente consegue mover o
arquivo na próxima sessão.

Depois de ativado, apague esta pasta (`contrib/ci/`) inteira.
