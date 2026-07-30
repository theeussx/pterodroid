'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Limites de segurança ────────────────────────────────────────────────
const MAX_ENTRIES = 20000;                       // nº de arquivos num pacote
const MAX_TOTAL_UNCOMPRESSED = 2 * 1024 * 1024 * 1024; // 2 GB extraídos
const MAX_SINGLE_FILE = 1 * 1024 * 1024 * 1024;  // 1 GB por arquivo
const MAX_COMPRESSION_RATIO = 1000;              // 1 KB virando 1 MB já é suspeito
const MAX_ARCHIVE_SOURCE_BYTES = 2 * 1024 * 1024 * 1024; // teto ao compactar

// ── Assinaturas do formato ZIP ──────────────────────────────────────────
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

class ArchiveError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Data/hora no formato MS-DOS que o ZIP usa. */
function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2))) & 0xffff,
    date: (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

function fromDosDateTime(dosDate, dosTime) {
  try {
    return new Date(
      ((dosDate >> 9) & 0x7f) + 1980,
      Math.max(0, ((dosDate >> 5) & 0x0f) - 1),
      Math.max(1, dosDate & 0x1f),
      (dosTime >> 11) & 0x1f,
      (dosTime >> 5) & 0x3f,
      (dosTime & 0x1f) * 2,
    ).getTime();
  } catch {
    return Date.now();
  }
}

// CRC-32, exigido pelo formato. Tabela criada uma vez.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Valida o nome de uma entrada do pacote e devolve o caminho relativo
 * seguro — ou lança. Esta é a defesa contra Zip Slip.
 */
function safeEntryName(rawName) {
  const name = String(rawName || '').replace(/\\/g, '/');

  if (!name || name === '/') throw new ArchiveError('O pacote contém uma entrada sem nome');
  if (name.includes('\0')) throw new ArchiveError('O pacote contém um nome de arquivo inválido');
  if (name.startsWith('/')) throw new ArchiveError(`Entrada com caminho absoluto recusada: ${name}`);
  if (/^[a-zA-Z]:/.test(name)) throw new ArchiveError(`Entrada com caminho absoluto recusada: ${name}`);

  // Normaliza resolvendo `.` e `..`; se ainda sobrar `..`, a entrada tenta
  // subir além da raiz — é exatamente o ataque Zip Slip.
  const parts = [];
  for (const segment of name.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) {
        throw new ArchiveError(`Entrada tentando escapar da pasta de destino: ${name}`);
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) throw new ArchiveError(`Entrada inválida: ${name}`);

  return parts.join('/');
}

/** Lê o índice central do ZIP — é ele que descreve o conteúdo de verdade. */
function readCentralDirectory(buf) {
  // O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele.
  const maxBack = Math.min(buf.length, 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ArchiveError('Arquivo .zip inválido ou corrompido');

  let entryCount = buf.readUInt16LE(eocd + 10);
  let centralSize = buf.readUInt32LE(eocd + 12);
  let centralOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: quando os campos de 32 bits estouram, os valores reais ficam
  // num registro separado antes do EOCD.
  if (centralOffset === 0xffffffff || entryCount === 0xffff || centralSize === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i -= 1) {
      if (buf.readUInt32LE(i) === SIG_EOCD64_LOCATOR) {
        const eocd64Offset = Number(buf.readBigUInt64LE(i + 8));
        if (eocd64Offset >= 0 && eocd64Offset < buf.length && buf.readUInt32LE(eocd64Offset) === SIG_EOCD64) {
          entryCount = Number(buf.readBigUInt64LE(eocd64Offset + 32));
          centralSize = Number(buf.readBigUInt64LE(eocd64Offset + 40));
          centralOffset = Number(buf.readBigUInt64LE(eocd64Offset + 48));
        }
        break;
      }
    }
  }

  if (entryCount > MAX_ENTRIES) {
    throw new ArchiveError(`O pacote tem entradas demais (${entryCount}); o limite é ${MAX_ENTRIES}`);
  }
  if (centralOffset + centralSize > buf.length) throw new ArchiveError('Arquivo .zip corrompido');

  const entries = [];
  let pos = centralOffset;
  for (let i = 0; i < entryCount && pos + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(pos) !== SIG_CENTRAL) break;

    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const dosTime = buf.readUInt16LE(pos + 12);
    const dosDate = buf.readUInt16LE(pos + 14);
    let compressedSize = buf.readUInt32LE(pos + 20);
    let uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttrs = buf.readUInt32LE(pos + 38);
    let localOffset = buf.readUInt32LE(pos + 42);

    const nameBuf = buf.subarray(pos + 46, pos + 46 + nameLen);
    // Bit 11 = nome já vem em UTF-8. Sem ele o padrão é CP437, mas UTF-8 é
    // o que praticamente todo compactador moderno grava.
    const rawName = nameBuf.toString('utf8');

    // Campo extra ZIP64 com os tamanhos/offset reais.
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let ep = pos + 46 + nameLen;
      const extraEnd = ep + extraLen;
      while (ep + 4 <= extraEnd) {
        const headerId = buf.readUInt16LE(ep);
        const size = buf.readUInt16LE(ep + 2);
        if (headerId === 0x0001) {
          let vp = ep + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(buf.readBigUInt64LE(vp)); vp += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(buf.readBigUInt64LE(vp)); vp += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(vp)); }
          break;
        }
        ep += 4 + size;
      }
    }

    // Bits altos dos atributos externos = modo Unix. 0xA000 = symlink.
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    const isSymlink = (unixMode & 0xf000) === 0xa000;
    const isDirectory = rawName.endsWith('/') || ((externalAttrs & 0x10) !== 0 && uncompressedSize === 0);

    entries.push({
      rawName,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory,
      isSymlink,
      mtime: fromDosDateTime(dosDate, dosTime),
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Extrai o conteúdo de uma entrada, a partir do cabeçalho local. */
function readEntryData(buf, entry) {
  const off = entry.localOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) {
    throw new ArchiveError(`Entrada corrompida no pacote: ${entry.rawName}`);
  }
  // O cabeçalho local pode ter tamanhos de campo diferentes do índice
  // central — os do local é que valem para localizar os dados.
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ArchiveError(`Entrada corrompida no pacote: ${entry.rawName}`);

  const raw = buf.subarray(start, end);
  if (entry.method === 0) return raw;                 // armazenado, sem compressão
  if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_SINGLE_FILE });
  throw new ArchiveError(`Método de compressão não suportado (${entry.method}) em: ${entry.rawName}`);
}

