import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;

export function connectSocket() {
  if (socket?.connected) return socket;

  socket = io({
    auth: { token: getToken() },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function joinTerminal(sessionId) {
  const current = getSocket();
  if (!current) return Promise.resolve({ ok: false, error: 'socket unavailable' });
  return new Promise((resolve) => {
    current.emit('terminal:join', sessionId, (result) => resolve(result || { ok: false }));
  });
}

export function leaveTerminal(sessionId) {
  getSocket()?.emit('terminal:leave', sessionId);
}
