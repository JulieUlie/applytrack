// Counts every number in an element's final text up from 0, like it is being calculated.
// "173" -> 0…173, "69/69" -> 0/0…69/69, "38.4 s" -> 0.0 s…38.4 s. Respects reduced motion.
const NUM = /\d+(?:\.\d+)?/g;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function countUp(el, finalText, duration = 1100) {
  const text = String(finalText);
  el.setAttribute("aria-label", text); // screen readers get the final value, not every frame
  const targets = (text.match(NUM) || []).map((n) => ({ value: Number(n), decimals: (n.split(".")[1] || "").length }));
  if (!targets.length || reduced()) { el.textContent = text; return; }
  const frame = (t) => {
    let i = 0;
    return text.replace(NUM, () => {
      const { value, decimals } = targets[i++];
      return (value * t).toFixed(decimals);
    });
  };
  const start = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const tick = (now) => {
    const x = Math.min(1, (now - start) / duration);
    el.textContent = frame(ease(x));
    if (x < 1) requestAnimationFrame(tick);
    else el.textContent = text;
  };
  el.textContent = frame(0);
  requestAnimationFrame(tick);
}
