import { CLIENT_JS } from './_shared/client-code.js';

export function onRequestGet() {
  return new Response(CLIENT_JS, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
