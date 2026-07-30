/**
 * Make a brand report self-contained. A report references external assets: the
 * site's web font files (in @font-face) and, for a raster mark, the logo image.
 * A strict CSP (a published Artifact) blocks those hosts, so the fonts fall back
 * and the logo vanishes. This module fetches each asset once and returns it as a
 * base64 data: URI keyed by URL; the report swaps every URL it can for its data:
 * URI, rendering pixel-true with zero external requests.
 *
 * Best-effort by design: an asset that fails to fetch (offline, 404, too large)
 * is simply left as a URL, so a report is never broken by an unreachable asset.
 * SVG logos are already inlined by the report and need no fetch.
 */

import type { DesignModel } from './design-model.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MAX_ASSET_BYTES = 3_000_000; // skip anything larger than ~3MB (an illustration, not a mark)

/** The external asset URLs a report would load: web fonts and a raster logo. */
export function assetUrls(design: DesignModel): string[] {
  const urls = new Set<string>();
  for (const f of design.brand.typography.fontFaces ?? []) {
    if (f.src && isHttp(f.src)) urls.add(f.src);
  }
  const logo = design.brand.logo;
  if (logo?.kind === 'img' && logo.src && isHttp(logo.src)) urls.add(logo.src);
  return [...urls];
}

/** Fetch every referenced asset and return a URL -> base64 data: URI map. */
export async function collectReportAssets(design: DesignModel): Promise<Map<string, string>> {
  const origin = originOf(design.source);
  const headers: Record<string, string> = { 'user-agent': UA, accept: '*/*' };
  if (origin) headers.referer = origin;

  const entries = await Promise.all(
    assetUrls(design).map(async (url): Promise<[string, string] | null> => {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_ASSET_BYTES) return null;
        return [url, `data:${mimeFor(url, res.headers.get('content-type'))};base64,${buf.toString('base64')}`];
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is [string, string] => e !== null));
}

function isHttp(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function originOf(source: string): string | null {
  try {
    return new URL(source).origin;
  } catch {
    return null;
  }
}

/** Prefer the file extension (reliable for fonts) over a possibly-wrong content-type. */
function mimeFor(url: string, contentType: string | null): string {
  const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const byExt: Record<string, string> = {
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  };
  if (byExt[ext]) return byExt[ext];
  const ct = (contentType ?? '').split(';')[0].trim();
  return ct || 'application/octet-stream';
}
