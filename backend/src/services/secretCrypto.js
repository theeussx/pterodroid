'use strict';
/**
 * secretCrypto — encriptação autenticada de credenciais em repouso e
 * ofuscação de segredos em logs (Etapa 5).
 *
 * Utiliza o secret nativo do painel (JWT_SECRET) para gerar uma chave
 * AES-256-GCM. Tokens pré-existentes gravados em texto puro continuam
 * funcionando sem quebrar, mas novas gravações são encriptadas.
 */
const crypto = require('crypto');
const config = require('../config');

const PREFIX = 'enc:v1:';

function getEncryptionKey() {
  const secret = config.JWT_SECRET || 'default_secret_key_pterodroid';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Criptografa um texto em AES-256-GCM com IV aleatório.
 * Retorna no formato `enc:v1:iv:authTag:encrypted`.
 */
function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const str = String(plaintext);
  if (str.startsWith(PREFIX)) return str; // já encriptado
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    console.error('[secretCrypto] Erro ao criptografar segredo:', err.message);
    return str;
  }
}

/**
 * Descriptografa um texto no formato `enc:v1:...`.
 * Caso seja texto puro legado (sem o prefixo), retorna o próprio texto.
 */
function decryptSecret(ciphertext) {
  if (ciphertext === null || ciphertext === undefined || ciphertext === '') return null;
  const str = String(ciphertext);
  if (!str.startsWith(PREFIX)) return str; // texto puro legado
  try {
    const parts = str.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[secretCrypto] Erro ao descriptografar segredo:', err.message);
    return null;
  }
}

/**
 * Ofusca tokens, senhas em URLs do tipo `https://user:pass@host` e
 * quaisquer segredos literais fornecidos no array `secrets`.
 */
function maskSecrets(text, secrets = []) {
  if (text === null || text === undefined) return '';
  let str = String(text);
  // Ofusca URLs com credenciais embedded: https://user:pass@host -> https://***@host
  str = str.replace(/https?:\/\/[^@/]+@/gi, 'https://***@');
  // Ofusca segredos explícitos
  for (const s of secrets) {
    if (!s) continue;
    const raw = decryptSecret(s) || s;
    if (typeof raw === 'string' && raw.length >= 3) {
      str = str.split(raw).join('***');
    }
  }
  return str;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  maskSecrets,
};
