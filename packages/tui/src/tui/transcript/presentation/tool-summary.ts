import { sanitizeTerminalText } from '../../rendering/terminal-text.js';

const SUMMARY_KEYS = [
  'path',
  'filePath',
  'file_path',
  'command',
  'query',
  'pattern',
  'url',
  'description',
  'domain',
  'host',
  'endpoint',
  'uri',
  'notes',
  'instruction',
  'prompt',
  'message',
] as const;

const METADATA_KEYS = ['target', 'operation', 'action', 'name'] as const;

export function formatTuiToolSummary(value: string): string {
  const sanitized = sanitizeTerminalText(value).trim();
  if (!sanitized) return '';
  try {
    const parsed = JSON.parse(sanitized) as unknown;
    if (typeof parsed === 'string') return firstLine(parsed);
    if (isRecord(parsed)) {
      const agentName = parsed.agent_name;
      const description = parsed.description;
      if (
        typeof agentName === 'string' &&
        agentName.trim() &&
        typeof description === 'string' &&
        description.trim()
      ) {
        return `${firstLine(agentName)} · ${firstLine(description)}`;
      }

      // Network / Pentest probe: HTTP transport
      if (isRecord(parsed.http)) {
        const method =
          typeof parsed.http.method === 'string' && parsed.http.method.trim()
            ? parsed.http.method.trim().toUpperCase()
            : 'GET';
        const url = typeof parsed.http.url === 'string' ? parsed.http.url.trim() : '';
        const notes = typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '';
        if (url) {
          return notes ? `${method} ${firstLine(url)} · ${firstLine(notes)}` : `${method} ${firstLine(url)}`;
        }
      }
      // Network / Pentest probe: TCP transport
      if (isRecord(parsed.tcp)) {
        const host = typeof parsed.tcp.host === 'string' ? parsed.tcp.host.trim() : '';
        const port = parsed.tcp.port ? String(parsed.tcp.port) : '';
        const target = host && port ? `${host}:${port}` : host || port;
        const notes = typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '';
        if (target) {
          return notes ? `tcp://${firstLine(target)} · ${firstLine(notes)}` : `tcp://${firstLine(target)}`;
        }
      }
      // Network / Pentest probe: DNS transport
      if (isRecord(parsed.dns)) {
        const host = typeof parsed.dns.host === 'string' ? parsed.dns.host.trim() : '';
        const type = typeof parsed.dns.recordType === 'string' ? parsed.dns.recordType.trim() : 'A';
        const notes = typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '';
        if (host) {
          return notes ? `DNS ${type} ${firstLine(host)} · ${firstLine(notes)}` : `DNS ${type} ${firstLine(host)}`;
        }
      }
      // Network / Pentest probe: TLS transport
      if (isRecord(parsed.tls)) {
        const host = typeof parsed.tls.host === 'string' ? parsed.tls.host.trim() : '';
        const port = parsed.tls.port ? String(parsed.tls.port) : '443';
        const notes = typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '';
        if (host) {
          return notes ? `TLS ${firstLine(host)}:${port} · ${firstLine(notes)}` : `TLS ${firstLine(host)}:${port}`;
        }
      }

      // General HTTP / Web fetch tool
      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        const method =
          typeof parsed.method === 'string' && parsed.method.trim()
            ? `${parsed.method.trim().toUpperCase()} `
            : '';
        return `${method}${firstLine(parsed.url)}`;
      }

      // Endpoint / URI
      if (typeof parsed.endpoint === 'string' && parsed.endpoint.trim()) {
        return firstLine(parsed.endpoint);
      }
      if (typeof parsed.uri === 'string' && parsed.uri.trim()) {
        return firstLine(parsed.uri);
      }

      const scope = [parsed.path, parsed.filePath, parsed.file_path, parsed.cwd].find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && Boolean(candidate.trim()),
      );
      const query = [parsed.query, parsed.pattern].find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && Boolean(candidate.trim()),
      );
      if (typeof parsed.command === 'string' && parsed.command.trim()) {
        if (typeof description === 'string' && description.trim()) return firstLine(description);
        const command = firstLine(parsed.command);
        return scope ? `${command} · in ${firstLine(scope)}` : command;
      }
      if (query) return scope ? `${firstLine(query)} in ${firstLine(scope)}` : firstLine(query);
      for (const key of SUMMARY_KEYS) {
        const candidate = parsed[key];
        if (typeof candidate === 'string' && candidate.trim()) {
          return firstLine(candidate);
        }
        if (
          Array.isArray(candidate) &&
          candidate.length > 0 &&
          candidate.every((item) => typeof item === 'string')
        ) {
          return candidate.map(firstLine).filter(Boolean).join(' ');
        }
      }
      const metadata = METADATA_KEYS.flatMap((key) => {
        const candidate = parsed[key];
        return typeof candidate === 'string' && candidate.trim() ? [firstLine(candidate)] : [];
      });
      if (metadata.length > 0) {
        return metadata.slice(0, 2).join(' · ');
      }

      // Generic fallback: format key=value parameters so tool arguments are never completely omitted
      const entries = Object.entries(parsed).filter(
        ([k, v]) =>
          v !== undefined &&
          v !== null &&
          (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') &&
          k !== 'tool' &&
          k !== 'tool_name',
      );
      if (entries.length > 0) {
        return entries
          .slice(0, 3)
          .map(([k, v]) => `${k}=${firstLine(String(v))}`)
          .join(' · ');
      }
    }
    if (Array.isArray(parsed)) return `${parsed.length} item${parsed.length === 1 ? '' : 's'}`;
  } catch {
    return firstLine(sanitized);
  }
  return '';
}

function firstLine(value: string): string {
  return (
    sanitizeTerminalText(value)
      .split(/\r\n?|\n/u, 1)[0]
      ?.trim() ?? ''
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
