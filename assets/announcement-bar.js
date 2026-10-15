// @ts-check
/**
 * <announcement-bar>: on mobile, shows one message at a time and cross-fades to the next.
 * Rotation pauses on hover/focus, while the tab is hidden, and never starts with prefers-reduced-motion.
 * On desktop every message is visible, so the timer only runs below 750px.
 */
if (!customElements.get('announcement-bar')) {
  class AnnouncementBar extends HTMLElement {
    /** @type {number | undefined} */
    #timer;
    #index = 0;
    #paused = false;
    #mobile = matchMedia('(max-width: 749px)');
    #reduced = matchMedia('(prefers-reduced-motion: reduce)');
    /** @type {HTMLElement[]} */
    #items = [];
    #onChange = () => this.#start();

    connectedCallback() {
      this.#items = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-announcement]')]);
      if (this.#items.length < 2) return;
      this.#show(0);
      this.classList.add('is-ready');

      const pause = () => ((this.#paused = true), this.#stop());
      const resume = () => ((this.#paused = false), this.#start());
      this.addEventListener('mouseenter', pause);
      this.addEventListener('mouseleave', resume);
      this.addEventListener('focusin', pause);
      this.addEventListener('focusout', resume);
      this.#mobile.addEventListener('change', this.#onChange);
      this.#reduced.addEventListener('change', this.#onChange);
      document.addEventListener('visibilitychange', this.#onChange);

      // Theme editor: reveal the selected message.
      this.addEventListener('shopify:block:select', (event) => {
        const i = this.#items.indexOf(/** @type {HTMLElement} */ (event.target));
        if (i > -1) this.#show(i);
        pause();
      });
      this.addEventListener('shopify:block:deselect', resume);

      this.#start();
    }

    disconnectedCallback() {
      this.#stop();
      this.#mobile.removeEventListener('change', this.#onChange);
      this.#reduced.removeEventListener('change', this.#onChange);
      document.removeEventListener('visibilitychange', this.#onChange);
    }

    #start() {
      this.#stop();
      if (this.#paused || !this.#mobile.matches || this.#reduced.matches || document.hidden) return;
      const seconds = Number(this.dataset.interval) || 5;
      this.#timer = window.setInterval(() => this.#show(this.#index + 1), seconds * 1000);
    }

    #stop() {
      clearInterval(this.#timer);
    }

    /** @param {number} index */
    #show(index) {
      const items = this.#items;
      this.#index = (index + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle('is-active', i === this.#index));
    }
  }

  customElements.define('announcement-bar', AnnouncementBar);
}
