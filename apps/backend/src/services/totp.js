'use strict';
/**
 * totp — autenticação em duas etapas (TOTP, RFC 6238) sem dependências.
 *
 * POR QUE IMPLEMENTAR AQUI E NÃO PUXAR UMA LIB
 * ────────────────────────────────────────────
 * O algoritmo inteiro é uma HMAC-SHA1 sobre um contador de 30s — umas 40
 * linhas. Uma dependência a menos é uma cadeia de suprimento a menos num
 * painel feito para rodar leve até em Termux (e que já carrega o mínimo
 * necessário bcryptjs/jsonwebtoken).
 *
 * COMPATÍVEL COM
 * ──────────────
 * Google Authenticator, Aegis, Bitwarden, 1Password etc. — qualquer app
 * que aceite URI `otpauth://totp/...` ou chave em Base32.
 *
 * CÓDIGOS DE RECUPERAÇÃO
 * ──────────────────────
 * O painel gera códigos de uso único (RFC bemp prática): quem perde o
 * celular não fica trancado para sempre do próprio painel. No banco ficam
 * apenas hashes SHA-256 — o código vale uma vez e some.
 */
const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Segredo novo: 160 bits (tamanho recomendado pelo RFC 4226) em Base32. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** TOTP no instante dado (usado nos testes para computar o código esperado). */
function totpAt(secret, timeMs = Date.now(), stepSec = 30) {
  return hotp(base32Decode(secret), Math.floor(timeMs / 1000 / stepSec));
}

/**
 * Verifica um código com tolerância de ±1 janela de 30s (relógios de
 * celular driftam). Comparação em tempo constante para não vazar quantos
 * dígitos bateram — relevante porque o código tem só 1e6 possibilidades.
 */
function verify(secret, token, { window = 1 } = {}) {
  const clean = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const secretBuf = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const expected = [...Array(window * 2 + 1).keys()]
    .map((i) => hotp(secretBuf, counter + i - window));
  const a = Buffer.from(clean.padEnd(6));
  return expected.some((code) => code.length === clean.length
    && crypto.timingSafeEqual(Buffer.from(code), a));
}

/** URI padrão para parear o app autenticador (manualmente ou por QR). */
function otpauthUri({ secret, issuer = 'Pterodroid', account = 'admin' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

/** Códigos de recuperação de uso único, exibidos UMA vez na ativação. */
function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

/** Hash do código de recuperação (normalizado: sem espaço/hífen, maiúsculo). */
function hashRecoveryCode(code) {
  const normalized = String(code || '').replace(/[-\s]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

module.exports = {
  generateSecret,
  verify,
  totpAt,
  otpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
};
