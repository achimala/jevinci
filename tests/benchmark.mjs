import fs from "node:fs";
import assert from "node:assert/strict";
import { renderPaint } from "../web/renderer.mjs";
for (const method of ["palette", "hsl", "rgb", "silhouette"]) {
  const data = JSON.parse(
    fs.readFileSync(new URL(`fixtures/${method}.json`, import.meta.url)),
  );
  const result = renderPaint(data);
  assert.equal(result.pixels.length, 560 * 560 * 4);
  assert.ok(result.pixels.every((value, i) => i % 4 !== 3 || value === 255));
  console.log(`${method}: ${Math.round(result.ms)} ms`, result.times);
}
