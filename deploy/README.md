# Deploy do Pterodroid em VPS

Este guia é para Linux nativo sem Docker na primeira implantação. Não use `panelctl.sh` e `systemd` para supervisionar a mesma instância.

## Preparação

```bash
sudo useradd --create-home --shell /bin/bash pterodroid
sudo install -d -o pterodroid -g pterodroid -m 750 /opt/pterodroid
sudo -u pterodroid git clone https://github.com/theeussx/pterodroid.git /opt/pterodroid
cd /opt/pterodroid
./install-linux.sh --yes
```

O painel deve executar como `pterodroid`, nunca como root. Mantenha `data/` fora do Git, com permissões restritas. Gere um segredo forte ou deixe o primeiro boot gerar `data/.jwt-secret` com modo `0600`.

Crie `apps/backend/.env` com modo `0600`, por exemplo:

```dotenv
NODE_ENV=production
PORT=3001
DATA_ROOT=/var/lib/pterodroid
CORS_ORIGINS=https://painel.exemplo.com.br
# Opcional: CSP_FRAME_ANCESTORS='self' https://origem-confiavel.exemplo
```

Use o caminho real de `DATA_ROOT` também em `ReadWritePaths` da unidade systemd. Não inclua tokens, cookies, sessões, QR Codes ou dumps no repositório.

## systemd

```bash
sudo install -d -o pterodroid -g pterodroid -m 750 /var/lib/pterodroid
sudo chown -R pterodroid:pterodroid /var/lib/pterodroid
sudo -u pterodroid npm ci --prefix /opt/pterodroid/apps/backend
sudo -u pterodroid npm ci --prefix /opt/pterodroid/apps/frontend
sudo -u pterodroid npm run build --prefix /opt/pterodroid/apps/frontend
sudo /opt/pterodroid/contrib/install-service.sh --user pterodroid --dir /opt/pterodroid
```

A unidade template já usa `NoNewPrivileges`, `ProtectSystem`, `TasksMax` e `LimitNOFILE`. Revise `ReadWritePaths` e qualquer acesso Docker antes de habilitar.

Valide:

```bash
sudo systemctl status pterodroid
curl -fsS https://painel.exemplo.com.br/api/health
sudo -u pterodroid /opt/pterodroid/panelctl.sh doctor
```

Se usar `panelctl.sh` manualmente, pare e desabilite a unidade systemd antes. Se usar systemd, não execute `panelctl.sh start` em paralelo.

## Nginx e HTTPS

Instale `deploy/nginx/pterodroid.conf`, substitua o domínio e valide:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d painel.exemplo.com.br
```

O template encaminha `/socket.io/` com Upgrade/Connection e o restante para `127.0.0.1:3001`. DNS deve apontar para a VPS. Não use `trycloudflare.com` como URL de produção.

Após HTTPS, configure `CORS_ORIGINS=https://painel.exemplo.com.br`. O processo recusa iniciar em produção se essa variável estiver vazia.

## Backup e reboot

- Pare o serviço antes de copiar o `panel.db` quando possível.
- Copie `DATA_ROOT` para armazenamento externo cifrado; retenha múltiplas versões.
- Teste restauração em diretório separado antes de substituir o banco.
- Execute `panelctl.sh doctor` antes e depois da restauração.
- Simule reboot: `sudo systemctl reboot`; após retorno, valide `systemctl status`, health, login, WebSocket, jobs e serviços gerenciados.
- Não restaure `data/.jwt-secret` em uma instalação diferente sem entender que a troca/perda do segredo invalida tokens e pode impedir descriptografia de segredos armazenados.

## Checklist de segurança

- [ ] usuário dedicado e não-root;
- [ ] SSH por chave e login root por senha desativado;
- [ ] firewall liberando somente SSH, HTTP e HTTPS;
- [ ] CORS explícito;
- [ ] `CSP_FRAME_ANCESTORS` revisado;
- [ ] terminal administrativo desabilitado quando não necessário;
- [ ] domínio HTTPS válido e renovação automática;
- [ ] backup restaurado em ambiente isolado;
- [ ] nenhum segredo em Git ou logs;
- [ ] systemd ou panelctl escolhido, nunca ambos.
