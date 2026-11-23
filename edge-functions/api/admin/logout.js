import { clearSessionCookie } from '../../_shared/auth.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';

export function onRequestOptions() {
  return corsPreflightResponse();
}

export function onRequestPost({ request }) {
  return jsonResponse(
    { status: 'success', message: 'Logged out' },
    200,
    { 'Set-Cookie': clearSessionCookie(request) }
  );
}
