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
