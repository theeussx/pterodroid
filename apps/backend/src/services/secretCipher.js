'use strict';
/**
 * secretCipher — cifra segredos em repouso no SQLite.
 *
 * Tokens de Git, variáveis de ambiente (que podem guardar chaves de API,
 * senhas de banco, tokens de bot) e alertas são informações sensíveis que
 * hoje ficam em texto claro no panel.db. Para um painel pessoal o risco é
 * baixo, mas se o arquivo do banco vazar — num backup, num compartilhamento
 * acidental, num upload pro GitHub — os segredos vão junto.
 *
 * Abordagem:
 *  - AES-256-GCM (autenticado: qualquer adulteração do ciphertext é
 *    detectada e rejeitada).
 *  - A chave é derivada de JWT_SECRET via HKDF/SHA-256, então quem tem o
 *    .jwt-secret / JWT_SECRET consegue decifrar — e trocar a secret
 *    invalida os segredos antigos (re-sete-os após trocar).
 *  - Formato em repouso: "enc:v1:<iv-hex>:<tag-hex>:<ciphertext-hex>".
 *    Valores que não começam com "enc:" são tratados como texto claro
 *    legado (instalações que já existiam) e retornados como estão — assim
 *    este recurso não quebra bancos antigos.
 */
const crypto = require('crypto');
const config = require('../config');

const PREFIX = 'enc:v1:';

function deriveKey(secret) {
  // SHA-256 para chegar aos 32 bytes que o AES-256-GCM pede.
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest();
}

/** Cifra um valor sensível. Valores vazios/undefined voltam vazios. */
function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const key = deriveKey(config.JWT_SECRET);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Decifra um valor. Texto claro legado volta como está; erro de integridade volta o original (melhor não derrubar nada). */
function decrypt(stored) {
  if (!stored || typeof stored !== 'string') return stored;
  if (!stored.startsWith(PREFIX)) return stored; // legado / não cifrado
  try {
    const [, , ivHex, tagHex, dataHex] = stored.split(':');
    const key = deriveKey(config.JWT_SECRET);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // Integridade falhou (secret trocada ou dado corrompido). Devolver o
    // valor original evita derrubar o serviço; o usuário re-seteia o segredo.
    return stored;
  }
}

/** true se o valor está cifrado por nós. */
function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
