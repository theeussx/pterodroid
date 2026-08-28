import { C, Callout, CodeBlock, DocLink, DocTable, Ext, H2, P, Steps, Ul } from '../../components/docui';
import { site } from '../../site';
import type { DocPage } from '../types';

export const termux: DocPage = {
  slug: 'termux',
  title: 'Instalação no Termux (Android)',
  navLabel: 'Termux (Android)',
  description: 'Guia completo para instalar e manter o Pterodroid rodando no Termux, incluindo execução em segundo plano.',
  keywords: ['pkg install', 'nodejs-lts', 'install-termux.sh', 'panelctl.sh', 'wake lock', 'termux-wake-lock', 'termux-api', 'bateria', 'android', 'f-droid', 'segundo plano'],
  sourcePath: 'README.md',
  sections: [
    { id: 'instalar-termux', title: '1. Instalar o Termux' },
    { id: 'preparar', title: '2. Preparar o ambiente' },
    { id: 'clonar', title: '3. Clonar e instalar' },
    { id: 'iniciar', title: '4. Iniciar o painel' },
    { id: 'panelctl', title: 'Controlando com panelctl.sh' },
    { id: 'segundo-plano', title: 'Persistência em segundo plano' },
  ],
  render: () => (
    <>
      <P>
        O Termux é o ambiente <strong>principal</strong> do Pterodroid: painel, serviços, bancos e túneis rodam
        inteiramente no userland do Android, <strong>sem root</strong>.
      </P>

      <H2 id="instalar-termux">1. Instalar o Termux</H2>
      <P>
        Instale o Termux pelo <Ext href="https://f-droid.org/packages/com.termux/">F-Droid</Ext> ou pelos{' '}
        <Ext href="https://github.com/termux/termux-app/releases">releases oficiais no GitHub</Ext>. A versão da Google
        Play Store está desatualizada e não recebe os pacotes atuais.
      </P>

      <H2 id="preparar">2. Preparar o ambiente</H2>
      <CodeBlock
        platform="termux"
        title="dependências"
        code={`pkg update && pkg upgrade -y
pkg install git nodejs-lts cloudflared -y`}
        description="Atualiza os pacotes do Termux e instala Git, Node.js LTS e cloudflared (este último é opcional — só é usado para acesso remoto)."
      />

      <H2 id="clonar">3. Clonar e instalar</H2>
      <CodeBlock
        platform="termux"
        title="clone + instalador"
        code={`git clone ${site.repo.clone}
cd pterodroid
chmod +x install-termux.sh panelctl.sh
./install-termux.sh`}
        description="Clona o repositório, dá permissão de execução aos scripts e roda o instalador, que baixa as dependências para a arquitetura do seu aparelho (ARM)."
      />
      <Callout type="note">
        <p>
          As dependências (<C>node_modules</C>) são instaladas no próprio aparelho de propósito: pacotes para
          Android/ARM são diferentes dos de PC/x86.
        </p>
      </Callout>

      <H2 id="iniciar">4. Iniciar o painel</H2>
      <CodeBlock
        platform="termux"
        title="start"
        code={`./panelctl.sh start`}
        description="Inicia o backend em segundo plano (via PID file, sem systemd) e aguarda o healthcheck responder em /api/health."
      />
      <P>
        Abra <C>http://localhost:3001</C> no navegador do celular. De outro aparelho na mesma rede Wi-Fi, use{' '}
        <C>http://&lt;ip-do-celular&gt;:3001</C>.
      </P>
      <P>
        Próximo passo: <DocLink to="/docs/primeiro-acesso">Primeiro acesso</DocLink> (login <C>admin</C>/<C>admin</C> —
        troque a senha imediatamente).
      </P>

      <H2 id="panelctl">Controlando com panelctl.sh</H2>
      <P>
        O <Ext href={site.repo.panelctl}>panelctl.sh</Ext> é um controlador simples baseado em PID file — a ferramenta
        certa onde não existe <C>systemd</C>:
      </P>
      <DocTable
        head={['Comando', 'O que faz']}
        rows={[
          [<C key="1">./panelctl.sh start</C>, 'Inicia o backend com nohup, grava o PID e espera o healthcheck de verdade (detecta porta ocupada, banco corrompido etc.).'],
          [<C key="2">./panelctl.sh stop</C>, 'Envia SIGTERM; se o processo não responder em 15s, força com SIGKILL.'],
          [<C key="3">./panelctl.sh restart</C>, 'stop + start.'],
          [<C key="4">./panelctl.sh status</C>, 'Mostra se o painel está rodando e o PID.'],
          [<C key="5">./panelctl.sh logs</C>, <>Segue o log em tempo real (<C>data/panel.out.log</C>).</>],
        ]}
      />

      <H2 id="segundo-plano">Persistência em segundo plano</H2>
      <P>
        Para o Android não matar o Termux (e seus serviços) quando a tela apaga:
      </P>
      <Steps
        items={[
          { title: 'Instale o Termux:API', body: <CodeBlock platform="termux" code={`pkg install termux-api -y`} /> },
          { title: 'Ative o wake lock antes de iniciar o painel', body: <CodeBlock platform="termux" code={`termux-wake-lock`} description="Impede que o Android suspenda o Termux para economizar bateria." /> },
          { title: 'Desative a otimização de bateria do Termux', body: <>Nas configurações do Android, remova o Termux das otimizações de bateria para evitar que o sistema encerre o processo de forma agressiva.</> },
        ]}
      />
      <Callout type="warning">
        <p>
          Sem esses passos, fabricantes com gestão agressiva de energia podem encerrar o Termux em segundo plano — o
          sintoma clássico é o painel “sumir” depois de um tempo. Veja{' '}
          <DocLink to="/docs/troubleshooting">Troubleshooting</DocLink>.
        </p>
      </Callout>
    </>
  ),
};

