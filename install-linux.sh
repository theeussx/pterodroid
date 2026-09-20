#!/bin/bash
# install-linux.sh — instala o Pterodroid em Linux "de verdade"
# (Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE e derivados — PC, VPS,
# Raspberry Pi). Para Android, use install-termux.sh (Termux) ou
# install-ubuntu-proot.sh (Ubuntu proot).
#
# O que este script faz:
#   1. Garante Node.js 22 LTS (mínimo aceito: 20.19 / 22.12 — o frontend
#      usa Vite 8 e NÃO compila no Node 18 que vem no apt do Ubuntu).
#   2. Instala git, curl e o cloudflared (binário correto para a arquitetura).
#   3. Oferece instalar PostgreSQL e MariaDB (opcional).
#   4. Instala as dependências do backend, compila o frontend e valida o build.
#
# Uso:
#   chmod +x install-linux.sh panelctl.sh
#   ./install-linux.sh [--yes] [--with-postgres] [--with-mariadb]
#
set -euo pipefail

# ── Requisito de Node ─────────────────────────────────────────────
# O frontend (Vite 8 + @vitejs/plugin-react 6 + rolldown) exige
# "^20.19.0 || >=22.12.0". O Node 18 do `apt install nodejs` do Ubuntu
# (18.19.x) quebra o build com:
#   SyntaxError: The requested module 'node:util' does not provide
#   an export named 'styleText'
# Por isso instalamos o LTS 22 quando o Node atual não serve.
NODE_LTS_MAJOR="22"
MIN_NODE_20_MINOR="19"   # 20.x só serve a partir do 20.19
MIN_NODE_22_MINOR="12"   # 22.x só serve a partir do 22.12

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YES=0
WITH_POSTGRES=0
WITH_MARIADB=0

usage() {
  cat <<'EOF'
Uso: ./install-linux.sh [opções]

Instala o Pterodroid em Linux (PC, VPS, Raspberry Pi).

Opções:
  -y, --yes          Não interativo: pula as perguntas (bancos: não instala,
                     a menos que --with-postgres/--with-mariadb sejam passados)
  --with-postgres    Instala o PostgreSQL sem perguntar
  --with-mariadb     Instala o MariaDB sem perguntar
  -h, --help         Mostra esta ajuda

Exemplos:
  ./install-linux.sh
  ./install-linux.sh --yes --with-postgres
EOF
}

for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --with-postgres) WITH_POSTGRES=1 ;;
    --with-mariadb) WITH_MARIADB=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opção desconhecida: $arg (veja --help)"; exit 1 ;;
  esac
done

# ── Guardas de ambiente ───────────────────────────────────────────
if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then
  echo "Este script é para Linux de verdade — no Termux, use:"
  echo "  ./install-termux.sh"
  exit 1
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "Este script é para Linux (detectado: $(uname -s))."
  echo "No Termux (Android), use ./install-termux.sh."
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif have sudo; then
  SUDO="sudo"
else
  SUDO=""
fi

need_root() {
  if [ "$(id -u)" != "0" ] && ! have sudo; then
    echo "Erro: preciso de root ou sudo para instalar pacotes do sistema."
    echo "Rode como root ou instale o sudo e tente de novo."
    exit 1
  fi
}

ask() { # ask "Pergunta? [s/N]" -> return 0 = sim
  local prompt="$1"
  if [ "$YES" = "1" ]; then return 1; fi
  if [ ! -t 0 ]; then return 1; fi  # sem terminal: assume o padrão (não)
  local ans=""
  read -r -p "$prompt " ans || true
  [[ "$ans" =~ ^[sSyY]$ ]]
}

# node_ok: o Node atual atende "^20.19.0 || >=22.12.0"?
node_ok() {
  have node || return 1
  local ver rest major minor
  ver="$(node --version 2>/dev/null | sed 's/^v//')" || return 1
  major="${ver%%.*}"
  rest="${ver#*.}"
  minor="${rest%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] || return 1
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge "$MIN_NODE_22_MINOR" ]; then return 0; fi
  if [ "$major" -eq 20 ] && [ "$minor" -ge "$MIN_NODE_20_MINOR" ]; then return 0; fi
  return 1
}

node_version() {
  if have node; then node --version 2>/dev/null; else echo "(não instalado)"; fi
}

