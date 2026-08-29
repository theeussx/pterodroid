const TOKEN_KEY = 'pterodroid_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request('/auth/me'),
  changePassword: (current, next) => request('/auth/change-password', { method: 'POST', body: { current, next } }),

  // services
  listServices: () => request('/services'),
  listServiceRecipes: () => request('/services/recipes'),
  getService: (id) => request(`/services/${id}`),
  createService: (payload) => request('/services', { method: 'POST', body: payload }),
  updateService: (id, payload) => request(`/services/${id}`, { method: 'PUT', body: payload }),
  deleteService: (id, deleteFiles = false) => request(`/services/${id}${deleteFiles ? '?deleteFiles=true' : ''}`, { method: 'DELETE' }),
  startService: (id) => request(`/services/${id}/start`, { method: 'POST' }),
  stopService: (id) => request(`/services/${id}/stop`, { method: 'POST' }),
  restartService: (id) => request(`/services/${id}/restart`, { method: 'POST' }),
  sendServiceInput: (id, text) => request(`/services/${id}/input`, { method: 'POST', body: { text } }),
  serviceLogs: (id, limit = 200) => request(`/services/${id}/logs?limit=${limit}`),
  serviceDiskUsage: (id) => request(`/services/${id}/disk-usage`),
  serviceSetup: (id) => request(`/services/${id}/setup`),
  runServiceSetup: (id, { auto_start = true } = {}) =>
    request(`/services/${id}/setup`, { method: 'POST', body: { auto_start } }),

  // docker
  listDockerHosts: () => request('/docker/hosts'),
  createDockerHost: (payload) => request('/docker/hosts', { method: 'POST', body: payload }),
  deleteDockerHost: (id) => request(`/docker/hosts/${id}`, { method: 'DELETE' }),
  pingDockerHost: (id) => request(`/docker/hosts/${id}/ping`, { method: 'POST' }),
  listHostContainers: (id) => request(`/docker/hosts/${id}/containers`),
  listHostImages: (id) => request(`/docker/hosts/${id}/images`),
  listHostVolumes: (id) => request(`/docker/hosts/${id}/volumes`),
  listHostNetworks: (id) => request(`/docker/hosts/${id}/networks`),

  // databases
  listDatabases: () => request('/databases'),
  dbEngines: () => request('/databases/engines'),
  getDatabase: (id) => request(`/databases/${id}`),
  createDatabase: (payload) => request('/databases', { method: 'POST', body: payload }),
  updateDatabase: (id, payload) => request(`/databases/${id}`, { method: 'PUT', body: payload }),
  deleteDatabase: (id) => request(`/databases/${id}`, { method: 'DELETE' }),
  startDatabase: (id) => request(`/databases/${id}/start`, { method: 'POST' }),
  stopDatabase: (id) => request(`/databases/${id}/stop`, { method: 'POST' }),
  restartDatabase: (id) => request(`/databases/${id}/restart`, { method: 'POST' }),
  databaseLogs: (id, limit = 200) => request(`/databases/${id}/logs?limit=${limit}`),

  // monitor
  overview: () => request('/monitor/overview'),
  snapshot: () => request('/monitor/snapshot'),
  processes: () => request('/monitor/processes'),

  // settings
  getSettings: () => request('/settings'),
  updateSettings: (payload) => request('/settings', { method: 'PUT', body: payload }),
  testAlertWebhook: () => request('/settings/alert/test', { method: 'POST' }),
  cloudflaredStatus: () => request('/settings/cloudflared'),
  remoteAccessStatus: () => request('/settings/remote-access'),
  startRemoteAccess: () => request('/settings/remote-access/start', { method: 'POST' }),
  stopRemoteAccess: () => request('/settings/remote-access/stop', { method: 'POST' }),

  // domínio personalizado (named tunnel)
  domainsStatus: () => request('/settings/domains'),
  updateDomains: (payload) => request('/settings/domains', { method: 'PUT', body: payload }),
  createNamedTunnel: (name) => request('/settings/domains/tunnel', { method: 'POST', body: { name } }),
  applyDomains: () => request('/settings/domains/apply', { method: 'POST' }),
  startTokenTunnel: (token) => request('/settings/domains/token', { method: 'POST', body: { token } }),
  stopDomains: () => request('/settings/domains/stop', { method: 'POST' }),

  // ── Gerenciador de arquivos ──────────────────────────────────────────
  // O backend expõe exatamente as mesmas rotas para o escopo global e para
  // o escopo de um serviço (mesma fábrica de rotas), então aqui só muda o
  // prefixo. Um único `fileApi(prefix)` serve os dois — é o que impede as
  // duas telas de voltarem a divergir em funcionalidade.
  files: fileApi(''),
  serviceFiles: (id) => fileApi(`/services/${id}`),
  filesAudit: (limit = 50) => request(`/files/audit?limit=${limit}`),

  // ── Terminal do serviço ──────────────────────────────────────────────
  // Só o controle da sessão passa por aqui; a SAÍDA chega por socket
  // (evento `terminal:data`), para o comando ir imprimindo enquanto roda.
  terminal: {
    list: (id) => request(`/services/${id}/terminal`),
    open: (id) => request(`/services/${id}/terminal`, { method: 'POST' }),
    state: (id, sessionId) => request(`/services/${id}/terminal/${sessionId}`),
    exec: (id, sessionId, command) =>
      request(`/services/${id}/terminal/${sessionId}/exec`, { method: 'POST', body: { command } }),
    interrupt: (id, sessionId) =>
      request(`/services/${id}/terminal/${sessionId}/interrupt`, { method: 'POST' }),
    close: (id, sessionId) => request(`/services/${id}/terminal/${sessionId}`, { method: 'DELETE' }),
  },

  // ── Backups por serviço ───────────────────────────────────────────────
  backups: {
    list: (serviceId) => request(`/services/${serviceId}/backups`),
    create: (serviceId, name) => request(`/services/${serviceId}/backups`, { method: 'POST', body: { name } }),
    restore: (serviceId, backupId) => request(`/services/${serviceId}/backups/${backupId}/restore`, { method: 'POST' }),
    remove: (serviceId, backupId) => request(`/services/${serviceId}/backups/${backupId}`, { method: 'DELETE' }),
    download: (serviceId, backupId, filename) =>
      downloadFrom(`/api/services/${serviceId}/backups/${backupId}/download`, filename),
  },
};

