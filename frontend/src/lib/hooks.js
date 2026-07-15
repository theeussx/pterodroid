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

/** Subscribes to live status changes for services, keyed by serviceId. */
export function useServiceStatusEvents(onStatus) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('service:status', onStatus);
    return () => socket.off('service:status', onStatus);
  }, [onStatus]);
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
