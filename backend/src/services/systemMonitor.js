/**
 * SystemMonitor — lightweight resource polling.
 * Reads /proc directly. Works in Termux (proot Linux kernel exposes /proc)
 * and in Ubuntu-proot. No native/npm dependency needed.
 */
const fs = require('fs');
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
    uptime: readUptime(),
    ts: Date.now(),
  };
}

module.exports = { getSnapshot, readProcessList };
