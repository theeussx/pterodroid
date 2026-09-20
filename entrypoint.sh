#!/bin/sh
set -eu

# Entrypoint do container Pterodroid.
#
# O processo nasce como root (USER root no Dockerfile) apenas para ajustar
# o ownership do volume montado; em seguida baixa privilégios via su-exec e
# o painel executa inteiro como o usuário não privilegiado `node` (uid 1000).
#
# REGISTRO — o que este arquivo NÃO pode voltar a ser:
# a versão anterior fazia `chown -R root:root /data /app` e executava o Node
# como root, desfazendo a cada boot o `RUN chown -R node:node` do Dockerfile
# e deixando painel + serviços + terminal com privilégio total no container
# (achado D1 de docs/VALIDACAO-E-PLANO-FASE-0.md).

mkdir -p /data /data/workspaces

# Fast path: se /data já pertence ao node (boots seguintes), não varre o
# volume inteiro — workspaces com node_modules têm centenas de milhares de
# arquivos e um chown -R a cada start deixava o boot lento.
if [ "$(stat -c '%u' /data 2>/dev/null || echo '?')" != "1000" ]; then
  echo "[entrypoint] ajustando ownership de /data para node:node (primeira vez pode demorar)..."
  chown -R node:node /data
fi
# /app já sai do build com node:node (RUN chown no Dockerfile); sem bind
# mount sobre /app não há nada a corrigir aqui — e muito menos a reverter.

run_as="node"

# Acesso ao daemon Docker do host: em vez de exigir DOCKER_GID configurável
# no compose, lemos o GID real do socket montado e rodamos o painel com ele
# como grupo suplementar. Funciona em qualquer host sem configuração manual.
if [ -S /var/run/docker.sock ]; then
  sock_gid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo '')"
  if [ -n "$sock_gid" ]; then
    run_as="node:$sock_gid"
    echo "[entrypoint] docker.sock montado (gid $sock_gid) — painel terá acesso ao daemon Docker do host."
    echo "[entrypoint] lembrete: isso equivale a acesso administrativo ao host — monte o socket só se precisa gerenciar containers."
  fi
fi

# su-exec baixa uid/gid e execa o comando já sem privilégios; o tini entra
# como PID 1 rodando como `node` e faz o reap dos processos órfãos deixados
# pelos serviços gerenciados (o Node como PID 1 não faz esse reap).
exec su-exec "$run_as" /sbin/tini -- "$@"
