import { useState, useEffect, useRef } from 'react';

/**
 * Smoothly animates a number from its previous value to the target.
 * Returns the current animated value.
 */
export function useAnimatedNumber(target: number, duration = 800): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = target;
    prevRef.current = target;

    // Skip animation on first render or if values are the same
    const diff = Math.abs(to - from);
    if (diff < 0.01) {
      setDisplay(to);
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for a satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return display;
}
