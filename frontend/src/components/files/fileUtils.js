import {
  FileText, FileCode2, FileJson, FileImage, FileArchive, FileAudio, FileVideo,
  File as FileIcon, Folder, FileCog,
} from 'lucide-react';

const EDITABLE_EXT = new Set([
  'txt', 'md', 'json', 'yml', 'yaml', 'env', 'js', 'jsx', 'ts', 'tsx',
  'py', 'sh', 'bash', 'css', 'html', 'xml', 'toml', 'ini', 'conf',
  'log', 'gitignore', 'cfg', 'sql', 'csv',
]);

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);
const CODE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'bash', 'c', 'cpp', 'java', 'go', 'rs', 'php']);
const CONFIG_EXT = new Set(['env', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg']);

export function isEditable(ext) {
  return EDITABLE_EXT.has((ext || '').toLowerCase());
}

export function iconFor(entry) {
  if (entry.type === 'dir') return Folder;
  const ext = (entry.ext || '').toLowerCase();
  if (ext === 'json') return FileJson;
  if (CONFIG_EXT.has(ext)) return FileCog;
  if (CODE_EXT.has(ext)) return FileCode2;
  if (IMAGE_EXT.has(ext)) return FileImage;
  if (ARCHIVE_EXT.has(ext)) return FileArchive;
  if (AUDIO_EXT.has(ext)) return FileAudio;
  if (VIDEO_EXT.has(ext)) return FileVideo;
  if (ext === 'md' || ext === 'txt') return FileText;
  return FileIcon;
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ms) {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function joinPath(...parts) {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join('/').replace(/\/+/g, '/');
}

export function parentPath(p) {
  if (!p || p === '.') return '';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}
