'use strict';
/**
 * Leitor/escritor mínimo de tar (formato ustar). Usado só pelo
 * dockerFileManager, pra transportar UM arquivo de cada vez através do
 * endpoint /containers/{id}/archive do Docker — não é um tar completo
 * (sem hardlinks, sem formato GNU, sem nome > 255 bytes via prefix) — só
 * o suficiente pra ler/escrever/baixar/enviar um arquivo por vez, que é
 * tudo que o gerenciador de arquivos do painel precisa.
 */

function writeOctal(buf, num, offset, len) {
  buf.write(Math.max(0, Math.floor(num)).toString(8).padStart(len - 1, '0'), offset, len - 1, 'ascii');
  buf[offset + len - 1] = 0;
}

function readStr(block, offset, len) {
  let end = offset;
  while (end < offset + len && block[end] !== 0) end += 1;
  return block.toString('utf8', offset, end);
}

function readOctal(block, offset, len) {
  const str = readStr(block, offset, len).trim();
  return str ? parseInt(str, 8) : 0;
}

function buildHeader({ name, size, mtimeMs, typeflag = '0' }) {
  const buf = Buffer.alloc(512, 0);
  buf.write(name.slice(0, 100), 0, 100, 'utf8');
  writeOctal(buf, 0o644, 100, 8);
  writeOctal(buf, 0, 108, 8);
  writeOctal(buf, 0, 116, 8);
  writeOctal(buf, size, 124, 12);
  writeOctal(buf, Math.floor(mtimeMs / 1000), 136, 12);
  buf.write('        ', 148, 8, 'ascii'); // checksum: calculado com o próprio campo em branco (8 espaços)
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += buf[i];
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return buf;
}

/** Monta um tar com um único arquivo — pronto pra mandar em putArchive(). */
function buildSingleFileTar(name, content, mtimeMs = Date.now()) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '', 'utf8');
  const header = buildHeader({ name, size: buf.length, mtimeMs, typeflag: '0' });
  const padLen = (512 - (buf.length % 512)) % 512;
  const endMarker = Buffer.alloc(1024, 0); // duas blocos de 512 zeros marcam o fim do arquivo
  return Buffer.concat([header, buf, Buffer.alloc(padLen, 0), endMarker]);
}

/** Lê todas as entradas de um buffer tar — o que getArchive() devolve. */
function parseTar(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const block = buffer.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) { offset += 512; continue; }

    const name = readStr(block, 0, 100);
    if (!name) { offset += 512; continue; }
    const prefix = readStr(block, 345, 155);
    const size = readOctal(block, 124, 12);
    const mtime = readOctal(block, 136, 12) * 1000;
    const typeflag = String.fromCharCode(block[156] || 0);

    offset += 512;
    const content = buffer.subarray(offset, offset + size);
    entries.push({ name: prefix ? `${prefix}/${name}` : name, size, mtime, typeflag, content });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

module.exports = { buildSingleFileTar, parseTar };
