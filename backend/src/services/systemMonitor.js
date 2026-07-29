/**
 * SystemMonitor — lightweight resource polling.
 * Reads /proc directly. Works in Termux (proot Linux kernel exposes /proc)
 * and in Ubuntu-proot. No native/npm dependency needed.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');

/**
 * Executa um comando externo SEM bloquear o event loop.
 *
 * `df` e `ps` eram chamados com execSync a cada snapshot — ou seja, a cada
 * 2 segundos o painel inteiro (API, WebSocket, logs de todos os serviços)
 * congelava esperando um processo externo terminar. Num aparelho Android
 * com o disco ocupado, `df` pode demorar centenas de milissegundos (P30).
 */
function run(command, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/**
 * Cache com TTL para leituras caras. O snapshot vai pro socket a cada 2s,
 * mas espaço em disco e lista de processos não mudam a esse ritmo — e são
 * justamente os dois que exigem processo externo.
 */
function cached(ttlMs, loader) {
  let value = null;
  let expiresAt = 0;
  let inflight = null;
  return async () => {
    const now = Date.now();
    if (value !== null && now < expiresAt) return value;
    if (inflight) return inflight; // várias chamadas simultâneas = uma execução só
    inflight = loader()
      .then((result) => {
        value = result;
        expiresAt = Date.now() + ttlMs;
        return result;
      })
      .finally(() => { inflight = null; });
    return inflight;
  };
}

function readMeminfo() {
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key) => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) * 1024 : 0; // kB → bytes
    };
    const total = get('MemTotal');
    const available = get('MemAvailable') || get('MemFree');
    const used = total - available;
    return { total, used, free: available, percent: total ? (used / total) * 100 : 0 };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

let _prevCpu = null;
function readCpu() {
  try {
    const raw = fs.readFileSync('/proc/stat', 'utf8');
    const line = raw.split('\n')[0];
    const nums = line.split(/\s+/).slice(1).map(Number);
    const [user, nice, sys, idle, iowait = 0, irq = 0, softirq = 0] = nums;
    const total = user + nice + sys + idle + iowait + irq + softirq;
    const idleTotal = idle + iowait;

    if (!_prevCpu) { _prevCpu = { total, idle: idleTotal }; return 0; }

    const diffTotal = total - _prevCpu.total;
    const diffIdle = idleTotal - _prevCpu.idle;
    _prevCpu = { total, idle: idleTotal };

    if (diffTotal <= 0) return 0;
    return Math.max(0, Math.min(100, ((diffTotal - diffIdle) / diffTotal) * 100));
  } catch {
    return 0;
  }
}

function readUptime() {
  try {
    return parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  } catch {
    return 0;
  }
}

const EMPTY_DISK = { total: 0, used: 0, free: 0, percent: 0 };

/**
 * Espaço em disco do volume onde os dados do painel ficam — é o número que
 * importa pro usuário ("ainda cabe mais um serviço?"), e não o da raiz do
 * sistema, que num container é outro filesystem.
 */
const readDisk = cached(15000, async () => {
  const target = config.DATA_ROOT;
  const out = (await run('df', ['-kP', target])) || (await run('df', ['-k', target])) || (await run('df', ['-k', '/']));
  if (!out) return EMPTY_DISK;

  const lines = out.trim().split('\n');
  if (lines.length < 2) return EMPTY_DISK;
  // Nomes de dispositivo longos fazem o df quebrar a linha; pegar a última
  // linha e ler os campos a partir do fim evita esse problema.
  const parts = lines[lines.length - 1].trim().split(/\s+/);
  const numbers = parts.filter((p) => /^\d+$/.test(p)).map(Number);
  if (numbers.length < 3) return EMPTY_DISK;

  const [totalKb, usedKb, freeKb] = numbers;
  const total = totalKb * 1024;
  const used = usedKb * 1024;
  return { total, used, free: freeKb * 1024, percent: total ? (used / total) * 100 : 0 };
});

