import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from './socket';

const HISTORY_LENGTH = 40;

/** Live system snapshot + a short rolling history, for the pulse strip / monitoring charts. */
export function useSystemSnapshot() {
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onSnapshot = (data) => {
      setSnapshot(data);
      setHistory((prev) => {
        const next = [...prev, data];
        return next.length > HISTORY_LENGTH ? next.slice(-HISTORY_LENGTH) : next;
      });
    };

    socket.on('monitor:snapshot', onSnapshot);
    return () => socket.off('monitor:snapshot', onSnapshot);
  }, []);

  return { snapshot, history };
}

/** Tracks the actual socket connection state — not cosmetic, reflects
 * whether live updates (logs, status, monitor snapshots) are really
 * flowing right now. */
export function useConnectionStatus() {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    setOnline(socket.connected);
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return online;
}
export function useServiceStatusEvents(onStatus) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('service:status', onStatus);
    socket.on('service:setup-status', onStatus);
    return () => {
      socket.off('service:status', onStatus);
      socket.off('service:setup-status', onStatus);
    };
  }, [onStatus]);
}

export function useServiceSetupEvents(serviceId, onStatus, onLog) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !serviceId) return undefined;
    const handleStatus = (payload) => {
      if (Number(payload?.serviceId) === Number(serviceId) && onStatus) {
        onStatus(payload);
      }
    };
    const handleLog = (payload) => {
      if (Number(payload?.serviceId) === Number(serviceId) && onLog) {
        onLog(payload);
      }
    };
    socket.on('service:setup-status', handleStatus);
    socket.on('service:setup-log', handleLog);
    return () => {
      socket.off('service:setup-status', handleStatus);
      socket.off('service:setup-log', handleLog);
    };
  }, [serviceId, onStatus, onLog]);
}

export function useDbStatusEvents(onStatus) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('db:status', onStatus);
    return () => socket.off('db:status', onStatus);
  }, [onStatus]);
}

/** Live-tailing log lines for one service/instance. Starts empty on each
 * id change; call seedOnce() once your historical-logs fetch resolves to
 * merge that backlog in ahead of anything already streamed live — safe to
 * call at any time, it only applies once per id. */
export function useLiveLogs(kind, id) {
  const [lines, setLines] = useState([]);
  const idRef = useRef(id);
  const seededRef = useRef(false);
  idRef.current = id;

  useEffect(() => {
    setLines([]);
    seededRef.current = false;
  }, [id]);

  const seedOnce = useCallback((seedLines) => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (seedLines?.length) setLines((prev) => [...seedLines, ...prev]);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !id) return;

    const eventName = kind === 'service' ? 'service:log' : 'db:log';
    const onLog = (payload) => {
      const matchId = kind === 'service' ? payload.serviceId : payload.instanceId;
      if (matchId !== idRef.current) return;
      setLines((prev) => {
        const next = [...prev, payload];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
    };

    socket.on(eventName, onLog);
    return () => socket.off(eventName, onLog);
  }, [kind, id]);

  const clear = useCallback(() => setLines([]), []);
  return { lines, seedOnce, clear };
}
