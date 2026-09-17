import {gunzipSync, strFromU8} from 'fflate';
import {decodeBase85} from './base85.js';
import {LOAD_ERROR} from './import-errors';

// This contains only our own build output. No network, eval or Function is
// needed: the restored bundle runs as an inline script in the plugin iframe.
const payload = document.getElementById('plugin-source');
try {
  if (!payload) throw new Error('Missing embedded source');
  const compressed = decodeBase85(payload.textContent || '', Number(payload.dataset.bytes));
  payload.remove();
  const script = document.createElement('script');
  script.textContent = strFromU8(gunzipSync(compressed));
  document.body.appendChild(script);
  script.remove();
} catch {
  payload?.remove();
  const app = document.getElementById('app');
  if (app) app.innerHTML = '<div class="container"><h1>插件加载异常</h1><p class="sub error">' + LOAD_ERROR + '</p></div>';
}
