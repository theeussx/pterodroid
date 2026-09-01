import { C, Callout, CodeBlock, DocLink, DocTable, H2, P, Steps, Ul } from '../../components/docui';
import type { DocPage } from '../types';

export const cloudflare: DocPage = {
  slug: 'cloudflare',
  title: 'Acesso remoto com Cloudflare Tunnel',
  navLabel: 'Cloudflare Tunnel',
  description: 'Exponha o painel e seus serviços à internet sem abrir portas: Quick Tunnel e Named Tunnel (CLI ou token).',
  keywords: ['cloudflared', 'quick tunnel', 'named tunnel', 'trycloudflare', 'domínio', 'dns', 'cname', 'zero trust', 'token', 'tunnel login', 'access tcp', 'acesso remoto'],
  sourcePath: 'apps/documentation/src/docs/content/remote.tsx',
  sections: [
    { id: 'visao-geral', title: 'Visão geral' },
    { id: 'quick-tunnel', title: 'Quick Tunnel (túnel rápido)' },
    { id: 'named-tunnel', title: 'Named Tunnel (domínio próprio)' },
    { id: 'opcao-a', title: 'Opção A — gerenciado pelo painel (CLI)' },
    { id: 'opcao-b', title: 'Opção B — token do dashboard Cloudflare' },
    { id: 'tcp', title: 'Acesso TCP (bancos de dados)' },
  ],
  render: () => (
    <>
      <H2 id="visao-geral">Visão geral</H2>
      <P>
        O Pterodroid integra-se ao <strong>Cloudflare Tunnel</strong> (<C>cloudflared</C>) para expor o painel e seus
        serviços à internet de forma segura, <strong>sem abrir portas no roteador</strong>. Instale o binário (no
        Termux: <C>pkg install cloudflared</C>) ou aponte <C>CLOUDFLARED_BIN</C> para o caminho dele.
      </P>
      <Callout type="danger" title="Antes de expor o painel">
        <p>
          Publicar o painel é publicar <strong>capacidade administrativa + execução de comandos</strong> no seu
          dispositivo. Siga o checklist de <DocLink to="/docs/producao">Publicação segura</DocLink> antes de criar o
          primeiro túnel.
        </p>
      </Callout>

      <H2 id="quick-tunnel">Quick Tunnel (túnel rápido)</H2>
      <P>
        Ideal para acesso temporário ou testes: o painel inicia um túnel que gera uma URL pública aleatória{' '}
        <C>*.trycloudflare.com</C>, sem precisar de conta na Cloudflare.
      </P>
      <Callout type="warning" title="Limitações do Quick Tunnel">
        <Ul>
          <li>A URL <strong>não é persistente</strong> — muda a cada reinício do túnel.</li>
          <li>Adequado <strong>apenas para serviços HTTP/HTTPS</strong>.</li>
          <li><strong>Bancos de dados não podem ser acessados</strong> via Quick Tunnel.</li>
        </Ul>
      </Callout>

      <H2 id="named-tunnel">Named Tunnel (domínio próprio)</H2>
      <P>
        Para acesso persistente e profissional (ex.: <C>painel.seusite.com</C>), configure um túnel nomeado. O
        Pterodroid suporta duas formas:
      </P>

      <H2 id="opcao-a">Opção A — gerenciado pelo painel (CLI-managed)</H2>
      <P>
        O painel automatiza a criação do túnel, o arquivo <C>config.yml</C> e o roteamento DNS (registros{' '}
        <C>CNAME</C> na Cloudflare):
      </P>
      <Steps
        items={[
          {
            title: 'Autentique o cloudflared',
            body: (
              <CodeBlock
                platform="terminal"
                code={`cloudflared tunnel login`}
                description="Abre uma página no navegador para autorizar o cloudflared na sua conta Cloudflare."
              />
            ),
          },
          { title: 'Crie o túnel nomeado no painel', body: 'Defina o domínio base e os hostnames para o painel e para cada serviço.' },
          { title: 'Aplique a configuração', body: 'O painel gera a config, roteia o DNS e inicia o túnel. Isso pode causar uma breve interrupção nos serviços.' },
        ]}
      />

      <H2 id="opcao-b">Opção B — token do dashboard Cloudflare (remotely-managed)</H2>
      <P>
        Crie o túnel diretamente no dashboard <strong>Cloudflare Zero Trust</strong> (Networks → Tunnels) e cole o
        token fornecido no Pterodroid.
      </P>
      <Callout type="important">
        <p>
          Neste modo, o roteamento de cada domínio (qual hostname vai para qual porta){' '}
          <strong>é configurado no dashboard da Cloudflare</strong>, na aba “Public Hostname” do túnel. Os campos de
          domínio nos formulários de serviço/banco do Pterodroid <strong>não se aplicam</strong> aqui.
        </p>
      </Callout>

      <H2 id="tcp">Acesso TCP (bancos de dados)</H2>
      <P>
        Para acessar <DocLink to="/docs/bancos">bancos de dados</DocLink> através de um Named Tunnel, o cliente também
        precisa do <C>cloudflared</C>:
      </P>
      <CodeBlock
        platform="cliente"
        code={`cloudflared access tcp --hostname db.seusite.com --url localhost:5432`}
        description="Cria uma ponte TCP local no cliente: conecte seu psql/mysql em localhost na porta indicada."
      />
    </>
  ),
};

