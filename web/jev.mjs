import { normalized } from "./art.mjs";

export const palette = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  gray: [128, 128, 128],
  red: [220, 40, 40],
  orange: [255, 150, 40],
  pink: [255, 170, 190],
  brown: [125, 70, 35],
  tan: [205, 160, 105],
  green: [65, 165, 65],
  dark_green: [25, 90, 35],
  blue: [45, 90, 210],
  sky_blue: [170, 220, 255],
  yellow: [255, 215, 40],
  purple: [110, 45, 160],
  navy: [15, 20, 50],
  cream: [255, 240, 205],
};
const hues = [
  "neutral",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "magenta",
];
export const sizes = [8, 12, 16, 24, 32];
const batchPixels = { palette: 144, hsl: 144, rgb: 256, silhouette: 1024 };
const criteria = (labels) =>
  Object.fromEntries(labels.map((label) => [label, null]));

export function buildRequests(prompt, method, size) {
  if (!Object.hasOwn(batchPixels, method) || !sizes.includes(size))
    throw Error("Unsupported representation or grid size.");
  if (!prompt.trim() || prompt.length > 2000)
    throw Error("Enter a prompt of up to 2,000 characters.");
  const state = {
    image_description: prompt.trim(),
    width: size,
    height: size,
    coordinates: "Origin (0,0) top-left, x increases right, y increases down.",
    task: "Compose one coherent recognizable pixel-art image. Fill the canvas including background. No text or border.",
  };
  if (method === "silhouette")
    state.task =
      "Compose a recognizable black silhouette on white. Fit the subject with a small margin. No scenery, shadow, text or border.";
  if (method === "rgb")
    state.task +=
      " Each RGB channel is OFF (0) or ON (255). Together they select black, red, green, blue, yellow, cyan, magenta or white. Choose the closest available color.";
  const questions = {};
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const key = `x${x}_y${y}`,
        loc = `x=${x}, y=${y}`;
      if (method === "palette")
        questions[key] = {
          type: "choice",
          instructions: `What color is pixel (${loc}) in the described image?`,
          criteria: criteria(Object.keys(palette)),
        };
      else if (method === "silhouette")
        questions[key] = {
          type: "noul",
          instructions: `Is pixel (${loc}) inside the foreground silhouette described in state?`,
        };
      else if (method === "rgb")
        for (const channel of ["red", "green", "blue"])
          questions[`${key}_${channel}`] = {
            type: "noul",
            instructions: `Should the ${channel} channel be ON at pixel (${loc}) in the described image?`,
          };
      else {
        questions[`${key}_hue`] = {
          type: "choice",
          instructions: `What is the hue at pixel (${loc})? Ignore brightness; choose neutral for white, gray or black.`,
          criteria: criteria(hues),
        };
        questions[`${key}_saturation`] = {
          type: "score",
          instructions: `How saturated is the color at pixel (${loc})?`,
          criteria: [
            "Achromatic gray, zero saturation",
            "Muted or pastel, half saturation",
            "Pure vivid color, full saturation",
          ],
        };
        questions[`${key}_lightness`] = {
          type: "score",
          instructions: `What is the HSL lightness at pixel (${loc})?`,
          criteria: [
            "Black, lightness 0",
            "Dark, lightness 0.25",
            "Middle lightness 0.5",
            "Light, lightness 0.75",
            "White, lightness 1",
          ],
        };
      }
    }
  const entries = Object.entries(questions),
    count = batchPixels[method] * (["rgb", "hsl"].includes(method) ? 3 : 1),
    batches = [];
  for (let i = 0; i < entries.length; i += count)
    batches.push({
      model: "jev-latest",
      state,
      questions: Object.fromEntries(entries.slice(i, i + count)),
    });
  return batches;
}

function probability(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw Error("Jev returned an invalid probability.");
  return value;
}
function distribution(answer, labels) {
  if (!answer?.probabilities)
    throw Error("Jev returned an incomplete distribution.");
  return normalized(
    labels.map((label) => probability(answer.probabilities[label] ?? 0)),
  );
}
export function pack(answers, method, size, prompt) {
  const pixels = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const key = `x${x}_y${y}`;
      if (method === "palette")
        pixels.push({
          probabilities: distribution(answers[key], Object.keys(palette)),
        });
      else if (method === "hsl")
        pixels.push({
          hue: distribution(answers[`${key}_hue`], hues),
          saturation: distribution(answers[`${key}_saturation`], [
            "0",
            "1",
            "2",
          ]),
          lightness: distribution(answers[`${key}_lightness`], [
            "0",
            "1",
            "2",
            "3",
            "4",
          ]),
        });
      else if (method === "rgb")
        pixels.push({
          channels: ["red", "green", "blue"].map((c) =>
            probability(answers[`${key}_${c}`]?.noul),
          ),
        });
      else pixels.push({ foreground: probability(answers[key]?.noul) });
    }
  return { method, size, prompt, pixels, palette: Object.values(palette) };
}

// Independent batches share the full composition and global coordinates.
export async function generate({ prompt, method, size, key }, fetcher = fetch) {
  const batches = buildRequests(prompt, method, size),
    answers = {},
    controller = new AbortController();
  let next = 0;
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, batches.length) }, async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          const response = await fetcher("/api/jev", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(batch),
            signal: controller.signal,
          });
          if (!response.ok) {
            const messages = {
              401: "API key was rejected. Check the key in Settings.",
              403: "Jev denied access for this key.",
              429: "Jev is rate limiting requests. Please try again shortly.",
              413: "Request is too large. Try a smaller grid.",
            };
            throw Error(
              messages[response.status] ||
                `Jev request failed (HTTP ${response.status}).`,
            );
          }
          const data = await response.json();
          if (!data.answers) throw Error("Jev returned no answers.");
          Object.assign(answers, data.answers);
        }
      }),
    );
    return pack(answers, method, size, prompt);
  } catch (error) {
    controller.abort();
    if (error.name === "AbortError")
      throw Error("The request timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
