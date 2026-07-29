'use strict';
/**
 * loginThrottle — freio contra força bruta no login.
 *
 * POR QUE ISSO IMPORTA AQUI, E MAIS DO QUE ANTES
 * ──────────────────────────────────────────────
 * Medido neste próprio projeto antes de escrever este arquivo: ~12
 * tentativas de senha por segundo (~45 mil por hora), sem nenhum limite.
 * O painel é feito para ser exposto à internet por Cloudflare Tunnel e
 * agora tem um terminal embutido — ou seja, adivinhar a senha deixou de
 * significar "mexer nos serviços" e passou a significar **execução de
 * comandos no dispositivo**. Um limite de tentativas é o mínimo.
 *
 * DECISÕES
 * ────────
 *  - **Em memória, sem dependência.** Um painel pessoal tem um usuário; um
 *    Map com limpeza periódica resolve. Trazer Redis para isso contrariaria
 *    a proposta de leveza (e o compose já teve um Redis inútil removido).
 *  - **Atraso progressivo antes de bloquear.** As primeiras tentativas
 *    erradas passam sem punição (todo mundo erra a senha), depois cada
 *    falha custa mais tempo, e só então vem o bloqueio temporário. Isso
 *    atrapalha o atacante muito mais do que o dono do painel.
 *  - **Chave por IP + usuário.** Bloquear só por usuário deixaria alguém
 *    de fora trancar o dono do painel de propósito (negação de serviço);
 *    só por IP deixaria escapar tentativa distribuída no mesmo IP.
 *  - **Sucesso limpa o histórico.** Quem acertou a senha prova que é o
 *    dono; não faz sentido continuar punindo.
 */

const FREE_ATTEMPTS = 3;          // erros sem punição — todo mundo erra a senha
const DELAY_STEP_MS = 400;        // atraso somado por erro acima da franquia
const MAX_DELAY_MS = 5000;
const LOCK_AFTER = 8;             // erros consecutivos até o bloqueio
const LOCK_MS = 5 * 60 * 1000;    // duração do bloqueio
const WINDOW_MS = 15 * 60 * 1000; // sem erros nesse tempo, o histórico expira
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;         // teto de memória contra flood de IPs forjados

class LoginThrottle {
  constructor() {
    /** @type {Map<string, {fails:number, lockedUntil:number, lastAt:number}>} */
    this.entries = new Map();
    this._timer = null;
  }

  _ensureCleanup() {
    if (this._timer) return;
    this._timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this._timer.unref?.();
  }

  /**
   * IP do cliente. Atrás de um túnel/proxy tudo chega como 127.0.0.1, então
   * respeitamos os cabeçalhos de encaminhamento — mas SÓ quando o painel foi
   * configurado para confiar neles (TRUST_PROXY), senão qualquer um forjaria
   * um IP diferente a cada tentativa e escaparia do limite.
   */
  static clientKey(req, username) {
    const trustProxy = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';
    let ip = req.socket?.remoteAddress || 'desconhecido';
    if (trustProxy) {
      const fwd = req.headers['cf-connecting-ip']
        || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) ip = fwd;
    }
    return `${ip}|${String(username || '').toLowerCase()}`;
  }

  /** Estado atual da chave: pode tentar? por quanto tempo está travada? */
  check(key) {
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true, delayMs: 0, retryAfterSec: 0 };

    const now = Date.now();

    if (now - entry.lastAt > WINDOW_MS) {
      this.entries.delete(key);
      return { allowed: true, delayMs: 0, retryAfterSec: 0 };
    }

    if (entry.lockedUntil > now) {
      return {
        allowed: false,
        delayMs: 0,
        retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }

    const over = Math.max(0, entry.fails - FREE_ATTEMPTS);
    return { allowed: true, delayMs: Math.min(over * DELAY_STEP_MS, MAX_DELAY_MS), retryAfterSec: 0 };
  }

  /** Registra uma falha e devolve o estado resultante. */
  registerFailure(key) {
    if (this.entries.size >= MAX_ENTRIES) this.cleanup(true);
    this._ensureCleanup();

    const now = Date.now();
    const entry = this.entries.get(key) || { fails: 0, lockedUntil: 0, lastAt: now };
    // Histórico expirado conta como recomeço.
    if (now - entry.lastAt > WINDOW_MS) entry.fails = 0;

    entry.fails += 1;
    entry.lastAt = now;
    if (entry.fails >= LOCK_AFTER) {
      entry.lockedUntil = now + LOCK_MS;
      entry.fails = 0; // zera para o próximo ciclo começar limpo após o bloqueio
    }
    this.entries.set(key, entry);

    return {
      locked: entry.lockedUntil > now,
      lockedForSec: entry.lockedUntil > now ? Math.ceil(LOCK_MS / 1000) : 0,
      remaining: Math.max(0, LOCK_AFTER - entry.fails),
    };
  }

  /** Login bem-sucedido: quem acertou provou ser o dono. */
  registerSuccess(key) {
    this.entries.delete(key);
  }

  /** Remove entradas expiradas (ou as mais antigas, se estourar o teto). */
  cleanup(force = false) {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil < now && now - entry.lastAt > WINDOW_MS) this.entries.delete(key);
    }
    if (force && this.entries.size >= MAX_ENTRIES) {
      const oldest = [...this.entries.entries()]
        .sort((a, b) => a[1].lastAt - b[1].lastAt)
        .slice(0, Math.ceil(MAX_ENTRIES / 2));
      for (const [key] of oldest) this.entries.delete(key);
    }
  }

  /** Só para os testes: volta ao estado inicial. */
  reset() {
    this.entries.clear();
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}

const throttle = new LoginThrottle();

module.exports = throttle;
module.exports.LoginThrottle = LoginThrottle;
module.exports.LIMITS = { FREE_ATTEMPTS, LOCK_AFTER, LOCK_MS, WINDOW_MS, DELAY_STEP_MS, MAX_DELAY_MS };
