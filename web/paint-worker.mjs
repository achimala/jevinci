import { renderPaint } from "./renderer.mjs";
onmessage = ({ data: { id, result } }) => {
  try {
    const { pixels, width, ms } = renderPaint(result, 560);
    const canvas = new OffscreenCanvas(width, width);
    canvas
      .getContext("2d")
      .putImageData(new ImageData(pixels, width, width), 0, 0);
    const bitmap = canvas.transferToImageBitmap();
    postMessage({ id, bitmap, ms }, [bitmap]);
  } catch (error) {
    postMessage({ id, error: error.message });
  }
};
