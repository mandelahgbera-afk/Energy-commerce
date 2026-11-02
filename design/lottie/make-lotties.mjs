// Builds Power Store's own Lottie files, so every animation matches the look and nothing is licensed from elsewhere.
// Run: node design/lottie/make-lotties.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rgb = (hex) => [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).concat(1);
const OUT = { i: { x: [0.2], y: [1] }, o: { x: [0.7], y: [0] } }; // calm ease-out
const OUT3 = { i: { x: [0.2, 0.2, 0.2], y: [1, 1, 1] }, o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] } };

const still = (k) => ({ a: 0, k });
const anim = (frames, ease = OUT) => ({
  a: 1,
  k: frames.map(([t, s], n) => (n < frames.length - 1 ? { t, s: [].concat(s), ...ease } : { t, s: [].concat(s) })),
});
const xf = (o = {}) => ({
  o: o.o ?? still(100), r: still(0), p: o.p ?? still([60, 60, 0]), a: still([0, 0, 0]), s: o.s ?? still([100, 100, 100]),
});
const groupXf = () => ({ ty: "tr", p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100), sk: still(0), sa: still(0) });
const stroke = (hex, w) => ({ ty: "st", c: still(rgb(hex)), o: still(100), w: still(w), lc: 2, lj: 2, ml: 4 });
const fill = (hex) => ({ ty: "fl", c: still(rgb(hex)), o: still(100), r: 1 });
const trim = (e) => ({ ty: "tm", s: still(0), e, o: still(0), m: 1 });
const circle = (d) => ({ ty: "el", p: still([0, 0]), s: still([d, d]), d: 1 });
const roundRect = (w, h, r, p = [0, 0]) => ({ ty: "rc", p: still(p), s: still([w, h]), r: still(r), d: 1 });
const path = (v, closed = false) => {
  const zero = v.map(() => [0, 0]);
  return { ty: "sh", ks: still({ i: zero, o: zero, v, c: closed }) };
};
const shape = (name, items, ks) => ({
  ddd: 0, ty: 4, nm: name, sr: 1, ao: 0, ip: 0, op: 600, st: 0, bm: 0, ks,
  shapes: [{ ty: "gr", nm: name, it: [...items, groupXf()] }],
});
const file = (name, frames, layers) => ({ v: "5.7.4", fr: 60, ip: 0, op: frames, w: 120, h: 120, nm: name, ddd: 0, assets: [], layers });

// Layers are listed front to back, as Lottie paints the last one first.
const tick = (at, hex, w, v = [[-15, 1], [-4, 12], [17, -11]]) =>
  shape("tick", [path(v), stroke(hex, w), trim(anim([[at, 0], [at + 20, 100]]))], xf());

const confirmed = file("confirmed", 60, [
  tick(14, "#FFFFFF", 6),
  shape("disc", [circle(68), fill("#1B5CF0")], xf({ s: anim([[0, [0, 0, 100]], [22, [100, 100, 100]]], OUT3) })),
  shape("halo", [circle(68), fill("#A9C2FA")], xf({ s: anim([[6, [90, 90, 100]], [38, [160, 160, 100]]], OUT3), o: anim([[6, 55], [38, 0]]) })),
]);

const shieldPath = [[0, -34], [26, -24], [26, 2], [18, 19], [0, 34], [-18, 19], [-26, 2], [-26, -24]];
const genuine = file("genuine", 72, [
  tick(26, "#0A6E4B", 5.5, [[-12, 1], [-3, 10], [14, -9]]),
  shape("shield line", [path(shieldPath, true), stroke("#0F8F6B", 3.5), trim(anim([[0, 0], [30, 100]]))], xf()),
  shape("shield fill", [path(shieldPath, true), fill("#DDF3EA")], xf({ o: anim([[14, 0], [34, 100]]) })),
]);

const delivered = file("delivered", 80, [
  shape("tick badge mark", [path([[-6, 0], [-1.5, 4.5], [6.5, -4]]), stroke("#FFFFFF", 3), trim(anim([[44, 0], [58, 100]]))], xf({ p: still([84, 36, 0]) })),
  shape("tick badge", [circle(24), fill("#0F8F6B")], xf({ p: still([84, 36, 0]), s: anim([[36, [0, 0, 100]], [50, [100, 100, 100]]], OUT3) })),
  shape("tape", [roundRect(10, 44, 1), fill("#A9B4BF")], xf({ p: anim([[0, [58, 18, 0]], [26, [58, 66, 0]]], { i: { x: 0.25, y: 1 }, o: { x: 0.6, y: 0 } }) })),
  shape("box", [roundRect(56, 44, 6), fill("#E6EBF0"), stroke("#55606C", 2.5)], xf({ p: anim([[0, [58, 18, 0]], [26, [58, 66, 0]]], { i: { x: 0.25, y: 1 }, o: { x: 0.6, y: 0 } }) })),
  shape("ground", [roundRect(70, 3, 1.5), fill("#C6CED6")], xf({ p: still([58, 92, 0]), o: anim([[14, 0], [26, 100]]) })),
]);

const bagPath = [[-22, -12], [22, -12], [26, 26], [-26, 26]];
const emptyBag = file("empty-bag", 180, [
  shape("handle", [path([[-10, -12], [-10, -20], [-4, -27], [4, -27], [10, -20], [10, -12]]), stroke("#55606C", 3)],
    xf({ p: anim([[0, [60, 56, 0]], [90, [60, 50, 0]], [180, [60, 56, 0]]]) })),
  shape("bag", [path(bagPath, true), fill("#FFFFFF"), stroke("#55606C", 3)],
    xf({ p: anim([[0, [60, 56, 0]], [90, [60, 50, 0]], [180, [60, 56, 0]]]) })),
  shape("shadow", [{ ty: "el", p: still([0, 0]), s: still([52, 6]), d: 1 }, fill("#C6CED6")],
    xf({ p: still([60, 96, 0]), s: anim([[0, [100, 100, 100]], [90, [78, 78, 100]], [180, [100, 100, 100]]], OUT3) })),
]);

const files = { confirmed, genuine, delivered, "empty-bag": emptyBag };
for (const [name, json] of Object.entries(files)) {
  const text = JSON.stringify(json);
  writeFileSync(join(here, `${name}.json`), text);
  console.log(name.padEnd(12), `${text.length} bytes`);
}
