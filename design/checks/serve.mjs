// Serves design/screens for the checks in run.mjs. The screens need the canvas's runtime, which is not kept in this repo:
// fetch artifact-type/dc-runtime.js from the design canvas, and lottie_light.min.js from the lottie-web package.
// Usage: DC_RUNTIME=/path/dc-runtime.js LOTTIE_PLAYER=/path/lottie_light.min.js node design/checks/serve.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(here, "..", "screens");
const lottie = join(here, "..", "lottie");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };
const blobs = {
  "8894df7a6a20de073c579d8151803290": process.env.LOTTIE_PLAYER,
  "21dabc68a83f1dbda6cac29c53bc20a1": join(lottie, "confirmed.json"),
  e82edc91a48d7f6e92feaa4b81abf718: join(lottie, "genuine.json"),
  d958c69b62fe952ba71f58e4d9f56e3e: join(lottie, "delivered.json"),
  a9eb19d879e12d2c46e8f3e8322d658f: join(lottie, "empty-bag.json"),
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file;
  if (path === "/support.js") file = process.env.DC_RUNTIME;
  else if (path.startsWith("/_blob/")) file = blobs[path.slice(7)];
  else file = join(screens, path === "/" ? "Main.dc.html" : path.slice(1));
  if (!file) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(4173, "127.0.0.1", () => console.log("designs on http://127.0.0.1:4173"));