/**
 * Conjunto completo de operações de arquivo para um prefixo de rota.
 * Os nomes são os mesmos nos dois escopos, então o FileBrowser recebe isto
 * como "adapter" e não precisa saber em qual escopo está.
 */
function fileApi(prefix) {
  const base = `${prefix}/files`;
  return {
    list: (path = '') => request(`${base}/list?path=${encodeURIComponent(path)}`),
    read: (path) => request(`${base}/read?path=${encodeURIComponent(path)}`),
    write: (path, content) => request(`${base}/write`, { method: 'PUT', body: { path, content } }),
    mkdir: (path, name) => request(`${base}/mkdir`, { method: 'POST', body: { path, name } }),
    touch: (path, name) => request(`${base}/touch`, { method: 'POST', body: { path, name } }),
    rename: (path, name) => request(`${base}/rename`, { method: 'POST', body: { path, name } }),
    move: (source, destDir) => request(`${base}/move`, { method: 'POST', body: { source, destDir } }),
    copy: (source, destDir) => request(`${base}/copy`, { method: 'POST', body: { source, destDir } }),
    remove: (paths) => request(base, { method: 'DELETE', body: { paths: [].concat(paths) } }),
    search: (path, q) => request(`${base}/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`),
    upload: (dirPath, fileList, onProgress) =>
      uploadTo(`/api${base}/upload?path=${encodeURIComponent(dirPath)}`, fileList, onProgress),
    download: (filePath, filename) =>
      downloadFrom(`/api${base}/download?path=${encodeURIComponent(filePath)}`, filename),
    // Compactar / descompactar. A saída do compress é um arquivo novo na
    // mesma pasta; o extract devolve o que foi (e o que não foi) extraído.
    compress: (paths, name) => request(`${base}/compress`, { method: 'POST', body: { paths, name } }),
    peekArchive: (filePath) => request(`${base}/archive/peek?path=${encodeURIComponent(filePath)}`),
    extract: (filePath, destDir, overwrite = false) =>
      request(`${base}/extract`, { method: 'POST', body: { path: filePath, destDir, overwrite } }),
  };
}

/** Upload com progresso — XHR porque fetch() ainda não reporta progresso de envio. */
function uploadTo(url, fileList, onProgress) {
  const formData = new FormData();
  for (const f of fileList) formData.append('files', f);
  const token = getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* resposta não-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        // Upload parcial ainda é sucesso HTTP; o chamador precisa saber
        // que alguns arquivos falharam.
        if (data?.errors?.length) reject(new Error(data.errors[0].error || 'Alguns arquivos falharam'));
        else resolve(data);
      } else {
        reject(new Error(data?.error || `Upload falhou (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload falhou — verifique a conexão'));
    xhr.ontimeout = () => reject(new Error('Upload demorou demais'));
    xhr.send(formData);
  });
}

async function downloadFrom(url, filename) {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Download falhou (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar imediatamente cancela o download em alguns navegadores móveis.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}