/**
 * Lista o conteúdo de um .zip sem extrair — para a UI poder mostrar o que
 * há dentro antes de o usuário confirmar.
 */
function inspectZip(buffer) {
  const entries = readCentralDirectory(buffer);
  let totalUncompressed = 0;
  const items = [];
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    items.push({
      name: entry.rawName,
      size: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      type: entry.isDirectory ? 'dir' : (entry.isSymlink ? 'symlink' : 'file'),
      mtime: entry.mtime,
    });
  }
  return { entries: items, count: items.length, totalUncompressed };
}

/**
 * Cria um .zip com os caminhos informados (arquivos e/ou pastas).
 * `fm` é o file manager do escopo — é ele que garante que nada fora da
 * raiz entre no pacote.
 */
function createZip(fm, relativePaths, { level = 6 } = {}) {
  const files = [];   // { nameInZip, absPath, stat }
  let totalBytes = 0;

  const addFile = (absPath, nameInZip, stat) => {
    if (files.length >= MAX_ENTRIES) {
      throw new ArchiveError(`Seleção grande demais (limite de ${MAX_ENTRIES} arquivos)`);
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_ARCHIVE_SOURCE_BYTES) {
      throw new ArchiveError('Seleção grande demais para compactar pelo painel');
    }
    files.push({ nameInZip, absPath, stat });
  };

  const walk = (absDir, prefix) => {
    let dirents;
    try { dirents = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    if (dirents.length === 0) {
      files.push({ nameInZip: `${prefix}/`, absPath: absDir, stat: null, isDir: true });
      return;
    }
    for (const dirent of dirents) {
      const abs = path.join(absDir, dirent.name);
      const nameInZip = `${prefix}/${dirent.name}`;
      // Symlink não é seguido: seguir poderia puxar para dentro do pacote
      // um arquivo de fora da raiz.
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) { walk(abs, nameInZip); continue; }
      if (!dirent.isFile()) continue;
      try { addFile(abs, nameInZip, fs.statSync(abs)); } catch { /* sumiu no meio */ }
    }
  };

  for (const relative of relativePaths) {
    const abs = fm.resolveSafePath(relative, { mustExist: true });
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) continue;
    const baseName = path.basename(abs);
    if (stat.isDirectory()) walk(abs, baseName);
    else if (stat.isFile()) addFile(abs, baseName, stat);
  }

  if (files.length === 0) throw new ArchiveError('Nada para compactar');

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const isDir = !!file.isDir;
    const nameBuf = Buffer.from(file.nameInZip, 'utf8');
    const content = isDir ? Buffer.alloc(0) : fs.readFileSync(file.absPath);
    const crc = isDir ? 0 : crc32(content);

    // Só comprime se valer a pena: arquivo já comprimido (jpg, zip, mp4)
    // costuma ficar maior ao passar pelo deflate.
    let method = 0;
    let payload = content;
    if (!isDir && content.length > 0) {
      const deflated = zlib.deflateRawSync(content, { level });
      if (deflated.length < content.length) { method = 8; payload = deflated; }
    }

    const { time, date } = toDosDateTime(new Date(file.stat?.mtimeMs || Date.now()));

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);              // versão necessária
    local.writeUInt16LE(0x0800, 6);          // bit 11: nome em UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);            // versão que criou
    central.writeUInt16LE(20, 6);            // versão necessária
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);            // extra
    central.writeUInt16LE(0, 32);            // comentário
    central.writeUInt16LE(0, 34);            // disco
    central.writeUInt16LE(0, 36);            // atributos internos
    // Atributos externos: 0755 para pasta, 0644 para arquivo.
    central.writeUInt32LE(isDir ? ((0o40755 << 16) >>> 0) | 0x10 : (0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

/**
 * Extrai um .zip dentro de `destRelative`.
 *
 * Toda escrita é conferida contra a raiz do file manager — mesmo que uma
 * entrada passe pela validação de nome, o caminho final é revalidado.
 */
function extractZip(fm, buffer, destRelative, { overwrite = false } = {}) {
  const destDir = fm.resolveSafePath(destRelative || '');
  fs.mkdirSync(destDir, { recursive: true });

  const root = fs.realpathSync(fm.root());
  const entries = readCentralDirectory(buffer);

  // Confere os totais ANTES de escrever qualquer coisa: uma "zip bomb"
  // não deve conseguir encher o disco até o meio da extração.
  let declaredTotal = 0;
  for (const entry of entries) declaredTotal += entry.uncompressedSize;
  if (declaredTotal > MAX_TOTAL_UNCOMPRESSED) {
    throw new ArchiveError(
      `O conteúdo descompactado teria ${Math.round(declaredTotal / 1048576)} MB, acima do limite de ${Math.round(MAX_TOTAL_UNCOMPRESSED / 1048576)} MB`,
    );
  }

  const written = [];
  const skipped = [];
  let extractedBytes = 0;

  for (const entry of entries) {
    if (entry.isSymlink) {
      // Um symlink extraído pode apontar para fora da raiz e virar um
      // atalho para escapar dela depois. Não vale o risco num painel.
      skipped.push({ name: entry.rawName, reason: 'link simbólico ignorado por segurança' });
      continue;
    }

    let safeName;
    try {
      safeName = safeEntryName(entry.rawName);
    } catch (err) {
      skipped.push({ name: entry.rawName, reason: err.message });
      continue;
    }

    const target = path.resolve(destDir, safeName);
    // Segunda checagem, agora sobre o caminho final resolvido: é a que
    // realmente garante que nada seja escrito fora da raiz.
    if (target !== root && !target.startsWith(root + path.sep)) {
      skipped.push({ name: entry.rawName, reason: 'caminho fora da área permitida' });
      continue;
    }

    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }

    if (entry.uncompressedSize > MAX_SINGLE_FILE) {
      skipped.push({ name: entry.rawName, reason: 'arquivo grande demais' });
      continue;
    }
    // Taxa de compressão absurda é a assinatura de uma zip bomb.
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO) {
      skipped.push({ name: entry.rawName, reason: 'taxa de compressão suspeita' });
      continue;
    }

    if (fs.existsSync(target) && !overwrite) {
      skipped.push({ name: safeName, reason: 'já existe (marque "substituir" para sobrescrever)' });
      continue;
    }

    let data;
    try {
      data = readEntryData(buffer, entry);
    } catch (err) {
      skipped.push({ name: entry.rawName, reason: err.message });
      continue;
    }

    extractedBytes += data.length;
    if (extractedBytes > MAX_TOTAL_UNCOMPRESSED) {
      throw new ArchiveError('Conteúdo descompactado excedeu o limite permitido');
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Escrita atômica, como no resto do painel: nada de arquivo pela
    // metade se a extração for interrompida.
    const tmp = `${target}.${process.pid}.part`;
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, target);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nada a limpar */ }
      skipped.push({ name: safeName, reason: err.message });
      continue;
    }
    written.push(safeName);
  }

  return { extracted: written.length, files: written.slice(0, 100), skipped };
}

/** É um arquivo que sabemos abrir? (a UI usa para decidir se mostra o botão) */
function isSupportedArchive(name) {
  return /\.zip$/i.test(String(name || ''));
}

module.exports = {
  createZip,
  extractZip,
  inspectZip,
  isSupportedArchive,
  safeEntryName,
  ArchiveError,
  LIMITS: { MAX_ENTRIES, MAX_TOTAL_UNCOMPRESSED, MAX_SINGLE_FILE, MAX_COMPRESSION_RATIO },
};