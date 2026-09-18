import { prepare } from "./art.mjs";
export function renderPaint(result, width = 560) {
  const times = {},
    started = performance.now();
  let mark = started;
  const checkpoint = (name) => {
    times[name] = performance.now() - mark;
    mark = performance.now();
  };
  const prepared = prepare(result),
    n = prepared.size;
  const image = { data: new Uint8ClampedArray(width * width * 4) },
    palette = [],
    ids = new Map();
  const maps = prepared.pixels.map((pixel) => {
    const m = new Map();
    pixel.colors.forEach((rgb, k) => {
      const c = rgb.map(Math.round),
        key = c.join(",");
      if (!ids.has(key)) {
        ids.set(key, palette.length);
        palette.push(c);
      }
      const id = ids.get(key);
      m.set(id, (m.get(id) || 0) + pixel.weights[k]);
    });
    return m;
  });
  const active = palette
    .map((_, id) => id)
    .filter((id) => maps.some((m) => (m.get(id) || 0) > 0));
  const fields = maps.map((m) =>
    Float64Array.from(active, (id) => m.get(id) || 0),
  );
  // Independent smooth Gaussian fields. Normal CDF -> uniform -> Gumbel noise.
  // Unit variance normalization keeps the categorical sampling rule consistent.
  const hash = (x, y, k) => {
    let h =
      Math.imul(x + 137, 374761393) ^
      Math.imul(y + 317, 668265263) ^
      Math.imul(k + 79, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) + 0.5) / 4294967296;
  };
  const pitch = width / 85,
    side = Math.ceil(width / pitch) + 2;
  const noise = active.map((id) =>
    Float64Array.from(
      { length: side * side },
      (_, i) =>
        Math.sqrt(-2 * Math.log(hash(i % side, Math.floor(i / side), id * 2))) *
        Math.cos(
          2 * Math.PI * hash(i % side, Math.floor(i / side), id * 2 + 1),
        ),
    ),
  );
  const cdf = (z) => {
    const a = Math.abs(z),
      t = 1 / (1 + 0.2316419 * a),
      d = 0.3989422804 * Math.exp((-a * a) / 2),
      p =
        1 -
        d *
          t *
          (0.31938153 +
            t *
              (-0.356563782 +
                t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? p : 1 - p;
  };
  // Only sample pigment where a stroke actually needs it (cached by pixel).
  const sampled = new Int16Array(width * width);
  sampled.fill(-1);
  const sample = (x, y) => {
    const index = y * width + x;
    if (sampled[index] >= 0) return palette[sampled[index]];
    const gx = Math.max(0, Math.min(n - 1, ((x + 0.5) * n) / width - 0.5)),
      gy = Math.max(0, Math.min(n - 1, ((y + 0.5) * n) / width - 0.5)),
      ix = Math.floor(gx),
      iy = Math.floor(gy),
      fx = gx - ix,
      fy = gy - iy;
    const a = fields[iy * n + ix],
      b = fields[iy * n + Math.min(n - 1, ix + 1)],
      c = fields[Math.min(n - 1, iy + 1) * n + ix],
      d = fields[Math.min(n - 1, iy + 1) * n + Math.min(n - 1, ix + 1)];
    const nx = x / pitch,
      ny = y / pitch,
      xx = Math.floor(nx),
      yy = Math.floor(ny);
    let u = nx - xx,
      v = ny - yy;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v],
      norm = Math.sqrt(w.reduce((s, q) => s + q * q, 0));
    let best = -Infinity,
      chosen = active[0];
    for (let k = 0; k < active.length; k++) {
      const p =
        a[k] * (1 - fx) * (1 - fy) +
        b[k] * fx * (1 - fy) +
        c[k] * (1 - fx) * fy +
        d[k] * fx * fy;
      if (p <= 0) continue;
      const f = noise[k],
        z =
          (f[yy * side + xx] * w[0] +
            f[yy * side + xx + 1] * w[1] +
            f[(yy + 1) * side + xx] * w[2] +
            f[(yy + 1) * side + xx + 1] * w[3]) /
          norm;
      const uniform = Math.max(1e-9, Math.min(1 - 1e-9, cdf(z))),
        score = Math.log(p) - Math.log(-Math.log(uniform));
      if (score > best) {
        best = score;
        chosen = active[k];
      }
    }
    sampled[index] = chosen;
    return palette[chosen];
  };
  checkpoint("setup");
  // Paint geometry is a rendering material layered over the sampled colors.
  const height = new Float32Array(width * width);
  let seed = 93421;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const unit = width / 560;
  const tone = (x, y) => {
    const gx = Math.max(0, Math.min(n - 1, (x / width) * n - 0.5)),
      gy = Math.max(0, Math.min(n - 1, (y / width) * n - 0.5)),
      ix = Math.floor(gx),
      iy = Math.floor(gy),
      fx = gx - ix,
      fy = gy - iy;
    const t = (dx, dy) => {
      const c =
        prepared.pixels[Math.min(n - 1, iy + dy) * n + Math.min(n - 1, ix + dx)]
          .mean;
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    return (
      t(0, 0) * (1 - fx) * (1 - fy) +
      t(1, 0) * fx * (1 - fy) +
      t(0, 1) * (1 - fx) * fy +
      t(1, 1) * fx * fy
    );
  };
  const direction = (x, y, previous) => {
    const e = (width / n) * 0.35,
      gx = tone(x + e, y) - tone(x - e, y),
      gy = tone(x, y + e) - tone(x, y - e);
    let target =
      Math.hypot(gx, gy) > 2 ? Math.atan2(gy, gx) + Math.PI / 2 : previous;
    while (target - previous > Math.PI / 2) target -= Math.PI;
    while (target - previous < -Math.PI / 2) target += Math.PI;
    return previous + 0.25 * (target - previous);
  };
  // Entropy measures the spread of the full color distribution, for every representation.
  const uncertainty = (x, y) => {
    const gx = Math.max(0, Math.min(n - 1, (x / width) * n - 0.5)),
      gy = Math.max(0, Math.min(n - 1, (y / width) * n - 0.5)),
      ix = Math.floor(gx),
      iy = Math.floor(gy),
      fx = gx - ix,
      fy = gy - iy;
    let entropy = 0;
    for (let k = 0; k < active.length; k++) {
      const at = (dx, dy) =>
        fields[Math.min(n - 1, iy + dy) * n + Math.min(n - 1, ix + dx)][k];
      const p =
        at(0, 0) * (1 - fx) * (1 - fy) +
        at(1, 0) * fx * (1 - fy) +
        at(0, 1) * (1 - fx) * fy +
        at(1, 1) * fx * fy;
      if (p > 0) entropy -= p * Math.log(p);
    }
    // Effective alternatives, compressed to 0..1 without dependence on unused colors.
    return 1 - Math.exp(-entropy);
  };
  const maskSize = 128,
    mask = Float32Array.from({ length: maskSize * maskSize }, (_, i) =>
      uncertainty(
        (((i % maskSize) + 0.5) / maskSize) * width,
        ((Math.floor(i / maskSize) + 0.5) / maskSize) * width,
      ),
    );
  const spreadAt = (x, y) =>
    mask[
      Math.min(maskSize - 1, Math.floor((y / width) * maskSize)) * maskSize +
        Math.min(maskSize - 1, Math.floor((x / width) * maskSize))
    ];
  // Continuous underpainting, not overlapping brush stamps, in confident areas.
  // Interpolate the local mean pigment; uncertainty determines where impasto is added.
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const gx = Math.max(0, Math.min(n - 1, ((x + 0.5) / width) * n - 0.5)),
        gy = Math.max(0, Math.min(n - 1, ((y + 0.5) / width) * n - 0.5)),
        ix = Math.floor(gx),
        iy = Math.floor(gy),
        fx = gx - ix,
        fy = gy - iy;
      const at = (dx, dy) =>
        prepared.pixels[Math.min(n - 1, iy + dy) * n + Math.min(n - 1, ix + dx)]
          .mean;
      const a = at(0, 0),
        b = at(1, 0),
        c = at(0, 1),
        d = at(1, 1),
        i = y * width + x;
      const contributors = [
        [a, (1 - fx) * (1 - fy)],
        [b, fx * (1 - fy)],
        [c, (1 - fx) * fy],
        [d, fx * fy],
      ];
      for (let k = 0; k < 3; k++)
        image.data[i * 4 + k] = contributors.reduce(
          (sum, [rgb, w]) => sum + rgb[k] * w,
          0,
        );
      image.data[i * 4 + 3] = 255;
      height[i] =
        0.015 * unit * Math.sin((x / unit) * 0.7) * Math.sin((y / unit) * 0.8);
    }
  checkpoint("underpaint");
  for (let stroke = 0; stroke < 2300; stroke++) {
    const cx = random() * width,
      cy = random() * width;
    const pigment = [...sample(Math.floor(cx), Math.floor(cy))];
    const spread = uncertainty(cx, cy);
    // No independent strokes below the threshold. Gradually introduce them above it.
    const relief = Math.max(0, Math.min(1, (spread - 0.48) / 0.32));
    const richness = relief * relief * (3 - 2 * relief);
    if (random() > richness) continue;
    const detail = stroke >= 2100;
    if (detail && random() > richness) continue;
    const e = (width / n) * 0.35,
      gx = tone(cx + e, cy) - tone(cx - e, cy),
      gy = tone(cx, cy + e) - tone(cx, cy - e);
    const angle =
      Math.hypot(gx, gy) > 3
        ? Math.atan2(gy, gx) + Math.PI / 2
        : -0.4 + 0.3 * Math.sin((cx / width) * 6);
    const radius =
      (detail ? 1.5 + random() * 2 : 9 + 18 * (1 - spread) + random() * 5) *
      unit;
    // Broad underpainting uses neighborhood-supported pigment; accents retain rare samples.
    if (!detail) {
      const votes = new Map();
      for (let oy = -2; oy <= 2; oy++)
        for (let ox = -2; ox <= 2; ox++) {
          const sx = Math.max(
              0,
              Math.min(width - 1, Math.round(cx + ox * 4 * unit)),
            ),
            sy = Math.max(
              0,
              Math.min(width - 1, Math.round(cy + oy * 4 * unit)),
            );
          const key = sample(sx, sy).join(",");
          votes.set(key, (votes.get(key) || 0) + 1);
        }
      const key = [...votes].sort((a, b) => b[1] - a[1])[0][0];
      pigment.splice(0, 3, ...key.split(",").map(Number));
    }
    const rgb = pigment,
      depth =
        (detail
          ? 0.15 + richness * 1.7
          : 0.05 + richness * (2.3 + random() * 2.1)) * unit,
      phase = random() * 6.28;
    const profile = random(),
      edgeBias = random() - 0.5;
    const steps = detail ? 2 : 4,
      step = (detail ? 2 : 4 + 12 * (1 - spread) + random() * 2) * unit;
    const trace = (sign) => {
      let x = cx,
        y = cy,
        theta = angle;
      const points = [];
      for (let j = 0; j < steps; j++) {
        theta = direction(x, y, theta);
        theta = Math.max(angle - 0.22, Math.min(angle + 0.22, theta));
        const nextX = x + Math.cos(theta) * step * sign,
          nextY = y + Math.sin(theta) * step * sign;
        if (j > 0 && Math.abs(tone(nextX, nextY) - tone(cx, cy)) > 18) break;
        x = nextX;
        y = nextY;
        points.push([x, y]);
      }
      return points;
    };
    const path = [...trace(-1).reverse(), [cx, cy], ...trace(1)];
    const minX = Math.max(
        0,
        Math.floor(Math.min(...path.map((p) => p[0])) - radius * 1.3),
      ),
      maxX = Math.min(
        width,
        Math.ceil(Math.max(...path.map((p) => p[0])) + radius * 1.3),
      );
    const minY = Math.max(
        0,
        Math.floor(Math.min(...path.map((p) => p[1])) - radius * 1.3),
      ),
      maxY = Math.min(
        width,
        Math.ceil(Math.max(...path.map((p) => p[1])) + radius * 1.3),
      );
    const segments = path.slice(1).map(([bx, by], j) => {
      const [ax, ay] = path[j],
        dx = bx - ax,
        dy = by - ay,
        l2 = dx * dx + dy * dy;
      return {
        ax,
        ay,
        dx,
        dy,
        inv: 1 / l2,
        normal: 1 / Math.sqrt(l2) / radius,
      };
    });
    for (let y = minY; y < maxY; y++)
      for (let x = minX; x < maxX; x++) {
        let nearest = Infinity,
          u = 0,
          v = 0;
        for (let j = 0; j < segments.length; j++) {
          const { ax, ay, dx, dy, inv, normal } = segments[j];
          const t = Math.max(
              0,
              Math.min(1, ((x - ax) * dx + (y - ay) * dy) * inv),
            ),
            ex = x - ax - t * dx,
            ey = y - ay - t * dy,
            dist = ex * ex + ey * ey;
          if (dist < nearest) {
            nearest = dist;
            u = (2 * (j + t)) / segments.length - 1;
            v = (ex * -dy + ey * dx) * normal;
          }
        }
        if (nearest > radius * radius * 1.4) continue;
        const tip = 0.94 + 0.08 * Math.cos(v * 2 + phase) + edgeBias * v * 0.16;
        const side =
          0.8 + 0.13 * Math.cos(u * 2 + phase) + (profile - 0.5) * u * 0.25;
        const taper = Math.sqrt(
          Math.max(0, 1 - (u / tip) * (u / tip) * ((u / tip) * (u / tip))),
        );
        const shape = Math.abs(v) / (side * Math.max(0.01, taper));
        if (Math.abs(u) >= tip) continue;
        if (shape >= 1) continue;

        const edge = Math.min(1, (1 - shape) * 35);
        const bristle =
          richness * 0.018 * Math.sin(v * (8 + profile * 12) + phase + u * 0.3);
        const lip = 0.12 * Math.exp(-Math.pow((shape - 0.89) * 15, 2));
        const mound = depth * (0.7 + bristle + lip + 0.08 * u) * edge;
        const i = y * width + x;
        const localSpread = spreadAt(x, y),
          localRelief = Math.max(0, Math.min(1, (localSpread - 0.48) / 0.32));
        const paintEdge =
          edge * localRelief * localRelief * (3 - 2 * localRelief);
        // Same-pigment passes merge instead of embossing every overlapping mark.
        const dr = rgb[0] - image.data[i * 4],
          dg = rgb[1] - image.data[i * 4 + 1],
          db = rgb[2] - image.data[i * 4 + 2];
        const difference = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
        const separation = Math.min(1, difference / 55);
        const deposit =
          height[i] * (1 - separation) +
          (0.15 * height[i] + mound) * separation;
        height[i] = height[i] * (1 - paintEdge) + deposit * paintEdge;
        for (let c = 0; c < 3; c++)
          image.data[i * 4 + c] =
            image.data[i * 4 + c] * (1 - paintEdge) + rgb[c] * paintEdge;
      }
  }
  checkpoint("strokes");
  // Smooth only the physical height map: paint colors and boundaries stay sharp.
  const softened = new Float32Array(height.length),
    r = Math.max(1, Math.round(unit));
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      let value = 0,
        weight = 0;
      for (let d = -r; d <= r; d++) {
        const w = r + 1 - Math.abs(d);
        value +=
          height[y * width + Math.max(0, Math.min(width - 1, x + d))] * w;
        weight += w;
      }
      softened[y * width + x] = value / weight;
    }
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      let value = 0,
        weight = 0;
      for (let d = -r; d <= r; d++) {
        const w = r + 1 - Math.abs(d);
        value +=
          softened[Math.max(0, Math.min(width - 1, y + d)) * width + x] * w;
        weight += w;
      }
      height[y * width + x] = value / weight;
    }
  for (let y = 1; y < width - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x,
        gx = (height[i + 1] - height[i - 1]) / 2,
        gy = (height[i + width] - height[i - width]) / 2;
      const len = Math.hypot(gx, gy, 1),
        nx = -gx / len,
        ny = -gy / len,
        nz = 1 / len;
      const diffuse = Math.max(0, nx * -0.45 + ny * -0.55 + nz * 0.705);
      const shine =
        Math.pow(Math.max(0, nx * -0.243 + ny * -0.297 + nz * 0.923), 34) *
        0.16;
      // Short shadows from raised neighboring paint, toward the upper-left light.
      let occlusion = 0;
      for (const distance of [2, 4, 7]) {
        const dx = Math.round(distance * unit * 0.63),
          dy = Math.round(distance * unit * 0.77);
        const upstream =
          height[Math.max(0, y - dy) * width + Math.max(0, x - dx)];
        occlusion = Math.max(
          occlusion,
          Math.min(
            1,
            Math.max(
              0,
              (upstream - height[i] - distance * unit * 0.65) / (2 * unit),
            ),
          ),
        );
      }
      const shade = (0.52 + 0.6 * diffuse) * (1 - 0.25 * occlusion);
      for (let c = 0; c < 3; c++) {
        const value = image.data[i * 4 + c];
        image.data[i * 4 + c] = Math.min(
          255,
          value * shade + (255 - value * 0.4) * shine,
        );
      }
    }
  checkpoint("lighting");
  return { pixels: image.data, width, times, ms: performance.now() - started };
}
