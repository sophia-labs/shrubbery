import { css } from 'lit'

export const vtuberStyles = css`
  :host {
    display: block;
    position: relative;
    contain: layout style paint;
    min-width: 160px;
    min-height: 220px;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--mn-radius-surface, 8px);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0) 34%),
      linear-gradient(135deg, rgba(214, 168, 79, 0.11), rgba(214, 168, 79, 0) 48%),
      linear-gradient(225deg, rgba(95, 143, 220, 0.12), rgba(95, 143, 220, 0) 52%),
      var(--mn-color-surface-subtle, #f6f8fb);
    color: var(--mn-color-text-primary, #111827);
    font-family: var(--mn-font-chrome, system-ui, sans-serif);
  }

  :host([status='error']) {
    background:
      linear-gradient(180deg, rgba(254, 242, 242, 0.84), rgba(255, 255, 255, 0)),
      var(--mn-color-surface-subtle, #f6f8fb);
  }

  .stage,
  canvas,
  .css-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .stage {
    isolation: isolate;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.48) 0 58%, rgba(229, 236, 244, 0.72) 59% 100%),
      linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0));
  }

  .stage::before,
  .stage::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }

  .stage::before {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0) 66%, rgba(15, 23, 42, 0.055) 100%),
      repeating-linear-gradient(
        0deg,
        rgba(91, 109, 127, 0.08) 0 1px,
        rgba(255, 255, 255, 0) 1px 46px
      );
    -webkit-mask-image: linear-gradient(180deg, transparent 54%, #000 82%);
    mask-image: linear-gradient(180deg, transparent 54%, #000 82%);
  }

  .stage::after {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0) 32%),
      linear-gradient(90deg, rgba(15, 23, 42, 0.06), rgba(255, 255, 255, 0) 24% 76%, rgba(15, 23, 42, 0.05));
    mix-blend-mode: soft-light;
  }

  canvas {
    display: block;
    outline: none;
    z-index: 1;
  }

  .css-fallback {
    display: grid;
    place-items: end center;
    pointer-events: none;
    padding-bottom: 12%;
    opacity: 0;
    z-index: 2;
    transition: opacity 160ms ease;
  }

  :host(:not([data-webgl='ready'])) .css-fallback {
    opacity: 1;
  }

  .css-avatar {
    position: relative;
    width: min(58%, 180px);
    aspect-ratio: 0.72;
  }

  .css-avatar::before,
  .css-avatar::after {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    border-radius: 999px;
  }

  .css-avatar::before {
    top: 0;
    width: 58%;
    height: 42%;
    background:
      radial-gradient(circle at 37% 48%, var(--mn-color-surface-base, #fff) 0 3%, transparent 4%),
      radial-gradient(circle at 63% 48%, var(--mn-color-surface-base, #fff) 0 3%, transparent 4%),
      linear-gradient(145deg, #f0c7c4, #dca9b6);
    box-shadow:
      0 -16px 0 -5px #28323c,
      0 18px 30px rgba(15, 23, 42, 0.12);
  }

  .css-avatar::after {
    bottom: 0;
    width: 92%;
    height: 64%;
    background:
      linear-gradient(115deg, transparent 0 43%, rgba(255, 255, 255, 0.22) 44% 54%, transparent 55%),
      linear-gradient(180deg, #49636f, #243447);
    clip-path: polygon(18% 0, 82% 0, 100% 100%, 0 100%);
    box-shadow: 0 20px 36px rgba(15, 23, 42, 0.16);
  }

  .status {
    position: absolute;
    z-index: 3;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
`
