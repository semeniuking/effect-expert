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
  const v = new THREE.Vector3();

  function set(anchorWorld, labelText) {
    const next = anchorWorld ? labelText || '' : '';
    anchor = anchorWorld || null;
    if (next === text) return;
    text = next;
    wanted = !!(anchor && text);
    el.classList.remove('on');
    clearTimeout(swap);
    swap = setTimeout(() => {
      label.textContent = text;
    }, 200);
  }

  function update(camera, width, height) {
    if (!wanted || !anchor) { el.classList.remove('on'); return; }
    v.copy(anchor).project(camera);
    const behind = v.z > 1 || v.z < -1;
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    const off = x < 0 || x > width || y < 0 || y > height;
    if (behind || off) { el.classList.remove('on'); return; }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.classList.toggle('flip', x > width * 0.62);
    el.classList.add('on');
  }

  return { set, update };
}