export const proot: DocPage = {
  slug: 'proot',
  title: 'Instalação no Ubuntu proot',
  navLabel: 'Ubuntu proot',
  description: 'Como instalar o Pterodroid dentro de um Ubuntu proot no Android, e quais são as limitações desse ambiente.',
  keywords: ['proot-distro', 'ubuntu', 'install-ubuntu-proot.sh', 'android', 'userland', 'limitações', 'docker no proot'],
  sourcePath: 'COMECE-AQUI.md',
  sections: [
    { id: 'quando-usar', title: 'Quando usar proot' },
    { id: 'preparar', title: '1. Preparar o ambiente' },
    { id: 'instalar', title: '2. Instalar e iniciar' },
    { id: 'caminhos', title: 'Caminhos de dados' },
    { id: 'limitacoes', title: 'Limitações do ambiente' },
  ],
  render: () => (
    <>
      <H2 id="quando-usar">Quando usar proot</H2>
      <P>
        O Ubuntu proot dá um userland Ubuntu completo dentro do Android — útil se você precisa de pacotes que não
        existem no Termux. O Pterodroid funciona de forma idêntica: o <C>panelctl.sh</C> foi escrito para operar sem{' '}
        <C>systemd</C>, exatamente como dentro do proot.
      </P>

      <H2 id="preparar">1. Preparar o ambiente</H2>
      <P>
        Você precisa de um Ubuntu proot funcional. O caminho mais comum é o <C>proot-distro</C> dentro do Termux:
      </P>
      <CodeBlock
        platform="termux"
        title="exemplo com proot-distro"
        code={`pkg install proot-distro -y
proot-distro install ubuntu
proot-distro login ubuntu`}
        description="Instala e acessa um Ubuntu dentro do Termux. Dentro dele, instale git e node (via apt ou nvm) antes de prosseguir."
      />

      <H2 id="instalar">2. Instalar e iniciar</H2>
      <CodeBlock
        platform="proot"
        title="dentro do Ubuntu proot"
        code={`git clone ${site.repo.clone}
cd pterodroid
chmod +x install-ubuntu-proot.sh panelctl.sh
./install-ubuntu-proot.sh
./panelctl.sh start`}
        description="O script install-ubuntu-proot.sh prepara as dependências do frontend e do backend; o panelctl.sh inicia o painel em http://localhost:3001."
      />
      <P>
        O controle do painel é o mesmo do Termux: <C>start</C>, <C>stop</C>, <C>restart</C>, <C>status</C> e{' '}
        <C>logs</C> — veja a <DocLink to="/docs/termux">tabela completa do panelctl.sh</DocLink>.
      </P>

      <H2 id="caminhos">Caminhos de dados</H2>
      <P>
        Como no Termux e no Linux, tudo o que o painel guarda (banco, workspaces, configuração do cloudflared) fica em{' '}
        <C>backend/data/</C>. Backup = copiar essa pasta. Detalhes em{' '}
        <DocLink to="/docs/configuracao">Configuração</DocLink>.
      </P>

      <H2 id="limitacoes">Limitações do ambiente</H2>
      <Ul>
        <li><strong>Sem Docker:</strong> o proot não expõe os recursos de kernel necessários para rodar um Docker Engine. Serviços em container só com a <DocLink to="/docs/docker">instalação Docker</DocLink> em um host real.</li>
        <li><strong>Desempenho:</strong> o proot adiciona uma camada de tradução de syscalls — operações intensas de I/O tendem a ser mais lentas que no Termux puro.</li>
        <li><strong>Segundo plano:</strong> as mesmas recomendações de wake lock e bateria do <DocLink to="/docs/termux">Termux</DocLink> se aplicam, já que o proot roda dentro dele.</li>
      </Ul>
    </>
  ),
};