let _prevNet = null;
function readNetwork() {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = raw.trim().split('\n').slice(2); // skip the two header lines
    let rxTotal = 0;
    let txTotal = 0;
    for (const line of lines) {
      const [iface, rest] = line.split(':');
      if (!rest) continue;
      const name = iface.trim();
      if (name === 'lo') continue; // skip loopback — not real network traffic
      const fields = rest.trim().split(/\s+/).map(Number);
      rxTotal += fields[0] || 0; // bytes received
      txTotal += fields[8] || 0; // bytes transmitted
    }

    const now = Date.now();
    if (!_prevNet) {
      _prevNet = { rxTotal, txTotal, ts: now };
      return { rxBytesPerSec: 0, txBytesPerSec: 0, rxTotal, txTotal };
    }

    const dt = (now - _prevNet.ts) / 1000;
    const rxRate = dt > 0 ? Math.max(0, (rxTotal - _prevNet.rxTotal) / dt) : 0;
    const txRate = dt > 0 ? Math.max(0, (txTotal - _prevNet.txTotal) / dt) : 0;
    _prevNet = { rxTotal, txTotal, ts: now };

    return { rxBytesPerSec: rxRate, txBytesPerSec: txRate, rxTotal, txTotal };
  } catch {
    return { rxBytesPerSec: 0, txBytesPerSec: 0, rxTotal: 0, txTotal: 0 };
  }
}

/** Android/Linux thermal zones — often present but sometimes permission-
 * restricted depending on the device. Returns null (not 0) when
 * unavailable, so the UI can tell "no sensor" apart from "0°C". */
function readTemperature() {
  try {
    const zonesDir = '/sys/class/thermal';
    if (!fs.existsSync(zonesDir)) return null;
    const zones = fs.readdirSync(zonesDir).filter((z) => z.startsWith('thermal_zone'));
    const readings = [];
    for (const zone of zones) {
      try {
        const raw = fs.readFileSync(path.join(zonesDir, zone, 'temp'), 'utf8').trim();
        const millideg = parseInt(raw, 10);
        if (!Number.isNaN(millideg) && millideg > 0) {
          // Some devices report plain °C already (small numbers like 45),
          // most report millidegrees (45000). Normalize.
          readings.push(millideg > 1000 ? millideg / 1000 : millideg);
        }
      } catch { /* this zone unreadable, try the next */ }
    }
    if (readings.length === 0) return null;
    return Math.max(...readings);
  } catch {
    return null;
  }
}

/**
 * Top 20 processos por CPU. O formato do `ps` varia bastante entre o
 * coreutils do Ubuntu-proot e o busybox/toybox do Termux, então tentamos
 * o formato explícito primeiro (que é estável) e caímos pro `ps aux`.
 */
const readProcessList = cached(5000, async () => {
  const explicit = await run('ps', ['-eo', 'pid,pcpu,pmem,comm']);
  if (explicit) {
    return explicit.trim().split('\n').slice(1)
      .map((line) => {
        const [pid, cpu, mem, ...name] = line.trim().split(/\s+/);
        return {
          pid: parseInt(pid, 10) || 0,
          cpu: parseFloat(cpu) || 0,
          mem: parseFloat(mem) || 0,
          name: name.join(' ') || '?',
        };
      })
      .filter((p) => p.pid > 0)
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 20);
  }

  const aux = await run('ps', ['aux']);
  if (!aux) return [];
  return aux.trim().split('\n').slice(1)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1], 10) || 0,
        cpu: parseFloat(parts[2]) || 0,
        mem: parseFloat(parts[3]) || 0,
        name: parts.slice(10).join(' ') || '?',
      };
    })
    .filter((p) => p.pid > 0)
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 20);
});

async function getSnapshot() {
  // Leituras de /proc são síncronas mas triviais (arquivos virtuais, sem
  // I/O de disco); só o disco precisa de processo externo, e vem do cache.
  return {
    cpu: readCpu(),
    mem: readMeminfo(),
    disk: await readDisk(),
    net: readNetwork(),
    temp: readTemperature(),
    uptime: readUptime(),
    ts: Date.now(),
  };
}

module.exports = { getSnapshot, readProcessList };