detect_pm() { # echo: apt | dnf | yum | pacman | zypper | unknown
  local id="" like=""
  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    id="${ID:-}"
    like="${ID_LIKE:-}"
  fi
  case " $id $like " in
    *debian*|*ubuntu*|*raspbian*|*mint*|*pop*) echo "apt"; return ;;
    *fedora*|*rhel*|*centos*|*rocky*|*alma*|*ol*) : ;;
    *arch*|*manjaro*|*endeavouros*) echo "pacman"; return ;;
    *suse*|*opensuse*) echo "zypper"; return ;;
  esac
  if have apt-get; then echo "apt";
  elif have dnf; then echo "dnf";
  elif have yum; then echo "yum";
  elif have pacman; then echo "pacman";
  elif have zypper; then echo "zypper";
  else echo "unknown";
  fi
}

# Arquitetura para downloads (Node oficial e cloudflared).
# Imprime "<node_arch> <cf_arch>", ex.: "x64 amd64".
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64 amd64" ;;
    aarch64|arm64) echo "arm64 arm64" ;;
    armv7l|armv6l|armhf) echo "armv7l arm" ;;
    *) echo "unknown unknown" ;;
  esac
}

# ── Aviso para root ───────────────────────────────────────────────
# Dois motivos para não seguir como root:
#  1. o panelctl.sh RECUSA iniciar o painel como root desde a Fase 0 —
#     qualquer serviço ou comando de terminal herdaria privilégio total;
#  2. PostgreSQL e MariaDB recusam rodar como root, bloqueando o
#     provisionamento de bancos pelo painel.
# O caminho certo é um usuário de serviço dedicado; a instalação oferece
# criá-lo aqui mesmo.
if [ "$(id -u)" = "0" ]; then
  echo "=================================================="
  echo " Você está como root."
  echo " O painel NÃO inicia como root (recusa ativa no panelctl.sh),"
  echo " e PostgreSQL/MariaDB também recusam root. A recomendação é"
  echo " instalar e rodar o painel como um usuário dedicado."
  echo "=================================================="
  if [ "$YES" != "1" ] && [ -t 0 ]; then
    # Pergunta com padrão SIM (Enter = sim):
    read -r -p "Criar um usuário comum agora para rodar o painel? [S/n] " ans || ans=""
    if [[ ! "$ans" =~ ^[nN]$ ]]; then
      read -r -p "Nome do usuário [pterodroid]: " newuser || newuser=""
      newuser="${newuser:-pterodroid}"
      PM_EARLY="$(detect_pm)"
      if ! id "$newuser" >/dev/null 2>&1; then
        case "$PM_EARLY" in
          apt) apt-get update -qq; apt-get install -y -qq sudo ;;
          dnf) dnf install -y -q sudo ;;
          yum) yum install -y -q sudo ;;
          pacman) pacman -Sy --noconfirm --needed sudo ;;
          zypper) zypper -n install sudo ;;
          *) echo "Gerenciador de pacotes desconhecido; instale o sudo manualmente."; exit 1 ;;
        esac
        useradd -m -s /bin/bash "$newuser"
        echo "Defina a senha de '$newuser':"
        passwd "$newuser"
      fi
      # sudo sem senha para o instalador? Não — mantém seguro; o usuário
      # digita a senha quando preciso. Garante grupo sudo/wheel:
      usermod -aG sudo "$newuser" 2>/dev/null || usermod -aG wheel "$newuser" 2>/dev/null || true
      chown -R "$newuser:$newuser" "$ROOT_DIR"
      echo ""
      echo "Usuário '$newuser' pronto. Agora rode como ele:"
      echo "  su - $newuser"
      echo "  cd $ROOT_DIR"
      echo "  ./install-linux.sh"
      exit 0
    fi
  fi
  echo "Seguindo como root — a instalação em si funciona, mas lembre-se:"
  echo "  • o painel só inicia como root com PTERODROID_ALLOW_ROOT=1 (não recomendado);"
  echo "  • bancos de dados locais não vão provisionar até o painel rodar como usuário comum."
  echo ""
fi

PM="$(detect_pm)"
read -r NODE_ARCH CF_ARCH <<< "$(detect_arch)"
if [ "$NODE_ARCH" = "unknown" ]; then
  echo "Aviso: arquitetura '$(uname -m)' não reconhecida — vou tentar prosseguir,"
  echo "mas downloads de binários (Node/cloudflared) podem falhar."
fi