export const docker: DocPage = {
  slug: 'docker',
  title: 'Instalação com Docker',
  navLabel: 'Docker',
  description: 'Suba o Pterodroid com Docker Compose, com acesso ao Docker do host, healthcheck e dados persistentes em ./data.',
  keywords: ['docker compose', 'DOCKER_GID', 'JWT_SECRET', 'docker.sock', 'healthcheck', 'volumes', '.env', 'group_add', 'up -d --build', 'compose ps', 'compose logs'],
  sourcePath: 'README.md',
  sections: [
    { id: 'pre-requisitos', title: 'Pré-requisitos' },
    { id: 'clone-env', title: '1. Clonar e configurar o .env' },
    { id: 'subir', title: '2. Construir e subir' },
    { id: 'verificar', title: '3. Verificar saúde e logs' },
    { id: 'socket', title: 'Acesso ao Docker do host' },
    { id: 'dados', title: 'Dados, volumes e backup' },
  ],
  render: () => (
    <>
      <H2 id="pre-requisitos">Pré-requisitos</H2>
      <Ul>
        <li>Docker Engine e Docker Compose instalados no host.</li>
        <li>Usuário com acesso ao Docker (grupo <C>docker</C>).</li>
      </Ul>
      <P>
        O <C>Dockerfile</C>, o <C>docker-compose.yml</C> e o <C>.dockerignore</C> já vêm prontos no repositório — não é
        preciso escrever nada.
      </P>

      <H2 id="clone-env">1. Clonar e configurar o .env</H2>
      <CodeBlock
        platform="docker"
        title="clone + .env"
        code={`git clone ${site.repo.clone}
cd pterodroid
cp .env.example .env
# GID do grupo docker do host — necessário para o painel gerenciar containers:
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >> .env
# Segredo forte para assinar os tokens de login:
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env`}
        description="O DOCKER_GID permite que o container (que roda sem privilégios) acesse o socket do Docker via group_add. O JWT_SECRET assina os tokens de sessão."
      />
      <Callout type="warning" title="JWT_SECRET em produção">
        <p>
          Sem <C>JWT_SECRET</C>, o painel gera um automaticamente em <C>./data/.jwt-secret</C> — funciona, mas você não
          controla o valor. Para uso sério, defina um segredo forte.
        </p>
      </Callout>

      <H2 id="subir">2. Construir e subir</H2>
      <CodeBlock
        platform="docker"
        title="compose up"
        code={`docker compose up -d --build`}
        description="Constrói a imagem (frontend compilado + backend) e inicia o container em segundo plano."
      />

      <H2 id="verificar">3. Verificar saúde e logs</H2>
      <CodeBlock
        platform="docker"
        title="healthcheck + logs"
        code={`docker compose ps      # deve mostrar "healthy"
docker compose logs -f # acompanha os logs do painel`}
        description="O healthcheck faz parte da imagem: o status healthy confirma que o painel respondeu em /api/health."
      />
      <P>
        Painel disponível em <C>http://localhost:3001</C>. Siga para o{' '}
        <DocLink to="/docs/primeiro-acesso">primeiro acesso</DocLink>.
      </P>

      <H2 id="socket">Acesso ao Docker do host</H2>
      <Callout type="important">
        <p>
          O Pterodroid conversa com o daemon Docker do host através de <C>/var/run/docker.sock</C>. O container roda
          como usuário <strong>sem privilégios</strong> e usa <C>group_add</C> para acessar o socket — por isso o{' '}
          <C>DOCKER_GID</C>. Se o painel não conseguir falar com o Docker, confira esse valor:
        </p>
        <CodeBlock platform="host" code={`getent group docker | cut -d: -f3`} />
      </Callout>
      <P>
        Para que containers criados pelo painel enxerguem os arquivos dos workspaces, pode ser necessário definir{' '}
        <C>HOST_WORKSPACES_ROOT</C> — veja <DocLink to="/docs/docker-services">Serviços Docker</DocLink>.
      </P>

      <H2 id="dados">Dados, volumes e backup</H2>
      <Callout type="important" title="Todos os dados ficam em ./data">
        <p>
          Banco interno, workspaces dos serviços e configuração do cloudflared vivem em <C>./data</C> na raiz do
          projeto. <strong>Backup é copiar essa pasta.</strong> Para começar do zero, apague-a.
        </p>
      </Callout>
      <P>
        Problemas comuns (painel não enxerga containers, porta ocupada) estão em{' '}
        <DocLink to="/docs/troubleshooting">Troubleshooting</DocLink>.
      </P>
    </>
  ),
};

