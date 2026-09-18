import test from "node:test";
import assert from "node:assert/strict";
import { buildRequests, generate, pack, palette } from "../web/jev.mjs";
import { prepare } from "../web/art.mjs";

test("24x24 batches include every coordinate once and keep all channels together", () => {
  for (const method of ["palette", "hsl", "rgb", "silhouette"]) {
    const requests = buildRequests("a lighthouse", method, 24);
    const questions = requests.flatMap((r) => Object.keys(r.questions));
    assert.equal(
      questions.length,
      576 * (["hsl", "rgb"].includes(method) ? 3 : 1),
    );
    assert.equal(new Set(questions).size, questions.length);
    for (const r of requests) {
      assert.equal(r.state.width, 24);
      assert.match(Object.values(r.questions)[0].instructions, /x=\d+, y=\d+/);
    }
  }
});
test("missing or invalid probabilities fail instead of creating a blank painting", () => {
  assert.throws(() => pack({}, "rgb", 8, "test"));
  assert.throws(() => pack({ x0_y0: { noul: NaN } }, "silhouette", 8, "test"));
  assert.throws(() => buildRequests("", "palette", 24));
});
test("four concurrent requests merge out-of-order answers", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const result = await generate(
    { prompt: "test", method: "palette", size: 32, key: "test-key" },
    async (url, options) => {
      assert.equal(url, "/api/jev");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      active++;
      peak = Math.max(peak, active);
      calls++;
      await new Promise((r) => setTimeout(r, calls % 2 ? 5 : 1));
      const body = JSON.parse(options.body);
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((k) => [
          k,
          { probabilities: { red: 0.6, blue: 0.4 } },
        ]),
      );
      active--;
      return { ok: true, json: async () => ({ answers }) };
    },
  );
  assert.equal(peak, 4);
  assert.equal(calls, 8);
  assert.equal(result.pixels.length, 1024);
  const prepared = prepare(result);
  assert.equal(prepared.pixels.length, 1024);
  assert.equal(
    result.pixels[0].probabilities[Object.keys(palette).indexOf("red")],
    0.6,
  );
});
test("API auth errors have a useful message without exposing the key", async () => {
  await assert.rejects(
    generate(
      { prompt: "test", method: "palette", size: 8, key: "secret" },
      async () => ({ ok: false, status: 401 }),
    ),
    /API key was rejected/,
  );
});