echo "== Pterodroid — instalador Linux =="
echo "Distro: $(grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"' || echo desconhecida) | gerenciador: $PM | arch: $(uname -m)"
echo "Node atual: $(node_version) (exigido: 20.19+ ou 22.12+)"
echo ""

# ── 1. Node.js 22 LTS ─────────────────────────────────────────────
ensure_node() {
  if node_ok; then
    echo "== Node.js OK ($(node_version)) — pulando instalação =="
    return 0
  fi

  echo "== Instalando Node.js $NODE_LTS_MAJOR LTS =="
  if have node; then
    echo "O Node atual ($(node_version)) é antigo demais para o frontend"
    echo "(Vite 8 exige 20.19+ ou 22.12+). Vou atualizar."
  fi
  need_root

  case "$PM" in
    apt)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq ca-certificates curl gnupg git
      echo "Adicionando repositório NodeSource (Node $NODE_LTS_MAJOR)..."
      # shellcheck disable=SC2024
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_LTS_MAJOR}.x" | $SUDO -E bash -
      $SUDO apt-get install -y -qq nodejs git curl
      ;;
    dnf|yum)
      $SUDO "$PM" install -y -q curl git
      echo "Adicionando repositório NodeSource (Node $NODE_LTS_MAJOR)..."
      # shellcheck disable=SC2024
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_LTS_MAJOR}.x" | $SUDO bash -
      $SUDO "$PM" install -y -q nodejs git curl
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm --needed nodejs npm git curl
      ;;
    zypper)
      $SUDO zypper -n install nodejs git curl 2>/dev/null || true
      if ! node_ok; then
        echo "O nodejs do zypper continua antigo — caindo para o binário oficial..."
        install_node_tarball
      fi
      ;;
    *)
      echo "Gerenciador de pacotes desconhecido — instalando via binário oficial..."
      install_node_tarball
      ;;
  esac

  if ! node_ok; then
    # Última tentativa: binário oficial (cobre distro com Node velho no repo).
    if [ "$PM" != "unknown" ]; then
      echo "O Node do repositório da distro continua antigo — tentando binário oficial..."
      install_node_tarball || true
    fi
  fi

  if ! node_ok; then
    echo ""
    echo "ERRO: não consegui obter um Node.js 20.19+ / 22.12+ (atual: $(node_version))."
    echo "Instale o Node $NODE_LTS_MAJOR LTS manualmente (https://nodejs.org) e rode de novo."
    exit 1
  fi
  echo "Node.js OK: $(node_version) | npm $(npm --version 2>/dev/null || echo '?')"
}

# Instala o Node oficial (nodejs.org) em /usr/local (com root) ou ~/.local.
install_node_tarball() {
  have curl || { need_root; echo "curl é necessário."; exit 1; }
  if [ "$NODE_ARCH" = "unknown" ]; then
    echo "Arquitetura desconhecida — não sei qual binário oficial baixar."
    return 1
  fi
  echo "Descobrindo a última versão LTS v${NODE_LTS_MAJOR}..."
  local node_ver
  node_ver="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o "\"version\":\"v${NODE_LTS_MAJOR}[^\"]*\"" | head -n 1 | cut -d'"' -f4)"
  if [ -z "${node_ver:-}" ]; then
    echo "Não foi possível descobrir a versão no nodejs.org."
    return 1
  fi
  local dest="/usr/local"
  local use_sudo="$SUDO"
  if [ "$(id -u)" != "0" ] && ! have sudo; then
    dest="$HOME/.local"
    use_sudo=""
    mkdir -p "$dest"
    echo "Sem root/sudo: instalando o Node em $dest (adicionarei ao PATH desta sessão)."
  fi
  local url="https://nodejs.org/dist/${node_ver}/node-${node_ver}-linux-${NODE_ARCH}.tar.xz"
  local tmp
  tmp="$(mktemp -d)"
  echo "Baixando $url ..."
  curl -fsSL -o "$tmp/node.tar.xz" "$url"
  $use_sudo tar -xJf "$tmp/node.tar.xz" -C "$tmp"
  $use_sudo cp -r "$tmp"/node-"${node_ver}"-linux-"${NODE_ARCH}"/{bin,lib,share,include} "$dest"/
  rm -rf "$tmp"
  if [ "$dest" = "$HOME/.local" ]; then
    export PATH="$HOME/.local/bin:$PATH"
    echo ""
    echo "Adicione ao seu ~/.bashrc (ou ~/.zshrc) para persistir:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  else
    hash -r 2>/dev/null || true
    export PATH="/usr/local/bin:$PATH"
  fi
}

