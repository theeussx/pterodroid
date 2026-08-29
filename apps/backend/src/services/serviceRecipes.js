'use strict';
/**
 * serviceRecipes — catálogo de "receitas" dedicadas por tipo de serviço.
 *
 * O Pterodroid nasceu com um campo `type` (node/python/bot/api/web/shell)
 * que era só um rótulo: o formulário era o mesmo para qualquer tipo e o
 * painel não mudava de comportamento. O objetivo desta etapa é dar a cada
 * tipo uma experiência **dedicada**, no espírito dos "eggs"/"nests" de
 * painéis como o Pterodactyl e da praticidade de uma VPS moderna:
 *
 *   - Um catálogo com nome, descrição, categoria, ícone e porta padrão;
 *   - Defaults sensatos por tipo (comando de início, porta, config);
 *   - Scaffold opcional de projeto inicial (API Node, bot, site estático,
 *     API Python...) — um clique e o serviço já nasce funcional;
 *   - Metadados que o frontend usa para desenhar um formulário dedicado;
 *   - Mapeamento de tipos legados para a receita mais próxima, para que
 *     serviços antigos continuem exibindo rótulo e ícone corretos.
 *
 * A ideia é: quem sabe o que quer hospedar escolhe a "receita" e o painel
 * guia pelo caminho certo — em vez de um formulário genérico cheio de
 * campos que não se aplicam.
 */
const fs = require('fs');
const path = require('path');
const slugify = require('./workspaceManager').slugify;

/**
 * Cada receita recebe uma função `scaffold(rootDir, name)` (opcional) que
 * grava um projeto inicial utilizável. NUNCA roda install/build aqui — isso
 * é papel do setupManager e é acionado sob demanda com progresso observável.
 */
