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

### B) Linux / Ubuntu-proot

```bash
cd pterodroid
chmod +x install-ubuntu-proot.sh panelctl.sh
./install-ubuntu-proot.sh
./panelctl.sh start
```

### C) Docker

```bash
cd pterodroid
cp .env.example .env

# Necessário para o painel gerenciar containers do host:
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up -d --build
docker compose ps        # deve mostrar "healthy"
```

### Manual (qualquer sistema com Node 18+)

```bash
cd pterodroid/frontend && npm install && npm run build
cd ../backend          && npm install && npm start
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
| Termux / Linux | `backend/data/` |
| Docker | `./data/` (na raiz do projeto) |

Cada serviço ganha um diretório exclusivo em `data/workspaces/<nome-do-serviço>`.
**Backup = copiar essa pasta.** Para começar do zero, apague-a.

---

## Verificar se está tudo certo

```bash
cd backend && npm test
```

São 163 testes. Não exigem Docker instalado e não tocam num painel real
(usam pasta temporária e porta separada).

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Visão geral, funcionalidades, acesso remoto |
| `docs/RELATORIO.md` | O que foi corrigido, como foi validado e **o que ainda está pendente** (seção 9) |
| `docs/AUDITORIA.md` | Levantamento dos problemas encontrados, com evidências |

---

## Se algo não funcionar

1. **Veja o log primeiro:** `./panelctl.sh logs` (ou `docker compose logs -f`).
2. **Interface em branco?** O frontend não foi compilado:
   `cd frontend && npm install && npm run build`
3. **Docker: painel não enxerga os containers?** O `DOCKER_GID` provavelmente
   está errado. Confira com `getent group docker | cut -d: -f3` e ajuste o `.env`.
4. **Porta 3001 ocupada?** Defina `PORT=3002` no `backend/.env` (ou no `.env` da
   raiz, no caso do Docker).

Os pontos que **não puderam ser testados** no ambiente onde este código foi
preparado estão na seção 9 do [`docs/RELATORIO.md`](docs/RELATORIO.md) — vale a
leitura antes de colocar em uso sério.