ensure_node

# Garante git/curl mesmo quando o Node já estava OK (pulamos o passo acima).
if ! have git || ! have curl; then
  echo "== Instalando git/curl =="
  need_root
  case "$PM" in
    apt) $SUDO apt-get update -qq; $SUDO apt-get install -y -qq git curl ;;
    dnf|yum) $SUDO "$PM" install -y -q git curl ;;
    pacman) $SUDO pacman -Sy --noconfirm --needed git curl ;;
    zypper) $SUDO zypper -n install git curl ;;
    *) echo "Instale git e curl manualmente e rode de novo."; exit 1 ;;
  esac
fi

# ── 2. cloudflared ────────────────────────────────────────────────
ensure_cloudflared() {
  if have cloudflared; then
    echo "== cloudflared já instalado ($(cloudflared --version 2>/dev/null | head -n1)) =="
    return 0
  fi
  echo "== Instalando cloudflared =="
  if [ "$CF_ARCH" = "unknown" ]; then
    echo "Arquitetura desconhecida — pulei o cloudflared."
    echo "O painel funciona sem ele; só o acesso remoto (túneis) fica indisponível."
    echo "Instale manualmente: https://developers.cloudflare.com/cloudflared/"
    return 0
  fi
  need_root
  local tmp deb
  tmp="$(mktemp -d)"
  case "$PM" in
    apt)
      deb="cloudflared-linux-${CF_ARCH}.deb"
      if curl -fsSL -o "$tmp/$deb" "https://github.com/cloudflare/cloudflared/releases/latest/download/$deb"; then
        $SUDO dpkg -i "$tmp/$deb" || $SUDO apt-get install -y -qq -f
      else
        echo "Falha no .deb — caindo para o binário direto..."
        install_cloudflared_binary "$tmp"
      fi
      ;;
    dnf|yum)
      local rpm="cloudflared-linux-${CF_ARCH}.rpm"
      if curl -fsSL -o "$tmp/$rpm" "https://github.com/cloudflare/cloudflared/releases/latest/download/$rpm"; then
        $SUDO "$PM" install -y "$tmp/$rpm" || $SUDO rpm -i "$tmp/$rpm"
      else
        echo "Falha no .rpm — caindo para o binário direto..."
        install_cloudflared_binary "$tmp"
      fi
      ;;
    *)
      install_cloudflared_binary "$tmp"
      ;;
  esac
  rm -rf "$tmp"
  if have cloudflared; then
    cloudflared --version 2>/dev/null | head -n1 || true
  else
    echo "Aviso: cloudflared não pôde ser instalado. O painel funciona sem ele;"
    echo "só o acesso remoto via Cloudflare Tunnel fica indisponível."
  fi
}

install_cloudflared_binary() {
  local tmp="$1"
  local bin="cloudflared-linux-${CF_ARCH}"
  curl -fsSL -o "$tmp/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/$bin"
  chmod +x "$tmp/cloudflared"
  $SUDO install -m 0755 "$tmp/cloudflared" /usr/local/bin/cloudflared
  hash -r 2>/dev/null || true
}

ensure_cloudflared

# ── 3. Bancos de dados (opcional) ─────────────────────────────────
echo ""
echo "== Bancos de dados (opcional) =="
echo "O painel provisiona PostgreSQL e MySQL/MariaDB como instâncias locais."
echo "Os pacotes só precisam estar instalados — o painel cria e gerencia"
echo "as instâncias sozinho (não usa o serviço systemd da distro)."

install_db_pkgs() { # $1 = postgres|mariadb
  need_root
  case "$PM:$1" in
    apt:postgres) $SUDO apt-get install -y -qq postgresql ;;
    apt:mariadb) $SUDO apt-get install -y -qq mariadb-server ;;
    dnf:postgres|yum:postgres) $SUDO "$PM" install -y -q postgresql-server postgresql-contrib ;;
    dnf:mariadb|yum:mariadb) $SUDO "$PM" install -y -q mariadb-server ;;
    pacman:postgres) $SUDO pacman -Sy --noconfirm --needed postgresql ;;
    pacman:mariadb) $SUDO pacman -Sy --noconfirm --needed mariadb ;;
    zypper:postgres) $SUDO zypper -n install postgresql-server ;;
    zypper:mariadb) $SUDO zypper -n install mariadb ;;
    *) echo "Gerenciador '$PM' desconhecido — instale $1 manualmente."; return 1 ;;
  esac
}