const RECIPES = [
  {
    id: 'node-api',
    label: 'API Node.js',
    description: 'Servidor HTTP em Node.js/Express — REST, GraphQL ou qualquer API.',
    category: 'Web & API',
    icon: 'server',
    language: 'node',
    defaultType: 'api',
    defaultPort: 3000,
    defaultCommand: 'node src/index.js',
    keywords: ['node', 'express', 'rest', 'graphql', 'api', 'http'],
    scaffold(rootDir, name) {
      const pkg = {
        name: slugify(name),
        version: '1.0.0',
        private: true,
        description: `API ${name} criada pelo Pterodroid`,
        main: 'src/index.js',
        scripts: { start: 'node src/index.js' },
      };
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      ensureDir(rootDir, 'src');
      fs.writeFileSync(path.join(rootDir, 'src', 'index.js'), [
        "const http = require('http');",
        '',
        'const port = Number(process.env.PORT || 3000);',
        '',
        'const server = http.createServer((req, res) => {',
        "  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });",
        "  res.end(JSON.stringify({ ok: true, service: '" + name + "', pid: process.pid }));",
        '});',
        '',
        'server.listen(port, () => console.log(`API ' + name + ' ouvindo na porta ${port}`));',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(rootDir, 'src', '.gitkeep'), '');
    },
  },
  {
    id: 'node-bot',
    label: 'Bot (Discord/Telegram)',
    description: 'Bot em Node.js — Discord, Telegram, WhatsApp. Roda em background com token via variável de ambiente.',
    category: 'Bots',
    icon: 'bot',
    language: 'node',
    defaultType: 'bot',
    defaultPort: null,
    defaultCommand: 'node src/index.js',
    keywords: ['discord', 'telegram', 'bot', 'node'],
    scaffold(rootDir, name) {
      const pkg = {
        name: slugify(name),
        version: '1.0.0',
        private: true,
        description: `Bot ${name} criado pelo Pterodroid`,
        main: 'src/index.js',
        scripts: { start: 'node src/index.js' },
      };
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      ensureDir(rootDir, 'src');
      fs.writeFileSync(path.join(rootDir, 'src', 'index.js'), [
        `// Bot ${name} — cole sua lógica aqui. O token deve vir de uma variável de ambiente.`,
        'const token = process.env.TOKEN || "COLE_SEU_TOKEN_AQUI";',
        '',
        '// Ex.: discord.js',
        '// const { Client, GatewayIntentBits } = require("discord.js");',
        '// const client = new Client({ intents: [GatewayIntentBits.Guilds] });',
        '',
        `console.log("Bot ${name} aguardando configuração. Defina a variável de ambiente TOKEN.");`,
        '// client.login(token);',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(rootDir, 'src', '.gitkeep'), '');
    },
  },
  {
    id: 'node-web',
    label: 'Site Node.js',
    description: 'Site/Web app servido por Node.js — Express, Next.js, etc.',
    category: 'Web & API',
    icon: 'globe',
    language: 'node',
    defaultType: 'web',
    defaultPort: 3000,
    defaultCommand: 'node src/index.js',
    keywords: ['site', 'web', 'node', 'express', 'html'],
    scaffold(rootDir, name) {
      const pkg = {
        name: slugify(name),
        version: '1.0.0',
        private: true,
        description: `Site ${name} criado pelo Pterodroid`,
        main: 'src/index.js',
        scripts: { start: 'node src/index.js' },
      };
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      ensureDir(rootDir, 'src');
      fs.writeFileSync(path.join(rootDir, 'src', 'index.js'), [
        "const http = require('http');",
        "const fs = require('fs');",
        "const path = require('path');",
        '',
        'const port = Number(process.env.PORT || 3000);',
        'const root = path.join(__dirname, "public");',
        '',
        'const server = http.createServer((req, res) => {',
        '  const file = path.join(root, req.url === "/" ? "index.html" : req.url);',
        "  fs.readFile(file, (err, data) => {",
        "    if (err) { res.writeHead(404); res.end('404'); return; }",
        "    res.writeHead(200); res.end(data);",
        '  });',
        '});',
        '',
        'server.listen(port, () => console.log(`Site ' + name + ' no ar em http://localhost:${port}`));',
        '',
      ].join('\n'));
      ensureDir(rootDir, path.join('src', 'public'));
      const pubIndex = path.join(rootDir, 'src', 'public', 'index.html');
      if (!fs.existsSync(pubIndex)) {
        fs.writeFileSync(pubIndex, [
          '<!doctype html>',
          '<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />',
          `  <title>${name}</title>`,
          '</head><body><h1>' + name + '</h1><p>Site Node.js criado pelo Pterodroid.</p></body></html>',
          '',
        ].join('\n'));
      }
    },
  },
  {
    id: 'static-site',
    label: 'Site estático',
    description: 'HTML/CSS/JS puros servidos na hora — sem build. Ideal pra landing page, portfólio e docs.',
    category: 'Web & API',
    icon: 'globe',
    language: 'static',
    defaultType: 'web',
    defaultPort: 8080,
    defaultCommand: 'python3 -m http.server 8080 --directory .',
    keywords: ['html', 'static', 'site', 'http.server', 'python'],
    scaffold(rootDir, name) {
      fs.writeFileSync(path.join(rootDir, 'index.html'), [
        '<!doctype html>',
        '<html lang="pt-BR">',
        '<head>',
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
        `  <title>${name}</title>`,
        '  <style>',
        '    body{font-family:system-ui,sans-serif;max-width:640px;margin:4rem auto;padding:0 1rem;color:#0b1220;line-height:1.6}',
        '    h1{color:#2563eb} code{background:#eef2ff;padding:.1rem .4rem;border-radius:.3rem}',
        '  </style>',
        '</head>',
        '<body>',
        `  <h1>${name}</h1>`,
        '  <p>Site estático criado pelo <strong>Pterodroid</strong>.</p>',
        '  <p>Edite o <code>index.html</code> na aba <strong>Arquivos</strong> do serviço ou pela pasta do workspace.</p>',
        '</body>',
        '</html>',
        '',
      ].join('\n'));
    },
  },
  {
    id: 'python-api',
    label: 'API Python',
    description: 'API em Python com Flask ou FastAPI. Instala dependências de requirements.txt automaticamente.',
    category: 'Web & API',
    icon: 'filecode',
    language: 'python',
    defaultType: 'python',
    defaultPort: 8000,
    defaultCommand: 'python3 app.py',
    keywords: ['python', 'flask', 'fastapi', 'api', 'pip'],
    scaffold(rootDir, name) {
      fs.writeFileSync(path.join(rootDir, 'app.py'), [
        'from http.server import HTTPServer, BaseHTTPRequestHandler',
        'import json, os',
        '',
        'class Handler(BaseHTTPRequestHandler):',
        '    def do_GET(self):',
        "        body = json.dumps({'ok': True, 'service': '" + name + "'}).encode()",
        "        self.send_response(200)",
        "        self.send_header('Content-Type', 'application/json; charset=utf-8')",
        '        self.send_header("Content-Length", str(len(body)))',
        '        self.end_headers()',
        '        self.wfile.write(body)',
        '',
        "def main():",
        "    port = int(os.environ.get('PORT', 8000))",
        "    HTTPServer(('0.0.0.0', port), Handler).serve_forever()",
        '',
        "if __name__ == '__main__':",
        '    main()',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(rootDir, 'requirements.txt'), '# Ex.:\n# flask\n# fastapi\n');
      fs.writeFileSync(path.join(rootDir, 'README.md'), [
        `# ${name}`,
        '',
        'API Python criada pelo Pterodroid.',
        '',
        'Use o botão **Executar Setup** para instalar as dependências de `requirements.txt`.',
        '',
      ].join('\n'));
    },
  },
  {
    id: 'minecraft',
    label: 'Servidor Minecraft',
    description: 'Servidor Minecraft Java (Paper/Spigot/Vanilla). Requer Java instalado; coloque o server.jar na pasta.',
    category: 'Jogos',
    icon: 'gamepad',
    language: 'java',
    defaultType: 'other',
    defaultPort: 25565,
    defaultCommand: 'java -Xmx1024M -Xms1024M -jar server.jar nogui',
    keywords: ['minecraft', 'java', 'paper', 'spigot', 'server.jar', 'jogo', 'game'],
    scaffold(rootDir, name) {
      fs.writeFileSync(path.join(rootDir, 'eula.txt'), 'eula=true\n');
      fs.writeFileSync(path.join(rootDir, 'server.properties'), [
        '# Configuração básica do servidor Minecraft (editável pelo painel)',
        'motd=' + name,
        'server-port=25565',
        'online-mode=true',
        'difficulty=easy',
        'max-players=10',
        'view-distance=10',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(rootDir, 'README.md'), [
        `# Servidor Minecraft — ${name}`,
        '',
        'Você precisa de Java e de um **server.jar** (Vanilla, Paper ou Spigot):',
        '',
        '- Baixe o jar do seu servidor favorito e coloque-o nesta pasta como `server.jar`.',
        '- O comando de início já está configurado com `-Xmx1024M` (ajuste a memória conforme o dispositivo).',
        '- A porta padrão é 25565.',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(rootDir, '.gitkeep'), '');
    },
  },
  {
    id: 'docker',
    label: 'Container Docker',
    description: 'Roda qualquer imagem Docker num host cadastrado (local ou remoto).',
    category: 'Container',
    icon: 'container',
    language: 'docker',
    defaultType: 'other',
    runtimeType: 'docker',
    defaultPort: null,
    defaultCommand: null,
    keywords: ['docker', 'container', 'imagem', 'image'],
  },
  {
    id: 'generic',
    label: 'Geral / customizado',
    description: 'Qualquer comando ou processinho — você define tudo na mão.',
    category: 'Outro',
    icon: 'boxes',
    language: 'generic',
    defaultType: 'other',
    defaultPort: null,
    defaultCommand: null,
    keywords: ['shell', 'custom', 'outro', 'executável', 'generic'],
  },
];

/** Receita usada quando um id não bate com nenhuma do catálogo. */
const GENERIC = RECIPES.find((r) => r.id === 'generic');

/**
 * Mapeia o `type` legado (campo que os serviços antigos usam) para a
 * receita mais próxima — assim um serviço criado antes deste recurso
 * continua exibindo rótulo e ícone corretos no painel.
 */
const TYPE_TO_RECIPE = {
  node: 'node-api',
  api: 'node-api',
  bot: 'node-bot',
  web: 'node-web',
  python: 'python-api',
  shell: 'generic',
  other: 'generic',
  minecraft: 'minecraft',
};

/** Devolve a receita pelo id (ou a genérica). */
function get(id) {
  if (!id) return GENERIC;
  return RECIPES.find((r) => r.id === id) || GENERIC;
}

/** Devolve a receita mais próxima de um `type` legado. */
function forType(type) {
  return get(TYPE_TO_RECIPE[type] || 'generic');
}

/** true se a receita fornece scaffold de projeto inicial. */
function hasScaffold(id) {
  return typeof get(id).scaffold === 'function';
}

/**
 * Metadados seguros para envio à UI (remove a função scaffold).
 * `runtimeType` é preenchido quando a receita anula o runtime (ex.: docker).
 */
function publicMeta(recipe) {
  const r = recipe || GENERIC;
  return {
    id: r.id,
    label: r.label,
    description: r.description,
    category: r.category,
    icon: r.icon,
    language: r.language,
    defaultType: r.defaultType,
    defaultPort: r.defaultPort,
    defaultCommand: r.defaultCommand,
    runtimeType: r.runtimeType || null,
    keywords: r.keywords || [],
    hasTemplate: typeof r.scaffold === 'function',
  };
}

/** Catálogo completo (JSON-safe) ordenado por categoria de uso. */
function catalog() {
  return RECIPES
    .map(publicMeta)
    .sort((a, b) => {
      const cat = String(a.category).localeCompare(String(b.category), 'pt-BR');
      if (cat !== 0) return cat;
      return String(a.label).localeCompare(String(b.label), 'pt-BR');
    });
}

/**
 * Aplica os defaults de uma receita sobre um corpo de criação, SEM
 * sobrescrever o que o usuário já preencheu. Retorna um objeto com apenas
 * os campos que a receita define e que o corpo não especificou.
 */
function applyDefaults(id, body = {}) {
  const r = get(id);
  const out = {};
  // Tipo (engine): só aplica se o usuário não escolheu um type explícito.
  if (!body.type) out.type = r.defaultType || 'other';
  // Porta padrão: só aplica se o usuário deixou vazio.
  if ((body.port === undefined || body.port === '' || body.port === null) && r.defaultPort) {
    out.port = r.defaultPort;
  }
  // Runtime: receitas que definem runtime (ex.: docker) SEMPRE comandam —
  // escolher a receita "Container Docker" é uma escolha explícita de
  // runtime, não um detalhe que o formulário possa desmentir.
  if (r.runtimeType) out.runtime_type = r.runtimeType;
  // Comando: só aplica se o usuário não forneceu um comando/startup.
  if (!body.command && !body.startup_command && r.defaultCommand) {
    out.command = r.defaultCommand;
  }
  return out;
}

/**
 * Valida uma receita antes da criação. Retorna uma string de erro ou null.
 * A validação de campos obrigatórios (imagem/host p/ docker) continua na
 * rota, sobre o corpo já com defaults aplicados; aqui só conferimos se o
 * id da receita existe no catálogo.
 */
function validateRecipe(id, body = {}) {
  if (!id) return null;
  const r = get(id);
  // get() cai na genérica para ids desconhecidos; o id original só é
  // "válido" se bater exatamente com uma receita do catálogo.
  if (r.id === 'generic' && !RECIPES.some((x) => x.id === id)) {
    return `Receita desconhecida: ${id}`;
  }
  // Receitas de container exigem que o host Docker exista — a UI não deixa,
  // mas a API também não deve aceitar.
  if (r.runtimeType === 'docker' && !body.docker_host_id) {
    return 'Selecione um host Docker para serviços em container';
  }
  return null;
}

/**
 * Grava o projeto inicial de uma receita no workspace. Idempotente o
 * suficiente para não sobrescrever arquivos que já existem com conteúdo do
 * usuário (só cria o que falta), retornando quantos arquivos foram criados.
 */
/** Cria uma subpasta do template se ainda não existir. */
function ensureDir(rootDir, sub) {
  const p = path.join(rootDir, sub);
  try { fs.mkdirSync(p, { recursive: true }); } catch { /* ok */ }
  return p;
}

function scaffoldService(id, rootDir, name) {
  const r = get(id);
  if (typeof r.scaffold !== 'function') return { created: 0, skipped: 0 };

  const before = new Set(listFiles(rootDir));

  r.scaffold(rootDir, name);

  const after = new Set(listFiles(rootDir));
  let created = 0;
  let skipped = 0;
  for (const file of after) {
    if (!before.has(file)) created += 1;
    else skipped += 1;
  }
  return { created, skipped };
}

/** Lista todos os arquivos (relativos) de um diretório recursivamente. */
function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(path.relative(dir, full));
    }
  }
  return out;
}

/** Metadados públicos para enriquecer uma linha de serviço. */
function describeRow(row) {
  if (!row) return null;
  const recipe = row.recipe ? get(row.recipe) : forType(row.type);
  return publicMeta(recipe);
}

module.exports = {
  RECIPES,
  catalog,
  get,
  forType,
  hasScaffold,
  applyDefaults,
  validateRecipe,
  scaffoldService,
  describeRow,
  publicMeta,
};
