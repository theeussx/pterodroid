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
  getService: (id) => request(`/services/${id}`),
  createService: (payload) => request('/services', { method: 'POST', body: payload }),
  updateService: (id, payload) => request(`/services/${id}`, { method: 'PUT', body: payload }),
  deleteService: (id, deleteFiles = false) => request(`/services/${id}${deleteFiles ? '?deleteFiles=true' : ''}`, { method: 'DELETE' }),
  startService: (id) => request(`/services/${id}/start`, { method: 'POST' }),
  stopService: (id) => request(`/services/${id}/stop`, { method: 'POST' }),
  restartService: (id) => request(`/services/${id}/restart`, { method: 'POST' }),
  sendServiceInput: (id, text) => request(`/services/${id}/input`, { method: 'POST', body: { text } }),
  serviceLogs: (id, limit = 200) => request(`/services/${id}/logs?limit=${limit}`),

  // databases
  listDatabases: () => request('/databases'),
  dbEngines: () => request('/databases/engines'),
  getDatabase: (id) => request(`/databases/${id}`),
  createDatabase: (payload) => request('/databases', { method: 'POST', body: payload }),
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
  completeSetup: () => request('/settings/complete-setup', { method: 'POST' }),
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

  // gerenciador de arquivos
  listFiles: (path = '') => request(`/files/list?path=${encodeURIComponent(path)}`),
  readFile: (path) => request(`/files/read?path=${encodeURIComponent(path)}`),
  writeFile: (path, content) => request('/files/write', { method: 'PUT', body: { path, content } }),
  mkdir: (path, name) => request('/files/mkdir', { method: 'POST', body: { path, name } }),
  touchFile: (path, name) => request('/files/touch', { method: 'POST', body: { path, name } }),
  renameFile: (path, name) => request('/files/rename', { method: 'POST', body: { path, name } }),
  moveFile: (source, destDir) => request('/files/move', { method: 'POST', body: { source, destDir } }),
  copyFile: (source, destDir) => request('/files/copy', { method: 'POST', body: { source, destDir } }),
  deleteFiles: (paths) => request('/files', { method: 'DELETE', body: { paths } }),
  searchFiles: (path, q) => request(`/files/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`),
  filesAudit: (limit = 50) => request(`/files/audit?limit=${limit}`),

  uploadFiles: async (dirPath, fileList, onProgress) => {
    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    const token = getToken();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(dirPath)}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data?.error || 'Upload falhou'));
        } catch {
          reject(new Error('Upload falhou'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload falhou (rede)'));
      xhr.send(formData);
    });
  },

  downloadFile: async (path, filename) => {
    const token = getToken();
    const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'Download falhou');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
