import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The two helpers are pure, so the test extracts them straight from the bundle
// instead of booting a browser. If they are renamed or removed, this fails loudly.
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in lib/client.js`);
  let depth = 0;
  let i = source.indexOf("{", start);
  const from = i;
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not balanced`);
}

const clampOffset = new Function(`${extract("clampOffset")}; return clampOffset;`)();
const alignPadding = new Function(`${extract("clampOffset")}; ${extract("alignPadding")}; return alignPadding;`)();

test("clampOffset bounds every reading", () => {
  assert.equal(clampOffset(-12), 0);
  assert.equal(clampOffset(Number.NaN), 0);
  assert.equal(clampOffset(9999), 120);
  assert.equal(clampOffset(10), 10);
});

test("alignPadding depends only on the distance to the panel column", () => {
  assert.equal(alignPadding(22, 0, 12), 10);   // icon 22, row starts at 12
  assert.equal(alignPadding(62, 40, 52), 10);  // sidebar slid 40px: same answer
  assert.equal(alignPadding(22, 0, 22), 0);    // already aligned
});

test("repeated passes cannot drift", () => {
  const rowLeft = 12;
  let pad = 8;
  for (let pass = 0; pass < 50; pass += 1) {
    const want = alignPadding(22, 0, rowLeft);
    if (Math.abs(want - pad) >= 0.5) pad = want;
  }
  assert.equal(pad, 10, "padding must settle, not grow");
});

test("a bad or collapsed reading never yields a negative offset", () => {
  assert.equal(alignPadding(22, 0, 0), 22);
  assert.ok(alignPadding(0, 0, 0) >= 0);
  assert.equal(alignPadding(46, 0, 500), 0);   // element reported far right
});

test("the show-more link lands on the title column", () => {
  assert.equal(alignPadding(46, 0, 12), 34);
});
