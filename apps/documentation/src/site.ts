// Fonte única de verdade para links e metadados do projeto.
// Evita hardcode espalhado pelos componentes.

export const site = {
  name: 'Pterodroid',
  tagline: 'Seu servidor. No seu dispositivo. Sob seu controle.',
  description:
    'Painel self-hosted leve para gerenciar serviços, containers, arquivos, bancos e túneis diretamente pelo navegador — feito para Android/Termux, Linux e Docker.',
  license: 'MIT',
  // O projeto não publica releases versionadas; a referência oficial é a branch main.
  versionLabel: 'main',
  defaultPort: 3001,
  repo: {
    url: 'https://github.com/theeussx/pterodroid',
    issues: 'https://github.com/theeussx/pterodroid/issues',
    releases: 'https://github.com/theeussx/pterodroid/releases',
    commits: 'https://github.com/theeussx/pterodroid/commits/main',
    readme: 'https://github.com/theeussx/pterodroid#readme',
    license: 'https://github.com/theeussx/pterodroid/blob/main/LICENSE.md',
    comeceAqui: 'https://github.com/theeussx/pterodroid/blob/main/COMECE-AQUI.md',
    relatorio: 'https://github.com/theeussx/pterodroid/blob/main/docs/RELATORIO.md',
    auditoria: 'https://github.com/theeussx/pterodroid/blob/main/docs/AUDITORIA.md',
    arquiteturaPng: 'https://github.com/theeussx/pterodroid/blob/main/arquitetura.png',
    // Fonte canônica do diagrama (a imagem que está no `main` do repositório).
    // O site de documentação usa esta URL no <img> para refletir SEMPRE o
    // arquivo oficial — sem depender de uma cópia local que possa desatualizar.
    arquiteturaRaw: 'https://raw.githubusercontent.com/theeussx/pterodroid/main/arquitetura.png',
    envExample: 'https://github.com/theeussx/pterodroid/blob/main/.env.example',
    panelctl: 'https://github.com/theeussx/pterodroid/blob/main/panelctl.sh',
    clone: 'https://github.com/theeussx/pterodroid.git',
  },
  editBase: 'https://github.com/theeussx/pterodroid/edit/main/',
} as const;
