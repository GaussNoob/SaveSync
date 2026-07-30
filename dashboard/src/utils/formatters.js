const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

export function parseDate(value) {
  if (!value) return null;
  const input = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(input)
    ? input.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:\d{2}$/.test(input) ? '' : 'Z')
    : input;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function formatDateTime(value, fallback = 'Nunca') {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

export function formatRelativeTime(value, fallback = 'Nunca') {
  const date = parseDate(value);
  if (!date) return fallback;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relativeFormatter.format(seconds, 'second');
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(seconds / 3600), 'hour');
  if (abs < 604800) return relativeFormatter.format(Math.round(seconds / 86400), 'day');
  return formatDateTime(value, fallback);
}

export function formatBytes(input) {
  const value = Number(input || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** index);
  return (amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)) + ' ' + units[index];
}

export function platformLabel(value) {
  const labels = {
    steam: 'Steam',
    epic: 'Epic',
    gog: 'GOG',
    emulator: 'Emulador',
    retroarch: 'RetroArch',
    custom: 'Personalizado',
    pc: 'PC'
  };
  const key = String(value || 'pc').toLowerCase();
  return labels[key] || value || 'PC';
}
