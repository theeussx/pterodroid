import { C, Callout, CodeBlock, DocLink, DocTable, Ext, H2, P, Steps, Ul } from '../../components/docui';
import { Link } from '../../router';
import { site } from '../../site';
import type { DocPage } from '../types';

export const introducao: DocPage = {
  slug: 'introducao',
  title: 'Comece aqui',
  navLabel: 'Comece aqui',
  description: 'O que é o Pterodroid, como ele funciona e o caminho mais curto até o seu primeiro serviço rodando.',
  keywords: ['o que é', 'pterodactyl', 'termux', 'android', 'self-hosted', 'painel', 'hospedagem', 'visão geral', 'filosofia'],
  sourcePath: 'apps/documentation/src/docs/content/intro.tsx',
  sections: [
    { id: 'o-que-e', title: 'O que é o Pterodroid' },
    { id: 'como-funciona', title: 'Como funciona' },
    { id: 'o-que-da-para-hospedar', title: 'O que dá para hospedar' },
    { id: 'caminho-rapido', title: 'Caminho rápido' },
  ],
  render: () => (
    <>
      <H2 id="o-que-e">O que é o Pterodroid</H2>
      <P>
        O <strong>Pterodroid</strong> é um painel de hospedagem pessoal, inspirado no <em>Pterodactyl</em>, mas
        projetado desde o início para rodar em ambientes onde painéis tradicionais não funcionam: <strong>Termux</strong> e{' '}
        <strong>Ubuntu proot</strong> em dispositivos Android, além de Linux e Docker. Ele é leve e{' '}
        <strong>não depende de <C>systemd</C></strong> nem de ferramentas como <C>pm2</C> — o próprio backend supervisiona
        todos os processos.
      </P>
      <Callout type="note" title="Filosofia do projeto">
        <p>
          O Pterodroid foi desenvolvido para uso <strong>pessoal e individual</strong>. Ele não foi projetado para
          multi-tenancy nem como plataforma de marketplace: o foco é uma experiência otimizada para um único usuário.
        </p>
      </Callout>

      <H2 id="como-funciona">Como funciona</H2>
      <P>
        O backend (Node.js + Express + Socket.io) adota uma arquitetura de <strong>Supervisor-Filho</strong>: ele mesmo
        inicia, monitora e reinicia seus serviços como processos filhos (<C>child_process</C>), ou como containers
        quando há um Docker Engine disponível. A interface web (React + Vite + Tailwind) é servida pelo próprio backend
        na porta <C>3001</C>.
      </P>
      <Ul>
        <li><strong>Banco interno:</strong> SQLite via <C>sql.js</C> (WASM) — zero compilação nativa, roda no Termux.</li>
        <li><strong>Autenticação:</strong> JWT (validade de 7 dias) + senhas com <C>bcryptjs</C>.</li>
        <li><strong>Logs ao vivo:</strong> stdout/stderr transmitidos por WebSocket.</li>
        <li><strong>Watchdog:</strong> serviços que caem são reiniciados com política de backoff (bancos de dados não — por segurança contra corrupção).</li>
        <li><strong>Acesso remoto:</strong> integração com <C>cloudflared</C> (Quick Tunnel e Named Tunnel).</li>
      </Ul>
      <P>
        Veja o detalhamento completo em <DocLink to="/docs/arquitetura">Arquitetura</DocLink>.
      </P>

      <H2 id="o-que-da-para-hospedar">O que dá para hospedar</H2>
      <DocTable
        head={['Tipo', 'Como o Pterodroid ajuda']}
        rows={[
          [<strong key="1">Bots de Discord / Telegram</strong>, <>Clone via Git, <C>npm install</C> automático, watchdog e logs ao vivo.</>],
          [<strong key="2">APIs e apps Node/TypeScript</strong>, <>Starter automático com <C>tsconfig.json</C> e <C>src/index.ts</C>; comando inferido do <C>main_file</C>.</>],
          [<strong key="3">Sites estáticos</strong>, 'Workspace próprio + gerenciador de arquivos completo com upload/download.'],
          [<strong key="4">Bancos de dados</strong>, <>Provisionamento de <strong>PostgreSQL</strong> e <strong>MySQL/MariaDB</strong> como processos locais.</>],
          [<strong key="5">Containers Docker</strong>, 'Serviços em container com bind mount do workspace, logs e terminal via docker exec.'],
        ]}
      />

      <H2 id="caminho-rapido">Caminho rápido</H2>
      <Steps
        items={[
          { title: 'Escolha o ambiente', body: <>Confira os <DocLink to="/docs/requisitos">requisitos</DocLink> e escolha entre <DocLink to="/docs/termux">Termux</DocLink>, <DocLink to="/docs/proot">Ubuntu proot</DocLink>, <DocLink to="/docs/docker">Docker</DocLink> ou <DocLink to="/docs/linux">Linux</DocLink>.</> },
          { title: 'Instale e inicie o painel', body: <>Cada guia termina com o painel de pé em <C>http://localhost:3001</C>.</> },
          { title: 'Faça o primeiro acesso', body: <>Login <C>admin</C>/<C>admin</C> — e <strong>troque a senha imediatamente</strong>. Veja <DocLink to="/docs/primeiro-acesso">Primeiro acesso</DocLink>.</> },
          { title: 'Crie o primeiro serviço', body: <>Siga o passo a passo em <DocLink to="/docs/primeiro-servico">Primeiro serviço</DocLink>.</> },
        ]}
      />
      <CodeBlock
        title="atalho: Termux em 4 comandos"
        platform="termux"
        code={`pkg update && pkg install git nodejs-lts cloudflared -y
git clone ${site.repo.clone}
cd pterodroid && chmod +x install-termux.sh panelctl.sh
./install-termux.sh && ./panelctl.sh start`}
        description="Instala dependências, clona o repositório, roda o instalador e inicia o painel em http://localhost:3001."
      />
      <P>
        Prefere um resumo em uma página? O repositório mantém o{' '}
        <Ext href={site.repo.comeceAqui}>COMECE-AQUI.md</Ext> com o mesmo fluxo. Para escolher a plataforma
        visualmente, use a página <Link to="/download" className="font-medium text-cyan-neon underline decoration-cyan-neon/40 underline-offset-2">Download</Link>.
      </P>
    </>
  ),
};

export const requisitos: DocPage = {
  slug: 'requisitos',
  title: 'Requisitos',
  description: 'O que você precisa em cada ambiente antes de instalar o Pterodroid.',
  keywords: ['node 18', 'nodejs-lts', 'docker compose', 'termux', 'proot-distro', 'git', 'cloudflared', 'pré-requisitos', 'hardware'],
  sourcePath: 'apps/documentation/src/docs/content/intro.tsx',
  sections: [
    { id: 'por-ambiente', title: 'Requisitos por ambiente' },
    { id: 'observacoes', title: 'Observações importantes' },
  ],
  render: () => (
    <>
      <P>
        O Pterodroid foi construído para ambientes com recursos limitados: sem compilação nativa (nada de{' '}
        <C>node-gyp</C>), sem <C>systemd</C> e com banco interno em WASM. Os requisitos são modestos.
      </P>
      <H2 id="por-ambiente">Requisitos por ambiente</H2>
      <DocTable
        head={['Ambiente', 'Requisitos', 'Guia']}
        rows={[
          [
            <strong key="a">Android / Termux</strong>,
            <>Termux atualizado, <C>nodejs-lts</C>, <C>git</C> e (opcional, para acesso remoto) <C>cloudflared</C> — todos via <C>pkg</C>. Não precisa de root.</>,
            <DocLink key="al" to="/docs/termux">Instalar no Termux</DocLink>,
          ],
          [
            <strong key="b">Android / Ubuntu proot</strong>,
            <>Um Ubuntu proot funcional (ex.: via <C>proot-distro</C> no Termux) com acesso ao shell.</>,
            <DocLink key="bl" to="/docs/proot">Instalar no proot</DocLink>,
          ],
          [
            <strong key="c">Docker</strong>,
            <>Docker Engine + Docker Compose no host. Acesso ao socket <C>/var/run/docker.sock</C> para gerenciar containers.</>,
            <DocLink key="cl" to="/docs/docker">Instalar com Docker</DocLink>,
          ],
          [
            <strong key="d">Linux / VPS / Raspberry Pi / PC</strong>,
            <>Node.js <strong>18+</strong>, <C>git</C> e Bash. Qualquer distro serve — o método manual não depende de systemd.</>,
            <DocLink key="dl" to="/docs/linux">Instalar no Linux</DocLink>,
          ],
        ]}
      />
      <H2 id="observacoes">Observações importantes</H2>
      <Ul>
        <li><strong>Navegador moderno</strong> (Chrome, Firefox, Safari…) para acessar o painel — inclusive o navegador do próprio celular.</li>
        <li><strong>Root não é necessário</strong> no Android: o Termux roda inteiramente em userland.</li>
        <li><strong>ARM e x86</strong> são suportados — as dependências são instaladas na própria plataforma pelo script de instalação (por isso o pacote não inclui <C>node_modules</C>).</li>
        <li><strong>Windows não tem suporte oficial.</strong> Rodar via Docker Desktop ou WSL pode funcionar, mas não é validado pelo projeto — veja o <DocLink to="/docs/faq">FAQ</DocLink>.</li>
        <li><strong>cloudflared</strong> só é necessário se você quiser <DocLink to="/docs/cloudflare">acesso remoto</DocLink> via Cloudflare Tunnel.</li>
      </Ul>
      <Callout type="tip">
        <p>
          Em dúvida sobre qual caminho seguir? Use a página <DocLink to="/docs/instalacao">Instalação</DocLink> — ela
          compara os métodos e aponta o guia certo.
        </p>
      </Callout>
    </>
  ),
};

export const instalacao: DocPage = {
  slug: 'instalacao',
  title: 'Instalação — visão geral',
  navLabel: 'Visão geral',
  description: 'Compare os métodos de instalação do Pterodroid e escolha o ideal para o seu ambiente.',
  keywords: ['instalar', 'install', 'escolher método', 'termux', 'docker', 'proot', 'linux', 'manual', 'node 18'],
  sourcePath: 'apps/documentation/src/docs/content/intro.tsx',
  sections: [
    { id: 'escolha', title: 'Escolha seu ambiente' },
    { id: 'metodo-manual', title: 'Método manual (qualquer sistema com Node 18+)' },
    { id: 'depois-de-instalar', title: 'Depois de instalar' },
  ],
  render: () => (
    <>
      <P>
        Existem <strong>quatro caminhos oficiais</strong> de instalação, todos partindo do mesmo repositório. Escolha{' '}
        <strong>um</strong>:
      </P>
      <H2 id="escolha">Escolha seu ambiente</H2>
      <DocTable
        head={['Método', 'Ideal para', 'Script']}
        rows={[
          [<DocLink key="1" to="/docs/termux">Android / Termux</DocLink>, 'Rodar direto no celular ou tablet, sem root.', <C key="1c">install-termux.sh</C>],
          [<DocLink key="2" to="/docs/proot">Ubuntu proot</DocLink>, 'Quem prefere um userland Ubuntu completo dentro do Android.', <C key="2c">install-ubuntu-proot.sh</C>],
          [<DocLink key="3" to="/docs/docker">Docker</DocLink>, 'PCs, VPS e homelabs — com gerenciamento de containers do host.', <C key="3c">docker compose up -d --build</C>],
          [<DocLink key="4" to="/docs/linux">Linux</DocLink>, 'Qualquer distro com Node 18+ (VPS, Raspberry Pi, desktop).', 'manual (frontend + backend)'],
        ]}
      />
      <H2 id="metodo-manual">Método manual (qualquer sistema com Node 18+)</H2>
      <P>
        Documentado no <Ext href={site.repo.comeceAqui}>COMECE-AQUI.md</Ext>: compile o frontend e suba o backend.
      </P>
      <CodeBlock
        platform="linux"
        title="instalação manual"
        code={`cd pterodroid/apps/frontend && npm install && npm run build
cd ../backend && npm install && npm start`}
        description="O backend serve a interface compilada e a API na mesma porta (3001 por padrão)."
      />
      <H2 id="depois-de-instalar">Depois de instalar</H2>
      <Steps
        items={[
          { title: 'Acesse o painel', body: <><C>http://localhost:3001</C> — de outro aparelho na mesma rede, troque <C>localhost</C> pelo IP do dispositivo.</> },
          { title: 'Faça login e troque a senha', body: <>Credenciais padrão <C>admin</C>/<C>admin</C>. Guia: <DocLink to="/docs/primeiro-acesso">Primeiro acesso</DocLink>.</> },
          { title: 'Crie seu primeiro serviço', body: <DocLink to="/docs/primeiro-servico">Primeiro serviço</DocLink> },
        ]}
      />
      <Callout type="warning" title="Interface em branco?">
        <p>
          O frontend não foi compilado. Rode <C>cd apps/frontend && npm install && npm run build</C> e recarregue. O{' '}
          <C>panelctl.sh</C> avisa sobre isso no start. Mais casos em{' '}
          <DocLink to="/docs/troubleshooting">Troubleshooting</DocLink>.
        </p>
      </Callout>
    </>
  ),
};
