// Probability math is separated from the UI so it can be tested without a browser.
export function normalized(p) {
  const sum = p.reduce((a, b) => a + b, 0);
  if (!sum || p.some((x) => !Number.isFinite(x) || x < 0))
    throw Error("Invalid distribution");
  return p.map((x) => x / sum);
}
export function argmax(p) {
  return p.indexOf(Math.max(...p));
}
export function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}
const hues = [0, 0, 1 / 12, 1 / 6, 1 / 3, 0.5, 2 / 3, 0.75, 5 / 6];
export function prepare(data) {
  const pixels = data.pixels.map((p) => {
    let colors = [],
      weights = [],
      hard;
    if (data.method === "palette") {
      colors = data.palette;
      weights = normalized(p.probabilities);
      hard = colors[argmax(weights)];
    } else if (data.method === "silhouette") {
      colors = [
        [255, 255, 255],
        [0, 0, 0],
      ];
      weights = [1 - p.foreground, p.foreground];
      hard = colors[p.foreground >= 0.5 ? 1 : 0];
    } else if (data.method === "rgb") {
      for (let bits = 0; bits < 8; bits++) {
        let color = [],
          w = 1;
        for (let c = 0; c < 3; c++) {
          const on = (bits >> c) & 1;
          color.push(on * 255);
          w *= on ? p.channels[c] : 1 - p.channels[c];
        }
        colors.push(color);
        weights.push(w);
      }
      hard = p.channels.map((v) => (v >= 0.5 ? 255 : 0));
    } else {
      const hp = normalized(p.hue),
        sp = normalized(p.saturation),
        lp = normalized(p.lightness);
      for (let h = 0; h < hp.length; h++)
        for (let s = 0; s < sp.length; s++)
          for (let l = 0; l < lp.length; l++) {
            colors.push(hsl(hues[h], h === 0 ? 0 : s / 2, l / 4));
            weights.push(hp[h] * sp[s] * lp[l]);
          }
      const hi = argmax(hp);
      hard = hsl(hues[hi], hi === 0 ? 0 : argmax(sp) / 2, argmax(lp) / 4);
    }
    weights = normalized(weights);
    let sum = 0;
    const cdf = weights.map((w) => (sum += w));
    cdf[cdf.length - 1] = 1;
    const mean = [0, 1, 2].map((c) =>
      colors.reduce((v, color, i) => v + color[c] * weights[i], 0),
    );
    return { colors, weights, cdf, mean, hard };
  });
  return {
    size: data.size,
    pixels,
    mean: pixels.flatMap((p) => p.mean),
    hard: pixels.flatMap((p) => p.hard),
  };
}
