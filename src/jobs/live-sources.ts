import { Injectable } from '@nestjs/common';

export interface LiveJob {
  key: string; title: string; company: string; location: string;
  url: string; description: string; source: string;
}
export function trustedApplicationUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password &&
      (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.eu.lever.co'].includes(u.hostname) ||
       u.hostname === 'stripe.com' && /^\/careers\/apply\/[^/]+\/\d+\/?$/.test(u.pathname));
  } catch { return false; }
}

// Stripe's Greenhouse listings redirect to its own application form. Bind the
// numeric posting ID and board, never authorize arbitrary cross-domain redirects.
export function sameApplicationPage(first:string,second:string):boolean {
  try {
    if(!trustedApplicationUrl(first)||!trustedApplicationUrl(second))return false;
    const identity=(value:string)=>{const u=new URL(value);const stripe=u.hostname==='stripe.com'?u.pathname.match(/^\/careers\/apply\/[^/]+\/(\d+)\/?$/):['boards.greenhouse.io','job-boards.greenhouse.io'].includes(u.hostname)?u.pathname.match(/^\/stripe\/jobs\/(\d+)\/?$/):null;return stripe?'stripe:'+stripe[1]:u.origin+u.pathname.replace(/\/(apply|thanks|thank-you|confirmation)\/?$/,'').replace(/\/$/,'');};
    return identity(first)===identity(second);
  }catch{return false;}
}

@Injectable()
export class LiveSources {
  private cache: { until: number; jobs: LiveJob[]; warnings: string[] } | null = null;
  private pending: Promise<{ jobs: LiveJob[]; warnings: string[] }> | null = null;
  async discover() {
    if (this.cache && this.cache.until > Date.now()) return this.cache;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try { const data = await this.pending; this.cache = { ...data, until: Date.now() + 300000 }; return data; }
    finally { this.pending = null; }
  }
  private async load() {
    const boards = (process.env.JOB_BOARDS || 'greenhouse:cloudflare,greenhouse:stripe,greenhouse:airbnb').split(',').slice(0, 20);
    const warnings: string[] = [];
    const results = await Promise.all(boards.map(async entry => {
      const [provider, board] = entry.trim().split(':');
      if (!['greenhouse', 'lever'].includes(provider) || !/^[a-zA-Z0-9_-]+$/.test(board || '')) {
        warnings.push('Invalid job board configuration.'); return [];
      }
      try {
        const endpoint = provider === 'greenhouse'
          ? `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`
          : `https://api.lever.co/v0/postings/${board}?mode=json`;
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000), redirect: 'error' });
        if (!response.ok) throw new Error('Source unavailable');
        const payload = await response.json();
        const rows = provider === 'greenhouse' ? payload.jobs : payload;
        if (!Array.isArray(rows)) throw new Error('Invalid source response');
        return rows.slice(0, 2000).map((row: any): LiveJob => ({
          key: `${provider}:${board}:${row.id}`, title: row.title || row.text || '',
          company: board, location: row.location?.name || row.categories?.location || 'Not specified',
          url: provider === 'greenhouse' ? `https://job-boards.greenhouse.io/${board}/jobs/${row.id}` : row.applyUrl || '',
          description: String(row.content || row.descriptionPlain || '').replace(/<[^>]*>/g, ' ').slice(0, 50000),
          source: provider,
        })).filter(row => row.title && trustedApplicationUrl(row.url));
      } catch { warnings.push(`${provider}/${board}: live feed unavailable. No sample jobs were substituted.`); return []; }
    }));
    return { jobs: results.flat(), warnings };
  }
}
