# Pterodroid — comece por aqui

Guia rápido de instalação. Para a visão completa do projeto, veja o
[`README.md`](README.md).

Se você recebeu isto como arquivo compactado: o pacote traz o código-fonte
**sem** as dependências (`node_modules`) e **sem** dados locais. As
dependências são instaladas no primeiro passo abaixo, e isso é proposital —
elas precisam ser baixadas para a plataforma onde o painel vai rodar
(Android/ARM é diferente de PC/x86).

---

## Instalação

Escolha **um** dos caminhos.

### A) Termux (Android)

```bash
pkg update && pkg install nodejs-lts git -y
cd pterodroid
chmod +x install-termux.sh panelctl.sh
./install-termux.sh
./panelctl.sh start
```

Acesse `http://localhost:3001` no navegador do celular. De outro aparelho na
mesma rede, use `http://<ip-do-celular>:3001`.

### B) Linux — PC, VPS, Raspberry Pi (instalador oficial)

```bash
cd pterodroid
chmod +x install-linux.sh panelctl.sh
./install-linux.sh
./panelctl.sh start
```

Funciona em Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE e derivados (x86_64 e
ARM). O script instala o **Node.js 22 LTS** sozinho quando preciso, além do
`cloudflared` da arquitetura certa — não instale o `nodejs` via `apt` (é o
Node 18 e quebra o build do frontend). Opções não interativas:
`./install-linux.sh --yes --with-postgres` (veja `--help`).

### C) Ubuntu proot (Android)

```bash
cd pterodroid
chmod +x install-ubuntu-proot.sh panelctl.sh
./install-ubuntu-proot.sh
./panelctl.sh start
```

O instalador garante o Node 22 LTS via NodeSource — pelo mesmo motivo acima,
não use o `nodejs` do `apt` do proot.

### D) Docker

```bash
cd pterodroid
cp .env.example .env

# Necessário para o painel gerenciar containers do host:
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up -d --build
docker compose ps        # deve mostrar "healthy"
```

### Manual (qualquer sistema com Node 22 LTS)

Mínimo: Node **20.19** / **22.12** (exigência do Vite 8). Use NodeSource,
`nvm` ou o binário oficial — **não** o `nodejs` do `apt` (Node 18).

```bash
cd pterodroid/apps/frontend && npm install && npm run build
cd ../backend               && npm install && npm start
```

---

## Primeiro acesso

Usuário `admin`, senha `admin`.

> **Troque a senha imediatamente**, em Configurações. O painel tem um terminal
> embutido: quem alcançar o login com a senha padrão consegue executar comandos
> no seu dispositivo. O aviso no topo da tela só desaparece quando a senha for
> realmente trocada.

---

## Onde ficam seus dados

Tudo em uma pasta só — banco, workspaces dos serviços e configuração do
cloudflared:

| Instalação | Caminho |
|---|---|
| Termux / proot / Linux | `data/` |
| Docker | `./data/` (na raiz do projeto) |

Cada serviço ganha um diretório exclusivo em `data/workspaces/<nome-do-serviço>`.
**Backup = copiar essa pasta.** Para começar do zero, apague-a.

---

## Verificar se está tudo certo

```bash
cd apps/backend && npm test
```

São mais de 160 testes. Não exigem Docker instalado e não tocam num painel real
(usam pasta temporária e porta separada).

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Visão geral, funcionalidades, acesso remoto |
| `apps/documentation/` | Site de documentação público (Vercel) |
| `docs/RELATORIO.md` | O que foi corrigido, como foi validado e **o que ainda está pendente** (seção 9) |
| `docs/AUDITORIA.md` | Levantamento dos problemas encontrados, com evidências |

---

## Se algo não funcionar

1. **Veja o log primeiro:** `./panelctl.sh logs` (ou `docker compose logs -f`).
2. **Interface em branco?** O frontend não foi compilado:
   `cd apps/frontend && npm install && npm run build`
3. **Build falha com `styleText` / `EBADENGINE`?** Seu Node é o 18 (do `apt`).
   Rode o instalador oficial do seu ambiente (`install-linux.sh`,
   `install-ubuntu-proot.sh` ou `install-termux.sh`) para obter o Node 22 LTS,
   depois recompile o frontend.
4. **Docker: painel não enxerga os containers?** O `DOCKER_GID` provavelmente
   está errado. Confira com `getent group docker | cut -d: -f3` e ajuste o `.env`.
5. **Porta 3001 ocupada?** Defina `PORT=3002` no `apps/backend/.env` (ou no `.env` da
   raiz, no caso do Docker).

Os pontos que **não puderam ser testados** no ambiente onde este código foi
preparado estão na seção 9 do [`docs/RELATORIO.md`](docs/RELATORIO.md) — vale a
leitura antes de colocar em uso sério.
