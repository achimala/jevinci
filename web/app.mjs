import { generate, sizes } from "./jev.mjs";

const $ = (id) => document.getElementById(id);
const results = [];
let selected = 0,
  busy = false,
  worker = null,
  job = 0;
const jobs = new Map();

// Persist only on this browser origin; deleting the field forgets the key.
const keyStorage = "jev-studio-api-key";
try {
  $("apiKey").value = localStorage.getItem(keyStorage) || "";
} catch {
  // Private/restricted storage still permits using the key for this session.
}
$("apiKey").addEventListener("input", () => {
  try {
    const key = $("apiKey").value.trim();
    if (key) localStorage.setItem(keyStorage, key);
    else localStorage.removeItem(keyStorage);
  } catch {
    status("Browser storage is unavailable. Your key will last only for this tab.");
  }
});


function status(message = "") {
  $("status").textContent = message;
}
function sidebar(open) {
  $("sidebar").hidden = !open;
  $("toggle").setAttribute("aria-expanded", String(open));
  if (!open) $("toggle").focus();
}
function navigate(index) {
  selected = Math.max(0, Math.min(results.length - 1, index));
  const cards = [...$("track").children];
  cards.forEach((card, i) => card.classList.toggle("active", i === selected));
  const card = cards[selected];
  if (!card) return;
  const gap = parseFloat(getComputedStyle($("track")).gap);
  $("track").style.transform =
    `translateX(${-selected * (card.offsetWidth + gap)}px)`;
  $("position").textContent = `${selected + 1} / ${results.length}`;
  $("previous").disabled = selected === 0;
  $("next").disabled = selected === results.length - 1;
  $("navigation").hidden = results.length < 2;
}
function begin() {
  const card = document.createElement("div");
  card.className = "art-card active loading";
  card.setAttribute("aria-label", "Generating painting");
  card.innerHTML =
    '<div class="canvas-bottom" aria-hidden="true"></div><div class="loading-wash" aria-hidden="true"></div>';
  if (!results.length) $("track").replaceChildren(card);
  else $("track").append(card);
  results.push(card);
  navigate(results.length - 1);
  $("carousel").setAttribute("aria-busy", "true");
  return card;
}
function render(result) {
  if (!worker) {
    worker = new Worker(new URL("./paint-worker.mjs", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const pending = jobs.get(data.id);
      jobs.delete(data.id);
      if (!pending) {
        data.bitmap?.close();
        return;
      }
      if (data.error) pending.reject(Error(data.error));
      else pending.resolve(data);
    };
    worker.onerror = () => {
      for (const pending of jobs.values())
        pending.reject(Error("Could not start the painting renderer."));
      jobs.clear();
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++job;
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, result });
  });
}
async function paint(result, card) {
  const start = performance.now();
  const { bitmap, ms } = await render(result);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = bitmap.width;
  canvas.setAttribute("aria-label", result.prompt);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  canvas.dataset.renderMs = Math.round(ms);
  canvas.dataset.totalMs = Math.round(performance.now() - start);
  card.querySelector(".loading-wash")?.remove();
  card.append(canvas);
  card.classList.remove("loading");
  card.setAttribute("aria-label", result.prompt);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    canvas.animate(
      [
        { opacity: 0, filter: "blur(10px)" },
        { opacity: 1, filter: "blur(0px)" },
      ],
      { duration: 550, easing: "ease-out" },
    );
}

$("promptForm").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  const prompt = $("prompt").value.trim(),
    key = $("apiKey").value.trim();
  if (!prompt) return;
  if (!key) {
    sidebar(true);
    $("apiKey").focus();
    status("Paste your Jev API key to start.");
    return;
  }
  busy = true;
  $("generate").disabled = true;
  status();
  const card = begin();
  try {
    const result = await generate({
      prompt,
      key,
      method: $("method").value,
      size: Number($("size").value),
    });
    await paint(result, card);
  } catch (error) {
    card.remove();
    results.pop();
    if (results.length) navigate(results.length - 1);
    else {
      $("track").innerHTML =
        '<div class="art-card active blank"><div class="canvas-bottom"></div></div>';
      $("track").style.transform = "";
      $("navigation").hidden = true;
    }
    status(error.message);
  } finally {
    busy = false;
    $("generate").disabled = false;
    $("carousel").setAttribute("aria-busy", "false");
  }
};
$("size").replaceChildren(
  ...sizes.map((size) => new Option(`${size} × ${size}`, size)),
);
$("size").value = "24";
$("previous").onclick = () => navigate(selected - 1);
$("next").onclick = () => navigate(selected + 1);
$("toggle").onclick = () => sidebar($("sidebar").hidden);
$("close").onclick = () => sidebar(false);
$("prompt").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("promptForm").requestSubmit();
  }
};
window.addEventListener("resize", () => {
  if (results.length) navigate(selected);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("sidebar").hidden) sidebar(false);
});
