/**
 * Per-frame HUD elements (crosshair, hit marker, debug text) are updated by writing to
 * the DOM directly from the game loop, so React never re-renders per frame. HUD
 * components register their elements here on mount.
 */
export interface HudDom {
  crosshair: HTMLElement | null;
  hitmarker: HTMLElement | null;
  debug: HTMLElement | null;
  vignette: HTMLElement | null;
  /** Container for pooled name-tag elements. */
  tags: HTMLElement | null;
  /** Third-person "shot blocked" marker. */
  blocked: HTMLElement | null;
}

export const hudDom: HudDom = { crosshair: null, hitmarker: null, debug: null, vignette: null, tags: null, blocked: null };
