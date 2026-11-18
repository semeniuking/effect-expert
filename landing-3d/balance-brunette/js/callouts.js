import * as THREE from 'three';

// Dot + thin vertical line + letter-spaced label, pinned to a world point.
export function createCallouts(root) {
  const el = document.createElement('div');
  el.className = 'callout';
  el.innerHTML = '<span class="callout-dot"></span><span class="callout-line"></span><span class="callout-label"></span>';
  root.appendChild(el);
  const label = el.querySelector('.callout-label');

  let anchor = null;
  let text = '';
  let wanted = false; // anchor present and label set
  let swap = 0;
  let swapping = false; // between a label change and its text swap the old text must not show at the new anchor
  let lw = -1; // label width (px), measured lazily; -1 = stale
  let lastW = 0;
  const v = new THREE.Vector3();
  // Web fonts arriving later change the label width: re-measure.
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { lw = -1; });

  function set(anchorWorld, labelText) {
    const next = anchorWorld ? labelText || '' : '';
    anchor = anchorWorld || null;
    if (next === text) return;
    text = next;
    wanted = !!(anchor && text);
    el.classList.remove('on');
    swapping = true;
    clearTimeout(swap);
    swap = setTimeout(() => {
      label.textContent = text;
      swapping = false;
      lw = -1;
    }, 200);
  }

  function update(camera, width, height) {
    if (!wanted || !anchor || swapping) { el.classList.remove('on'); return; }
    v.copy(anchor).project(camera);
    const behind = v.z > 1 || v.z < -1;
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    const off = x < 0 || x > width || y < 0 || y > height;
    if (behind || off) { el.classList.remove('on'); return; }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const flip = x > width * 0.62;
    el.classList.toggle('flip', flip);
    // Clamp the label inside the viewport (12 px margin): it extends right of the anchor, or left when flipped.
    if (width !== lastW) { lastW = width; lw = -1; }
    if (lw < 0) lw = label.offsetWidth;
    const M = 14;
    let lx = 0;
    if (flip) lx = Math.max(0, M - (x - lw));
    else lx = Math.min(0, width - M - (x + lw));
    label.style.setProperty('--lx', `${lx.toFixed(1)}px`);
    el.classList.add('on');
  }

  return { set, update };
}
