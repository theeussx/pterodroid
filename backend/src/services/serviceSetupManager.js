'use strict';
/**
 * serviceSetupManager — gerencia o ciclo completo da configuração inicial
 * de serviços (Etapas 1 a 6).
 *
 * Responsabilidades:
 * - Clone e pull de repositórios Git públicos e privados (com ofuscação de tokens)
 * - Detecção inteligente de gerenciador de pacotes (npm, pnpm, yarn, bun)
 * - Instalação automática de dependências (NodeJS e Python)
 * - Compilação TypeScript com validação antes de inicializar
 * - Resolução do Startup Command (com prioridade sobre inferência automática)
 * - Emissão de status e logs em tempo real por Socket.IO e persistência no banco
 */
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { EventEmitter } = require('events');
const { getDB } = require('../db');
const workspaces = require('./workspaceManager');
const secretCrypto = require('./secretCrypto');

const runningSetups = new Map(); // serviceId -> { serviceId, status, progress, step, error, startedAt }

class ServiceSetupManager extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Verifica se há um setup em andamento para o serviço.
   */
  isRunning(serviceId) {
    return runningSetups.has(Number(serviceId));
  }

  /**
   * Retorna o status atual do setup, combinando memória e banco.
   */
  getStatus(serviceId) {
    const id = Number(serviceId);
    const inMemory = runningSetups.get(id);
    const db = getDB();
    const svc = db.prepare('SELECT setup_status, setup_progress, setup_error, setup_logs, command, startup_command FROM services WHERE id = ?').get(id);
    if (!svc) return null;

    let parsedLogs = [];
    try {
      parsedLogs = typeof svc.setup_logs === 'string' ? JSON.parse(svc.setup_logs || '[]') : (svc.setup_logs || []);
      if (!Array.isArray(parsedLogs)) parsedLogs = [];
    } catch {
      parsedLogs = [];
    }

    const status = inMemory ? inMemory.status : (svc.setup_status || 'Aguardando');
    const progress = inMemory ? inMemory.progress : (svc.setup_progress || 0);
    const error = inMemory ? inMemory.error : (svc.setup_error || '');

    return {
      serviceId: id,
      status,
      progress,
      step: this.getStepName(status),
      error,
      logs: parsedLogs,
      isRunning: !!inMemory,
      command: svc.command || '',
      startup_command: svc.startup_command || '',
    };
  }

  getStepName(status) {
    switch (status) {
      case 'Aguardando': return 'Aguardando';
      case 'Clonando repositório': return 'Git Clone / Atualização';
      case 'Instalando dependências': return 'Instalando dependências';
      case 'Compilando': return 'Compilando TypeScript';
      case 'Iniciando serviço': return 'Iniciando serviço';
      case 'Concluído': return 'Concluído';
      case 'Falhou': return 'Falhou';
      default: return status || 'Aguardando';
    }
  }

  /**
   * Verifica se um executável (npm, pnpm, yarn, bun, pip) está disponível no PATH.
   */
  isBinaryAvailable(bin) {
    try {
      child_process.execSync(`which ${bin}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Identifica o gerenciador de pacotes adequado inspecionando os lockfiles.
   */
  detectPackageManager(workDir) {
    if (fs.existsSync(path.join(workDir, 'bun.lockb')) || fs.existsSync(path.join(workDir, 'bun.lock'))) {
      if (this.isBinaryAvailable('bun')) return 'bun';
    }
    if (fs.existsSync(path.join(workDir, 'pnpm-lock.yaml'))) {
      if (this.isBinaryAvailable('pnpm')) return 'pnpm';
    }
    if (fs.existsSync(path.join(workDir, 'yarn.lock'))) {
      if (this.isBinaryAvailable('yarn')) return 'yarn';
    }
    return 'npm';
  }

  /**
   * Executa um comando Shell sem bloquear o event loop e ofuscando segredos.
   */
  runCommand(cmd, cwd, secrets = [], onLog = null) {
    return new Promise((resolve, reject) => {
      const child = child_process.exec(cmd, {
        cwd,
        env: { ...process.env, CI: '1', npm_config_progress: 'false' },
        maxBuffer: 15 * 1024 * 1024,
      });

      let fullOutput = '';
      let errorOutput = '';

      const handleData = (data, isError = false) => {
        const text = String(data || '');
        const masked = secretCrypto.maskSecrets(text, secrets);
        fullOutput += masked;
        if (isError) errorOutput += masked;
        if (onLog && masked.trim()) {
          const lines = masked.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            onLog(line, isError ? 'error' : 'info');
          }
        }
      };

      child.stdout?.on('data', (d) => handleData(d, false));
      child.stderr?.on('data', (d) => handleData(d, true));

      child.on('close', (code) => {
        if (code === 0) {
          resolve(fullOutput);
        } else {
          const err = new Error(`Comando falhou (código ${code}): ${errorOutput || fullOutput || 'Erro sem saída'}`);
          err.code = code;
          err.output = fullOutput;
          err.errorOutput = errorOutput;
          reject(err);
        }
      });

      child.on('error', (err) => {
        const maskedMsg = secretCrypto.maskSecrets(err.message, secrets);
        reject(new Error(`Falha ao executar comando: ${maskedMsg}`));
      });
    });
  }

  /**
   * Determina o comando de execução do serviço.
   * O Startup Command explícito (configurado pelo usuário) tem prioridade absoluta.
   */
  resolveEffectiveCommand(service, workDir) {
    const userCmd = (service.startup_command || '').trim() || (service.command || '').trim();
    // 1. Prioridade absoluta para Startup Command / comando explícito customizado
    // (a menos que seja o placeholder automático padrão quando não havia comando configurado)
    if (userCmd && userCmd !== 'node index.js') {
      return userCmd;
    }

    const args = (service.node_args || '').trim();
    const argsSuffix = args ? ` ${args}` : '';

    // 2. Arquivo principal informado pelo usuário
    const mf = (service.main_file || '').trim();
    if (mf) {
      const mfRel = mf.replace(/^\/+/, '');
      const looksLikeFullCommand = /\s/.test(mfRel);
      if (looksLikeFullCommand) {
        return `${mfRel}${argsSuffix}`;
      }
      if (mf.endsWith('.ts')) {
        const distPath = path.join(workDir, mfRel.replace(/\.ts$/, '.js').replace(/^src\//, 'dist/'));
        if (fs.existsSync(distPath)) {
          return `node "${path.relative(workDir, distPath)}"${argsSuffix}`;
        }
        return `ts-node --esm "${mfRel}"${argsSuffix}`;
      }
      if (mf.endsWith('.py')) {
        return `python3 "${mfRel}"${argsSuffix}`;
      }
      return `node "${mfRel}"${argsSuffix}`;
    }

    // 3. Inferência automática por inspeção do projeto
    const tsConfigPath = path.join(workDir, 'tsconfig.json');
    const distIndexPath = path.join(workDir, 'dist', 'index.js');
    if (fs.existsSync(tsConfigPath) && fs.existsSync(distIndexPath)) {
      return `node dist/index.js${argsSuffix}`;
    }

    const pkgPath = path.join(workDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts && pkg.scripts.start) {
          const pm = this.detectPackageManager(workDir);
          return `${pm} start${argsSuffix}`;
        }
      } catch {
        // ignora erro de parse, continua inspeção de arquivos
      }
    }

    if (fs.existsSync(path.join(workDir, 'index.js'))) {
      return `node index.js${argsSuffix}`;
    }
    if (fs.existsSync(path.join(workDir, 'server.js'))) {
      return `node server.js${argsSuffix}`;
    }
    if (fs.existsSync(path.join(workDir, 'bot.js'))) {
      return `node bot.js${argsSuffix}`;
    }
    if (fs.existsSync(path.join(workDir, 'main.py'))) {
      return `python3 main.py`;
    }

    // 4. Retorna comando explícito existente ou fallback
    return userCmd || 'node index.js';
  }

  /**
   * Executa a rotina completa de configuração do serviço.
   */
  async runSetup(serviceId, options = {}) {
    const id = Number(serviceId);
    if (this.isRunning(id)) {
      const err = new Error('O setup já está em andamento para este serviço');
      err.status = 409;
      throw err;
    }

    const db = getDB();
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!service) {
      throw new Error('Serviço não encontrado');
    }

    const workDir = workspaces.normalize(service.working_directory) || workspaces.createForService(service.name);
    workspaces.ensureDir(workDir);

    const secrets = [
      service.git_token,
      secretCrypto.decryptSecret(service.git_token),
      service.git_username,
    ].filter(Boolean);

    // Carrega logs existentes e trunca se exceder 500
    let logsArr = [];
    try {
      logsArr = typeof service.setup_logs === 'string' ? JSON.parse(service.setup_logs || '[]') : (service.setup_logs || []);
      if (!Array.isArray(logsArr)) logsArr = [];
    } catch {
      logsArr = [];
    }

    const appendLog = (message, level = 'info') => {
      const masked = secretCrypto.maskSecrets(String(message || ''), secrets);
      const timestamp = new Date().toISOString();
      const lineObj = { timestamp, message: masked, level };
      logsArr.push(lineObj);
      if (logsArr.length > 500) logsArr = logsArr.slice(-500);

      db.prepare('UPDATE services SET setup_logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(logsArr), id);

      if (level === 'error') {
        db.prepare('INSERT INTO logs (service_id, level, message) VALUES (?, ?, ?)')
          .run(id, 'error', `[setup] ${masked}`);
      }

      this.emit('log', { serviceId: id, message: masked, timestamp, level });
    };

    const updateState = (status, progress, errorMsg = '') => {
      const maskedErr = secretCrypto.maskSecrets(String(errorMsg || ''), secrets);
      db.prepare(`
        UPDATE services SET
          setup_status = ?, setup_progress = ?, setup_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, progress, maskedErr, id);

      const inMemory = runningSetups.get(id);
      if (inMemory) {
        inMemory.status = status;
        inMemory.progress = progress;
        inMemory.error = maskedErr;
      }

      this.emit('status', {
        serviceId: id,
        status,
        progress,
        step: this.getStepName(status),
        error: maskedErr,
      });
    };

    runningSetups.set(id, {
      serviceId: id,
      status: 'Aguardando',
      progress: 0,
      step: 'Aguardando',
      error: '',
      startedAt: Date.now(),
    });

    try {
      updateState('Aguardando', 0, '');
      appendLog(`🚀 Iniciando configuração do serviço "${service.name}"...`);

      // ── ETAPA 1 e 5: Git Clone / Pull com autenticação segura ──
      const repoUrl = (service.git_repo || '').trim();
      if (repoUrl) {
        updateState('Clonando repositório', 20, '');
        appendLog(`📦 Repositório Git configurado: ${repoUrl}`);

        let cloneUrl = repoUrl;
        const decryptedToken = secretCrypto.decryptSecret(service.git_token);
        if (decryptedToken) {
          try {
            const u = new URL(repoUrl);
            u.username = encodeURIComponent((service.git_username || '').trim() || 'oauth2');
            u.password = encodeURIComponent(decryptedToken.trim());
            cloneUrl = u.toString();
          } catch {
            // Se repoUrl não for URL válida, tenta como string intacta
          }
        }

        const gitDir = path.join(workDir, '.git');
        if (fs.existsSync(gitDir)) {
          if (service.auto_update) {
            appendLog('🔄 Repositório Git existente detectado. Executando git pull...');
            try {
              await this.runCommand('git fetch origin --tags', workDir, secrets, appendLog);
              await this.runCommand('git pull --rebase || git pull', workDir, secrets, appendLog);
            } catch (pullErr) {
              appendLog(`⚠️ Falha no git pull (${pullErr.message}). Tentando sincronização com git reset --hard...`, 'error');
              await this.runCommand('git fetch origin', workDir, secrets, appendLog);
              await this.runCommand('git reset --hard origin/$(git rev-parse --abbrev-ref HEAD) || true', workDir, secrets, appendLog);
            }
          } else {
            appendLog('✅ Repositório Git já clonado. Pulando (auto_update desativado).');
          }
        } else {
          appendLog('📥 Clonando repositório Git...');
          try {
            await this.runCommand(`git clone "${cloneUrl}" .`, workDir, secrets, appendLog);
          } catch (cloneErr) {
            // Limpa possível diretório .git incompleto para retentativas futuras não falharem
            const badGit = path.join(workDir, '.git');
            try { if (fs.existsSync(badGit)) fs.rmSync(badGit, { recursive: true, force: true }); } catch {}
            throw cloneErr;
          }
        }

        const branch = (service.git_branch || '').trim();
        if (branch) {
          appendLog(`🔀 Mux / Checkout da branch: ${branch}`);
          try {
            await this.runCommand(`git checkout "${branch}"`, workDir, secrets, appendLog);
          } catch (chkErr) {
            throw new Error(`Falha ao fazer checkout da branch "${branch}": ${chkErr.message}`);
          }
        }
      } else {
        appendLog('ℹ️ Nenhum repositório Git especificado.');
        if (service.runtime_type === 'docker' && fs.readdirSync(workDir).length === 0) {
          const { bootstrapNodeProject } = require('./serviceWorkspace');
          bootstrapNodeProject(workDir, service.name);
          appendLog('🌱 Projeto Node mínimo semeado no workspace para container Docker.');
        }
      }

      // ── ETAPA 3: Instalação inteligente de dependências ──
      updateState('Instalando dependências', 50, '');
      const pm = this.detectPackageManager(workDir);
      const isPython = service.type === 'python' || fs.existsSync(path.join(workDir, 'requirements.txt'));

      if (service.unnode_packages && service.unnode_packages.trim()) {
        appendLog(`🗑️ Removendo pacotes NodeJS com ${pm}: ${service.unnode_packages}`);
        await this.runCommand(`${pm} uninstall ${service.unnode_packages.trim()}`, workDir, secrets, appendLog);
      }

      if (service.node_packages && service.node_packages.trim()) {
        appendLog(`📦 Instalando pacotes adicionais com ${pm}: ${service.node_packages}`);
        await this.runCommand(`${pm} install ${service.node_packages.trim()}`, workDir, secrets, appendLog);
      } else if (fs.existsSync(path.join(workDir, 'package.json'))) {
        appendLog(`📦 package.json detectado. Executando "${pm} install"...`);
        await this.runCommand(`${pm} install`, workDir, secrets, appendLog);
      }

      if (isPython && fs.existsSync(path.join(workDir, 'requirements.txt'))) {
        const pipCmd = this.isBinaryAvailable('pip3') ? 'pip3' : 'pip';
        appendLog(`🐍 requirements.txt detectado. Executando "${pipCmd} install -r requirements.txt"...`);
        await this.runCommand(`${pipCmd} install -r requirements.txt`, workDir, secrets, appendLog);
      }

      // ── ETAPA 3: Compilação TypeScript com validação ──
      updateState('Compilando', 75, '');
      const tsConfigPath = path.join(workDir, 'tsconfig.json');
      if (fs.existsSync(tsConfigPath)) {
        appendLog('⚙️ tsconfig.json detectado — compilando TypeScript...');
        let compiled = false;
        const pkgPath = path.join(workDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.scripts && pkg.scripts.build) {
              appendLog(`▶️ Executando script de build do package.json: ${pm} run build...`);
              await this.runCommand(`${pm} run build`, workDir, secrets, appendLog);
              compiled = true;
            }
          } catch {}
        }
        if (!compiled) {
          const tscBin = fs.existsSync(path.join(workDir, 'node_modules/.bin/tsc'))
            ? './node_modules/.bin/tsc'
            : (this.isBinaryAvailable('tsc') ? 'tsc' : 'npx -p typescript tsc');
          appendLog(`▶️ Executando compilação direta: ${tscBin}...`);
          await this.runCommand(tscBin, workDir, secrets, appendLog);
        }
        appendLog('✅ Compilação TypeScript concluída com sucesso!');
        if (fs.existsSync(path.join(workDir, 'dist/index.js'))) {
          appendLog('📁 Arquivo gerado em dist/index.js detectado.');
        }
      } else {
        appendLog('ℹ️ Nenhum arquivo tsconfig.json detectado. Pulando compilação.');
      }

      // ── ETAPA 2: Resolução do comando de inicialização ──
      updateState('Iniciando serviço', 90, '');
      const effectiveCommand = this.resolveEffectiveCommand(service, workDir);
      db.prepare('UPDATE services SET command = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(effectiveCommand, id);
      appendLog(`🎯 Comando de execução resolvido: "${effectiveCommand}"`);

      // ── ETAPA 1 e 4: Inicialização do serviço se solicitado ──
      const shouldStart = options.startService !== false;
      if (shouldStart) {
        appendLog('▶️ Iniciando o serviço...');
        const driver = require('./serviceDriverRegistry');
        try {
          await driver.startService(id);
          appendLog('✅ Serviço iniciado no runtime com sucesso!');
        } catch (startErr) {
          throw new Error(`O serviço foi configurado, mas falhou ao iniciar: ${startErr.message}`);
        }
      }

      updateState('Concluído', 100, '');
      appendLog('✨ Configuração inicial concluída com sucesso!');
      return { ok: true, status: 'Concluído', command: effectiveCommand };
    } catch (err) {
      const msg = secretCrypto.maskSecrets(err.message || 'Erro desconhecido', secrets);
      appendLog(`❌ Setup interrompido com erro: ${msg}`, 'error');
      updateState('Falhou', 0, msg);
      throw err;
    } finally {
      runningSetups.delete(id);
    }
  }
}

const instance = new ServiceSetupManager();
module.exports = instance;
