# Jevinci

A small local app that turns Jev's pixel probability distributions into paintings.

## Run

Requires Python 3.9+ and a modern browser with module workers and OffscreenCanvas
(current Chrome, Edge, Firefox, or Safari). No packages, build step, or Node installation needed.

```sh
python3 server.py
```

Open **http://127.0.0.1:8791**, open Settings, and paste your Jev API key.
Choose a representation and grid size, then enter a prompt. Each painting joins
an in-memory carousel. The key is saved in this browser’s local storage; clear the key field to forget it.
Paintings are cleared when you reload.
Generation uses your TypeSafe account. Stop the helper with Ctrl+C.
Use `python3 server.py --port 8795` if the default port is occupied.

All question construction, batching, probability processing, and painting run in
the browser. A Python standard-library helper serves the files and forwards
requests to the fixed Jev endpoint because its API currently disallows browser
CORS origins. It binds only to loopback, checks the request origin, and neither
stores nor logs keys or prompts. No environment variables are required.

## Rendering

The same algorithm handles palette, HSL, binary RGB, and silhouettes. HSL/RGB
channel probabilities are combined assuming independence; Jev does not supply a
joint distribution. Spatially correlated categorical sampling supplies stroke
pigments, mean color supplies the underpainting, and entropy controls relief.
Strokes follow local luminance contours; a height map supplies impasto lighting.
This is an artistic transformation, not a lossless probability chart.

Painting runs in a module worker at 560×560. Pigments are sampled lazily and cached,
and stroke segment geometry is precomputed. The completed textured painting fades
in over 550 ms. Network/model time is separate from rendering time.

## Code

- `server.py`: static files and fixed-destination API forwarding
- `web/jev.mjs`: typed questions, four concurrent batches, validated results
- `web/art.mjs`: probability representations
- `web/renderer.mjs`: deterministic painting algorithm
- `web/paint-worker.mjs`: off-main-thread rendering
- `web/app.mjs`, `index.html`, `style.css`: gallery and prompt UI

## Checks (Node 18+)

```sh
node --test tests/jev.test.mjs
node tests/benchmark.mjs
python3 -B -m unittest discover -s tests -p 'test_*.py'
```

Four small recorded probability fixtures are retained for offline rendering checks.
These contain public art prompts and model probabilities, with no credentials or
account metadata. Tests and benchmarks run offline and incur no API charges.

## Privacy and local use

Your API key is stored in browser localStorage for this origin, not encrypted.
Clear the key field to remove it. Use your own computer/browser profile. The local
helper holds the key only while forwarding a request; prompts and keys are sent
only to TypeSafe. Changing the port or using `localhost` instead of `127.0.0.1`
uses a separate browser storage origin.

This is a local creative experiment, not a publicly hosted multi-user service.
Keep the helper bound to loopback. Model requests cost tokens; larger grids make
more requests. Rendering time and model/network latency are independent.

## Contributing

Small fixes and renderer experiments are welcome. Run the checks above before
opening a pull request. Preserve the offline fixtures, avoid committing API keys
or personal generated outputs, and describe visual changes with before/after
images when useful. Browser code uses ES modules with no runtime dependencies.

## License

MIT — see [LICENSE](LICENSE). Jev is a TypeSafe service and requires your own API
access; this project is independent of TypeSafe.