if [ "$WITH_POSTGRES" = "1" ]; then
  echo "Instalando PostgreSQL (--with-postgres)..."
  install_db_pkgs postgres
elif ask "Instalar PostgreSQL agora? [s/N] "; then
  install_db_pkgs postgres
fi

if [ "$WITH_MARIADB" = "1" ]; then
  echo "Instalando MariaDB (--with-mariadb)..."
  install_db_pkgs mariadb
elif ask "Instalar MariaDB agora? [s/N] "; then
  install_db_pkgs mariadb
fi

# ── 4. Dependências + build ───────────────────────────────────────
echo ""
echo "== Instalando dependências do backend =="
cd "$ROOT_DIR/apps/backend"
npm install

echo "== Instalando dependências do frontend e gerando build =="
cd "$ROOT_DIR/apps/frontend"
npm install
npm run build

if [ ! -f "$ROOT_DIR/apps/frontend/dist/index.html" ]; then
  echo ""
  echo "ERRO: o build terminou mas apps/frontend/dist/index.html não existe."
  echo "Veja a saída acima e, se precisar, abra uma issue com o log completo:"
  echo "https://github.com/theeussx/pterodroid/issues"
  exit 1
fi

# ── 5. Serviço systemd (opcional, só Linux nativo) ────────────────
# O painel funciona perfeitamente com o panelctl.sh; o serviço systemd
# existe para quem quer boot automático e restart gerenciado pelo init.
# Rodando como root, pulamos: a instalação da unidade exige um usuário
# comum (o fluxo root acima já instruiu a criar um e voltar aqui).
if [ "$(id -u)" != "0" ] && have systemctl && [ -d /run/systemd/system ]; then
  echo ""
  echo "== Serviço systemd (opcional) =="
  echo "Posso instalar o painel como serviço do sistema: inicia no boot,"
  echo "reinicia em falhas e roda como '$(id -un)' (sem privilégios)."
  if [ "$YES" = "1" ]; then
    echo "Modo --yes: pulando. Para instalar depois:"
    echo "  $ROOT_DIR/contrib/install-service.sh"
  elif ask "Instalar o serviço systemd agora? [s/N] "; then
    bash "$ROOT_DIR/contrib/install-service.sh" || \
      echo "Aviso: a instalação do serviço falhou — o painel funciona normal com panelctl.sh."
  fi
fi

# ── 6. Pré-voo final ──────────────────────────────────────────────
echo ""
echo "== Validando o ambiente (panelctl doctor) =="
bash "$ROOT_DIR/panelctl.sh" doctor || echo "Resolva as falhas acima antes de iniciar."

# ── 7. Resumo ─────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo " Instalação concluída!"
echo ""
echo " Para iniciar o painel:"
if [ -f /etc/systemd/system/pterodroid.service ] && have systemctl; then
  echo "   sudo systemctl start pterodroid   (serviço instalado)"
  echo "   journalctl -u pterodroid -f       (logs)"
  echo " Ou manualmente:  $ROOT_DIR/panelctl.sh start"
else
  echo "   $ROOT_DIR/panelctl.sh start"
fi
echo ""
echo " Para validar o ambiente a qualquer momento:"
echo "   $ROOT_DIR/panelctl.sh doctor"
echo ""
echo " Acesse http://localhost:3001 no navegador."
echo " (De outro dispositivo na mesma rede: http://<ip-da-maquina>:3001)"
echo " Login padrão: admin / admin — troque em Configurações após entrar."
echo ""
if have docker && docker info >/dev/null 2>&1; then
  echo " Docker detectado e acessível — serviços em container já funcionam."
else
  echo " Docker: não detectado (ou sem permissão). Serviços em container"
  echo " precisam do Docker Engine; processos locais e bancos funcionam sem ele."
  echo " Dica: sudo usermod -aG docker \$USER (e faça login de novo)."
fi
if ! have cloudflared; then
  echo ""
  echo " cloudflared ausente — acesso remoto via Cloudflare Tunnel indisponível"
  echo " até instalá-lo (https://developers.cloudflare.com/cloudflared/)."
fi
echo "=================================================="
