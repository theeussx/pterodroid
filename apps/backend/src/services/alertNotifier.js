'use strict';
/**
 * alertNotifier — avisa o dono quando um serviço cai ou entra em crash-loop.
 *
 * Hoje o watchdog reinicia o serviço silenciosamente: se o painel estiver
 * fechado (ou o dono longe do celular), ninguém fica sabendo que uma API
 * caiu. Este módulo dispara um POST num webhook configurado (configuração:
 * settings `alert_webhook_url`) — funciona com Telegram Bot API, Discord
 * webhook, Slack, ntfy.sh, ou qualquer endpoint que aceite JSON.
 *
 * É "fire and forget": nunca derruba o painel nem bloqueia o restart por
 * causa de uma falha de notificação.
 */
const { getDB } = require('../db');

let inflight = new Map(); // serviceId -> cooldown até

const COOLDOWN_MS = 5 * 60 * 1000;

function webhookUrl() {
  const db = getDB();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'alert_webhook_url'").get();
  const url = (row?.value || '').trim();
  return url || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Envia uma notificação (fire-and-forget) para o webhook configurado.
 * @param {object} payload { serviceId?, name?, status?, reason?, detail?, at? }
 */
async function notify(payload) {
  const url = webhookUrl();
  if (!url) return { ok: false, skipped: true };

  const serviceId = payload.serviceId;
  // Cooldown por serviço: evita spam em crash-loops (um alerta a cada 5 min
  // é suficiente — quem está atento já sabe que o serviço está travado).
  const now = Date.now();
  const until = inflight.get(serviceId);
  if (until && now < until) return { ok: false, skipped: true };
  inflight.set(serviceId, now + COOLDOWN_MS);

  const body = {
    text: payload.text || null,
    title: payload.title || 'Pterodroid',
    message: payload.message || payload.text || '',
    ...payload,
    ts: new Date().toISOString(),
  };
  delete body.text;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    timer.unref?.();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`[alert] falha ao notificar webhook (serviço ${serviceId}): ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/** Aviso de serviço caiu (crash) e vai ser reiniciado. */
async function onCrash({ serviceId, name, reason }) {
  await notify({
    serviceId,
    name,
    status: 'error',
    reason,
    title: '⚠️ Serviço caiu (reinicio automático)',
    message: `O serviço "${name}" caiu (${reason || 'código de saída != 0'}). O Pterodroid vai tentar reiniciar.`,
  });
}

/** Aviso de crash-loop (esgotou as tentativas de reinício). */
async function onCrashLoop({ serviceId, name, restarts }) {
  await notify({
    serviceId,
    name,
    status: 'error',
    reason: 'max_restarts_exceeded',
    title: '🚨 Serviço em crash-loop',
    message: `O serviço "${name}" falhou e esgotou ${restarts} tentativas de reinício. Verifique os logs.`,
  });
}

/** Aviso de que o painel subiu (opcional, útil pra monitorar reinício do painel). */
async function onBoot() {
  await notify({
    serviceId: 'panel',
    name: 'Pterodroid',
    status: 'started',
    title: '🟢 Pterodroid iniciou',
    message: 'O painel Pterodroid foi iniciado.',
  });
}

module.exports = { notify, onCrash, onCrashLoop, onBoot, webhookUrl };
