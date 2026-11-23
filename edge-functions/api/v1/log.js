import {
  handleLogGet,
  handleLogOptions,
  handleLogPost,
} from '../../_shared/log-handler.js';

export function onRequestOptions() {
  return handleLogOptions();
}

export function onRequestGet(context) {
  return handleLogGet(context, 'v1');
}

export function onRequestPost(context) {
  return handleLogPost(context, 'v1');
}
