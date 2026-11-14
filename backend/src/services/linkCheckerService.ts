import { config } from '../config.js';
import { getExternalCache, setExternalCache } from '../db/repository.js';
import type { DeadLinkStatus } from '../types.js';
import { fetchWithRetry, limiters } from '../utils/rateLimiter.js';

export interface LinkHealthResult {
  url: string;
  status: DeadLinkStatus;
  httpStatusCode: number | null;
  archiveUrl: string | null;
}

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

interface WaybackResponse {
  archived_snapshots?: {
    closest?: {
      available?: boolean;
      url?: string;
    };
  };
}

async function lookupWaybackSnapshot(deadUrl: string): Promise<string | null> {
  try {
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(deadUrl)}`;
    const res = await fetchWithRetry(
      apiUrl,
      { headers: { 'User-Agent': config.wikimediaUserAgent } },
      { timeoutMs: 5000, maxRetries: 1, limiter: limiters.linkCheck }
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as WaybackResponse;
    const closest = payload.archived_snapshots?.closest;
    if (closest?.available && closest.url) {
      return closest.url.replace(/^http:\/\//i, 'https://');
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyExternalLinkHealth(url: string): Promise<LinkHealthResult> {
  if (!isSafePublicHttpUrl(url)) {
    return {
      url,
      status: 'unchecked',
      httpStatusCode: null,
      archiveUrl: null,
    };
  }

  const cached = await getExternalCache<LinkHealthResult>('link_check', url);
  if (cached) {
    return cached;
  }

  let httpCode: number | null = null;
  let isAlive = false;

  try {
    let res = await fetchWithRetry(
      url,
      {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': config.wikimediaUserAgent },
      },
      { timeoutMs: 5500, maxRetries: 1, limiter: limiters.linkCheck }
    );

    if (res.status === 405 || res.status === 403) {
      res = await fetchWithRetry(
        url,
        {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': config.wikimediaUserAgent,
            Range: 'bytes=0-1024',
          },
        },
        { timeoutMs: 5500, maxRetries: 0, limiter: limiters.linkCheck }
      );
    }

    httpCode = res.status;
    // Treat 2xx/3xx and anti-bot 403 on scholarly publishers (e.g., JSTOR/Elsevier) cautiously:
    // definite dead links are 404, 410, 500, 502, 504 or network DNS errors.
    isAlive = (res.status >= 200 && res.status < 400) || res.status === 403;
  } catch {
    isAlive = false;
  }

  let status: DeadLinkStatus = isAlive ? 'alive' : 'dead';
  let archiveUrl: string | null = null;

  if (!isAlive) {
    archiveUrl = await lookupWaybackSnapshot(url);
    if (archiveUrl) {
      status = 'archived_recovered';
    }
  }

  const result: LinkHealthResult = {
    url,
    status,
    httpStatusCode: httpCode,
    archiveUrl,
  };

  await setExternalCache('link_check', url, result, config.apiCacheTtlSeconds);
  return result;
}