export const monitoramento: DocPage = {
  slug: 'monitoramento',
  title: 'Monitoramento de recursos',
  navLabel: 'Monitoramento',
  description: 'CPU, RAM, disco, rede, temperatura e processos ativos em tempo real — direto de /proc e /sys. Healthcheck por serviço e limites de recurso.',
  keywords: ['cpu', 'ram', 'disco', 'rede', 'temperatura', 'processos', 'gráficos', '/proc', 'df', 'ps', 'status', 'tempo real', 'healthcheck', 'limite', 'memória', 'cpu'],
  sourcePath: 'apps/documentation/src/docs/content/remote.tsx',
  sections: [
    { id: 'metricas', title: 'Métricas disponíveis' },
    { id: 'como-funciona', title: 'Como funciona por baixo' },
    { id: 'status-servicos', title: 'Status dos serviços' },
    { id: 'healthcheck', title: 'Healthcheck por serviço' },
    { id: 'limites-recurso', title: 'Limites de recurso' },
  ],
  render: () => (
    <>
      <H2 id="metricas">Métricas disponíveis</H2>
      <DocTable
        head={['Métrica', 'Detalhe']}
        rows={[
          ['CPU', 'Uso em tempo real com gráfico dinâmico.'],
          ['RAM', 'Memória usada/total.'],
          ['Disco', 'Espaço ocupado e disponível.'],
          ['Rede', 'Tráfego de download e upload.'],
          ['Temperatura', 'Sensores térmicos do dispositivo (quando expostos pelo sistema).'],
          ['Processos', 'Lista dos processos ativos — top 20 por CPU.'],
        ]}
      />

      <H2 id="como-funciona">Como funciona por baixo</H2>
      <P>
        Sem agentes e sem dependências nativas: o backend lê diretamente <C>/proc</C>,{' '}
        <C>/sys/class/thermal</C>, <C>ps</C> e <C>df</C> — por isso funciona igual no Termux, no proot e no Linux. Os
        dados chegam ao painel em tempo real via Socket.io.
      </P>
      <Callout type="note">
        <p>
          A leitura de temperatura depende dos sensores que o sistema expõe em <C>/sys/class/thermal</C>; em alguns
          dispositivos/containers ela pode não estar disponível.
        </p>
      </Callout>

      <H2 id="status-servicos">Status dos serviços</H2>
      <Ul>
        <li>Cada serviço mostra seu estado atual (rodando/parado) e reinicializações do watchdog.</li>
        <li>Logs de console (stdout/stderr) ao vivo por WebSocket — veja <DocLink to="/docs/primeiro-servico">Primeiro serviço</DocLink>.</li>
        <li>Para inspecionar processos pontualmente, o <DocLink to="/docs/terminal">terminal</DocLink> aceita comandos como <C>ps aux | head -n 20</C> (programas de tela cheia como <C>htop</C> não são suportados).</li>
      </Ul>

      <H2 id="healthcheck">Healthcheck por serviço</H2>
      <P>
        O watchdog de processo cuida de "caiu e morreu". O <strong>healthcheck</strong> cobre o caso mais traiçoeiro:
        o processo está vivo mas o servidor não responde (travou). No formulário do serviço, ative o healthcheck e
        informe a URL de verificação.
      </P>
      <Ul>
        <li><strong>URL</strong> pode ser um caminho (<C>/health</C>) ou URL cheia (<C>http://127.0.0.1:8080/health</C>). Se deixar vazio, usa <C>/</C> na porta do serviço.</li>
        <li><strong>Intervalo</strong> (s) entre verificações — mínimo 5.</li>
        <li><strong>Timeout</strong> (s) de cada verificação.</li>
        <li>Se a verificação falhar, o processo é encerrado e reiniciado como um crash normal (respeitando <C>auto_restart</C> e as <C>max_restarts</C>). Uma mensagem é registrada no log e um <DocLink to="/docs/seguranca">alerta</DocLink> pode ser disparado.</li>
      </Ul>

      <H2 id="limites-recurso">Limites de recurso</H2>
      <P>
        Containers Docker têm limites nativos (<C>cpu_limit</C>/<C>memory_limit</C>). Para processos locais, o
        formulário aceita <strong>limite de memória (MB)</strong> e <strong>limite de CPU (núcleos)</strong>. Eles são
        aplicados via <C>prlimit</C> quando disponível:
      </P>
      <Ul>
        <li>Se o <C>prlimit</C> existir no sistema, o limite é imposto ao processo.</li>
        <li>Se o binário não estiver disponível, o serviço continua rodando normalmente e uma mensagem é logada — o limite é <strong>melhor esforço</strong>, não uma falha.</li>
      </Ul>
    </>
  ),
};
