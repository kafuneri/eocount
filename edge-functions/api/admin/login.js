import { createSessionCookie, verifyAdminPassword } from '../../_shared/auth.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';

export function onRequestOptions() {
  return corsPreflightResponse();
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  const check = verifyAdminPassword(body?.password, env);
  if (!check.ok) {
    const status = check.error.includes('not set') ? 500 : 401;
    return jsonResponse({ status: 'error', message: check.error }, status);
  }

  const cookie = await createSessionCookie(request, env);
  return jsonResponse(
    { status: 'success', message: 'Login successful' },
    200,
    { 'Set-Cookie': cookie }
  );
}