export const linux: DocPage = {
  slug: 'linux',
  title: 'Instalação no Linux',
  navLabel: 'Linux',
  description: 'Instale o Pterodroid em qualquer distro Linux com Node 18+ — VPS, Raspberry Pi ou desktop — sem depender de systemd.',
  keywords: ['vps', 'raspberry pi', 'debian', 'ubuntu', 'node 18', 'manual', 'npm start', 'panelctl', 'nohup'],
  sourcePath: 'COMECE-AQUI.md',
  sections: [
    { id: 'requisitos', title: 'Requisitos' },
    { id: 'metodo-manual', title: 'Método manual (oficial)' },
    { id: 'panelctl', title: 'Rodando em segundo plano com panelctl.sh' },
    { id: 'docker-alternativa', title: 'Alternativa: Docker' },
    { id: 'notas', title: 'Notas' },
  ],
  render: () => (
    <>
      <H2 id="requisitos">Requisitos</H2>
      <Ul>
        <li>Node.js <strong>18 ou superior</strong> (e npm).</li>
        <li><C>git</C> e Bash.</li>
        <li>Funciona em x86 e ARM (Raspberry Pi) — não há dependências de compilação nativa.</li>
      </Ul>

      <H2 id="metodo-manual">Método manual (oficial)</H2>
      <P>
        É o método “qualquer sistema com Node 18+” documentado no repositório: compilar o frontend e iniciar o backend,
        que serve a interface e a API juntos.
      </P>
      <CodeBlock
        platform="linux"
        title="build + start"
        code={`git clone ${site.repo.clone}
cd pterodroid/frontend && npm install && npm run build
cd ../backend && npm install && npm start`}
        description="npm start mantém o painel no terminal atual (primeiro plano), em http://localhost:3001."
      />

      <H2 id="panelctl">Rodando em segundo plano com panelctl.sh</H2>
      <P>
        O <C>panelctl.sh</C> não depende de nada específico do Android — é um controlador por PID file que funciona em
        qualquer Linux:
      </P>
      <CodeBlock
        platform="linux"
        title="segundo plano"
        code={`cd pterodroid
chmod +x panelctl.sh
./panelctl.sh start    # inicia com nohup e espera o healthcheck
./panelctl.sh status   # confere
./panelctl.sh logs     # acompanha data/panel.out.log`}
        description="Requer o frontend já compilado e as dependências do backend instaladas (o script avisa se faltar algo)."
      />
      <Callout type="note" title="Sem unidade systemd">
        <p>
          O projeto <strong>não fornece</strong> um service file de systemd — a inicialização automática no boot fica a
          seu critério. O caminho suportado é o <C>panelctl.sh</C>.
        </p>
      </Callout>

      <H2 id="docker-alternativa">Alternativa: Docker</H2>
      <P>
        Em VPS e homelabs, a <DocLink to="/docs/docker">instalação via Docker</DocLink> costuma ser mais prática:
        imagem com healthcheck, dados isolados em <C>./data</C> e gestão de containers do host.
      </P>

      <H2 id="notas">Notas</H2>
      <Ul>
        <li>Dados em <C>backend/data/</C> (banco, workspaces, cloudflared). Backup = copiar a pasta.</li>
        <li>Porta padrão <C>3001</C>; mude com <C>PORT</C> no <C>backend/.env</C> — veja <DocLink to="/docs/configuracao">Configuração</DocLink>.</li>
        <li>Para expor o painel na internet, use <DocLink to="/docs/cloudflare">Cloudflare Tunnel</DocLink> em vez de abrir portas.</li>
      </Ul>
    </>
  ),
};
