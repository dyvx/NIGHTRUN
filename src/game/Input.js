import { now } from './utils.js';

/**
 * Unified input: touch swipes (iPhone), pointer drags (mouse), keyboard and
 * optional on-screen buttons. Everything funnels into a tiny action bus.
 *
 * Actions: 'left' | 'right' | 'jump' | 'slide'
 */
export class Input {
  constructor(element, handlers = {}) {
    this.el = element;
    this.handlers = handlers;
    this.enabled = false;
    this.pointers = new Map();
    this.SWIPE_MIN = 22; // px
    this.SWIPE_MIN_FLICK = 12; // px when the gesture is fast
    this.FLICK_MS = 320;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchStartPassive = this._onTouchStartPassive.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    const el = this.el;

    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerCancel);
    el.addEventListener('pointerleave', this._onPointerCancel);
    el.addEventListener('contextmenu', this._onContextMenu);

    // Block native gestures (scroll / pinch / double-tap zoom) on the stage.
    el.addEventListener('touchstart', this._onTouchStartPassive, { passive: true });
    el.addEventListener('touchmove', this._onTouchMove, { passive: false });

    window.addEventListener('keydown', this._onKeyDown);
  }

  detach() {
    if (!this._attached) return;
    this._attached = false;
    const el = this.el;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerCancel);
    el.removeEventListener('pointerleave', this._onPointerCancel);
    el.removeEventListener('contextmenu', this._onContextMenu);
    el.removeEventListener('touchstart', this._onTouchStartPassive);
    el.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  setEnabled(on) {
    this.enabled = on;
    this.pointers.clear();
  }

  emit(action) {
    this.handlers.onAction?.(action);
  }

  /* ------------------------------ pointer ------------------------------ */
  _onPointerDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      t0: now(),
      fired: false,
    });
  }

  _onPointerMove(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p || p.fired) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const fast = now() - p.t0 < this.FLICK_MS;
    const thr = fast ? this.SWIPE_MIN_FLICK : this.SWIPE_MIN;
    if (Math.max(adx, ady) < thr) return;

    // Resolve as soon as the dominant axis is clear — feels snappier.
    if (adx > ady * 1.05) {
      p.fired = true;
      this.emit(dx > 0 ? 'right' : 'left');
    } else if (ady > adx * 1.05) {
      p.fired = true;
      this.emit(dy > 0 ? 'slide' : 'jump');
    }
  }

  _onPointerUp(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!this.enabled || !p || p.fired) return;

    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (Math.max(adx, ady) < this.SWIPE_MIN) return; // a tap, not a swipe

    if (adx > ady) this.emit(dx > 0 ? 'right' : 'left');
    else this.emit(dy > 0 ? 'slide' : 'jump');
  }

  _onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
  }

  /* ------------------------------- touch ------------------------------- */
  _onTouchStartPassive(e) {
    // pinch-zoom guard: a second finger cancels any in-flight swipe
    if (e.touches.length > 1) this.pointers.clear();
  }

  _onTouchMove(e) {
    // Always prevent scrolling / pull-to-refresh / rubber-banding.
    if (e.cancelable) e.preventDefault();
  }

  /* ------------------------------ keyboard ----------------------------- */
  _onKeyDown(e) {
    if (e.repeat) return;
    const k = e.key;
    const code = e.code;

    if (k === 'Escape' || k === 'p' || k === 'P') {
      this.handlers.onPauseKey?.();
      if (this.enabled) e.preventDefault();
      return;
    }

    if (!this.enabled) return;

    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.emit('left');
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.emit('right');
        e.preventDefault();
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'Space':
        this.emit('jump');
        e.preventDefault();
        break;
      case 'ArrowDown':
      case 'KeyS':
      case 'ShiftLeft':
      case 'ShiftRight':
        this.emit('slide');
        e.preventDefault();
        break;
      case 'Enter':
        this.handlers.onConfirm?.();
        break;
      default:
        break;
    }
  }

  /* --------------------------- screen buttons -------------------------- */
  bindButtons(nodes) {
    for (const btn of nodes) {
      const action = btn.dataset.action;
      const down = (e) => {
        e.preventDefault();
        btn.classList.add('is-down');
        if (this.enabled) this.emit(action);
      };
      const up = () => btn.classList.remove('is-down');
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }
}
