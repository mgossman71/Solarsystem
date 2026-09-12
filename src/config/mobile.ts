// ============================================================
// MOBILE — behavioral device signals (single source of truth)
// ============================================================
// NOTE: the *visual* desktop-vs-mobile layout (primary bar vs. bottom sheet)
// is driven entirely by CSS media queries in index.html — there is no JS width
// breakpoint. This module holds the few *behavioral* mobile signals that JS
// needs, so they are not scattered across the scene.

/** Respect the OS "reduce motion" preference (disables auto-rotate + tweens). */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}