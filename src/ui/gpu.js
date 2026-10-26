// Can this browser draw the game? Asked by boot.js before anything of the game loads, with a throwaway WebGL2
// context, and when the answer is no, a card saying how to turn graphics acceleration on. Chrome and Edge with
// acceleration off give no WebGL at all (they stopped falling back to the SwiftShader software renderer in
// Chrome 137); Firefox, or a browser that has blocklisted the GPU, may still give one drawn on the CPU, where
// the game crawls.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;
const DISMISSED = 'echelon.gpu-notice'; // the software card, once put away, stays away for the session

// the renderer of a fresh WebGL2 context with these attributes, or null when the browser gives none
function probe(attributes) {
  const gl = document.createElement('canvas').getContext('webgl2', attributes);
  if (!gl) return null;
  // Firefox reports the GPU as RENDERER (and warns about the debug extension); Chrome and Safari need the extension
  let renderer = gl.getParameter(gl.RENDERER);
  const info = renderer === 'WebKit WebGL' && gl.getExtension('WEBGL_debug_renderer_info');
  if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return String(renderer ?? '');
}

// 'gpu', 'software' (WebGL2 drawn on the CPU) or 'none' (no WebGL2), and the renderer's name
function status() {
  // failIfMajorPerformanceCaveat: no context when the browser would draw it on the CPU
  const fast = probe({ failIfMajorPerformanceCaveat: true });
  if (fast !== null && !SOFTWARE.test(fast)) return ['gpu', fast];
  const slow = fast ?? probe();
  return [slow === null ? 'none' : 'software', slow];
}

// this browser's switch; a chrome:// or edge:// address cannot be a link, so it is selectable text to paste
function howTo() {
  const ua = navigator.userAgent;
  const chromium = (scheme, restart) => ({
    steps: [`Open <code>${scheme}://settings/system</code>`, 'Turn on <b>Use graphics acceleration when available</b>', `Click <b>${restart}</b>`],
    check: `${scheme}://gpu`,
  });
  if (/Edg\//.test(ua)) return chromium('edge', 'Restart');
  if (/Firefox\//.test(ua)) {
    return {
      steps: ['Open Settings and search for <b>performance</b>', 'Untick <b>Use recommended performance settings</b>, then tick <b>Use hardware acceleration when available</b>', 'Restart Firefox'],
      check: 'about:support',
    };
  }
  if (/Chrome\//.test(ua)) return chromium('chrome', 'Relaunch');
  if (/Safari\//.test(ua)) return { steps: ['Update macOS: Safari has WebGL 2 from version 15'], check: null };
  return { steps: ["Turn on hardware (graphics) acceleration in the browser's settings", 'Restart the browser'], check: null };
}

function showNotice(state, renderer) {
  const { steps, check } = howTo();
  const root = document.createElement('div');
  root.id = 'gpu';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'gpu-title');
  root.setAttribute('aria-describedby', 'gpu-text');
  root.innerHTML = `<div class="ld-card">
    <header class="ld-head"><small>${state === 'none' ? 'WebGL unavailable' : 'Drawing without the graphics card'}</small></header>
    <h2 class="ld-title" id="gpu-title">Turn on graphics acceleration</h2>
    <p class="ld-blurb" id="gpu-text"></p>
    <ol class="gpu-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    ${state === 'software' ? '<p class="gpu-note">Renderer: <code id="gpu-renderer"></code></p>' : ''}
    <p class="gpu-note">Already on? Update the browser and the graphics driver: browsers switch WebGL off for drivers they distrust.${check ? ` <code>${check}</code> says what is off and why.` : ''}</p>
    <div class="gpu-actions">${state === 'software' ? '<button type="button" data-act="play">Play anyway</button>' : ''}<button type="button" data-act="retry" class="quiet">Check again</button></div>
  </div>`;
  root.querySelector('#gpu-text').textContent = state === 'none'
    ? 'The game draws its 3D world on the graphics card with WebGL 2, and this browser is not providing it. That almost always means its graphics acceleration is turned off.'
    : 'WebGL is running on the processor instead of the graphics card, so the game will be very slow. Turn graphics acceleration on for a playable frame rate.';
  if (state === 'software') root.querySelector('#gpu-renderer').textContent = renderer || 'unknown';
  root.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'retry') location.reload();
    if (act === 'play') {
      try { sessionStorage.setItem(DISMISSED, '1'); } catch { /* storage may be blocked */ }
      root.remove();
    }
  });
  document.body.append(root);
  root.querySelector('button').focus();
}

// Checks the browser and, unless the game will be drawn on the graphics card, puts up the card: for 'none' one that
// stays (the game cannot start), for 'software' one with Play anyway. Headless tools draw with SwiftShader on
// purpose and never see the latter. Returns the state; boot.js starts no game on 'none'.
export function checkGpu() {
  const [state, renderer] = status();
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(DISMISSED) === '1'; } catch { /* storage may be blocked */ }
  if (state === 'none' || (state === 'software' && !navigator.webdriver && !dismissed)) showNotice(state, renderer);
  return state;
}
