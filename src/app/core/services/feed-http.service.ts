import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';

export interface FeedHttpResponse { status: number; body: string; finalUrl?: string; }

@Injectable({ providedIn: 'root' })
export class FeedHttpService {
  /** Native bridge seam, so tests don't depend on module mocking of @capacitor/core. */
  native = {
    isNative: (): boolean => Capacitor.isNativePlatform(),
    get: (options: Parameters<typeof CapacitorHttp.get>[0]) => CapacitorHttp.get(options),
  };

  async get(url: string): Promise<FeedHttpResponse> {
    const headers = {
      Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.1',
      // Plenty of feed servers reject the stock Java HttpURLConnection agent; present a normal mobile browser UA.
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    };
    if (this.native.isNative()) {
      const response = await this.native.get({ url, headers, responseType: 'text', connectTimeout: 15_000, readTimeout: 30_000 });
      return { status: response.status, finalUrl: response.url || url, body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data) };
    }
    const endpoint = new URL(environment.feedProxyUrl, window.location.origin);
    endpoint.searchParams.set('url', url);
    const response = await fetch(endpoint, { headers: { Accept: 'application/xml, text/xml, application/json' }, credentials: 'same-origin' });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error || `Feed proxy failed (${response.status})`);
    }
    return { status: response.status, body: await response.text(), finalUrl: response.headers.get('X-Feed-Final-Url') || url };
  }
}
