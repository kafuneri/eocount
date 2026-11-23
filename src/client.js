(function () {
  'use strict';

  var scriptEl = document.currentScript;
  var API_URL = '/api/v2/log';
  if (scriptEl && scriptEl.src) {
    try {
      var parsed = new URL(scriptEl.src, window.location.href);
      API_URL = parsed.origin + '/api/v2/log';
    } catch (e) {
      API_URL = '/api/v2/log';
    }
  }

  var COUNTER_IDS = ['site_pv', 'page_pv', 'site_uv'];
  var REQUEST_TIMEOUT = 5000;

  function getCacheKey() {
    return 'eoVercount:' + window.location.pathname;
  }

  function getCachedData() {
    try {
      var raw = localStorage.getItem(getCacheKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setCachedData(data) {
    try {
      localStorage.setItem(getCacheKey(), JSON.stringify(data));
    } catch (e) {
      // ignore storage errors
    }
  }

  function extractCounterData(response) {
    if (response && response.status === 'success' && response.data) {
      return response.data;
    }
    if (response && typeof response.site_pv !== 'undefined') {
      return response;
    }
    return null;
  }

  function updateDom(data) {
    for (var i = 0; i < COUNTER_IDS.length; i++) {
      var id = COUNTER_IDS[i];
      var val = String(data[id] !== undefined && data[id] !== null ? data[id] : 0);

      var vcVal = document.getElementById('vercount_value_' + id);
      var bszVal = document.getElementById('busuanzi_value_' + id);
      if (vcVal) vcVal.textContent = val;
      if (bszVal) bszVal.textContent = val;

      var vcBox = document.getElementById('vercount_container_' + id);
      var bszBox = document.getElementById('busuanzi_container_' + id);
      if (vcBox) vcBox.style.display = 'inline';
      if (bszBox) bszBox.style.display = 'inline';
    }
  }

  async function fetchCounterData() {
    var currentUrl = window.location.href;
    if (!currentUrl.startsWith('http')) return null;

    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT);

    try {
      var res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentUrl }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      return extractCounterData(json);
    } catch (err) {
      clearTimeout(timer);
      return null;
    }
  }

  async function runCounter() {
    var data = await fetchCounterData();
    if (data) {
      updateDom(data);
      setCachedData(data);
      return data;
    }
    var cached = getCachedData();
    if (cached) {
      updateDom(cached);
      return cached;
    }
    return null;
  }

  function onReady(fn) {
    if (document.readyState !== 'loading') {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  }

  window.vercountFetch = runCounter;
  document.addEventListener('pjax:complete', runCounter);
  document.addEventListener('astro:page-load', runCounter);

  onReady(runCounter);
})();
