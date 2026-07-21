/**
 * SystemMonitor — lightweight resource polling.
 * Reads /proc directly. Works in Termux (proot Linux kernel exposes /proc)
 * and in Ubuntu-proot. No native/npm dependency needed.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function readDisk() {
  try {
    const out = execSync('df -k /data 2>/dev/null || df -k / 2>/dev/null', {
      encoding: 'utf8', timeout: 3000,
    });
    const lines = out.trim().split('\n');
    const parts = lines[lines.length - 1].split(/\s+/);
    const total = (parseInt(parts[1], 10) || 0) * 1024;
    const used = (parseInt(parts[2], 10) || 0) * 1024;
    const free = (parseInt(parts[3], 10) || 0) * 1024;
    return { total, used, free, percent: total ? (used / total) * 100 : 0 };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

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

function readProcessList() {
  try {
    const out = execSync('ps aux 2>/dev/null || ps -eo pid,comm,%cpu,%mem 2>/dev/null', {
      encoding: 'utf8', timeout: 3000,
    });
    const lines = out.trim().split('\n');
    const header = lines[0].toLowerCase();
    const isBusyboxStyle = !header.includes('command');
    return lines
      .slice(1, 21)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (isBusyboxStyle) {
          return { pid: parseInt(parts[0], 10) || 0, cpu: parseFloat(parts[2]) || 0, mem: parseFloat(parts[3]) || 0, name: parts.slice(10).join(' ') || parts[1] || '?' };
        }
        return { pid: parseInt(parts[1], 10) || 0, cpu: parseFloat(parts[2]) || 0, mem: parseFloat(parts[3]) || 0, name: parts.slice(10).join(' ') || '?' };
      })
      .filter((p) => p.pid > 0)
      .sort((a, b) => b.cpu - a.cpu);
  } catch {
    return [];
  }
}

async function getSnapshot() {
  return {
    cpu: readCpu(),
    mem: readMeminfo(),
    disk: readDisk(),
    net: readNetwork(),
    temp: readTemperature(),
    uptime: readUptime(),
    ts: Date.now(),
  };
}

module.exports = { getSnapshot, readProcessList };
