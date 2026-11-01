import type { Plugin } from 'vite';

/**
 * The production Content-Security-Policy (docs/design/sync.md §5.5). Scripts, frames and
 * connections reach only 'self', Google Identity Services and the Drive/OAuth endpoints. The one
 * other host is the GoatCounter count beacon, an image request allowed in `img-src` only
 * (docs/analytics.md). `frame-ancestors` cannot be set in a meta tag, so it is not here.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com",
  'frame-src https://accounts.google.com/gsi/',
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://creynia.goatcounter.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Injects the CSP as a `<meta http-equiv>` right after the charset meta of every HTML entry in a
 * production build (a policy only covers what follows it, and the charset must stay in the first
 * 1024 bytes). The dev server is left alone: HMR needs
 * inline scripts and a websocket.
 */
export function cspPlugin(): Plugin {
  let command: 'build' | 'serve' = 'build';
  return {
    name: 'spinner-csp',
    configResolved(config) {
      command = config.command;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (command === 'serve') return html;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
        // Right after the charset declaration, which must stay inside the first 1024 bytes.
        const charset = /<meta\s+charset=[^>]*>/i.exec(html);
        if (charset) {
          const at = charset.index + charset[0].length;
          return `${html.slice(0, at)}\n    ${meta}${html.slice(at)}`;
        }
        return html.replace(/<head[^>]*>/i, (h) => `${h}\n    ${meta}`);
      },
    },
  };
}
