import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// findTabStrip() reads a small, fixed slice of the DOM: the conversation slot,
// its header, the tab list and that list's parent. Plain objects stand in for
// those elements, so the lookup can be tested without a browser.
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in lib/client.js`);
  let depth = 0;
  let i = source.indexOf("{", start);
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not balanced`);
}

const findTabStrip = new Function(
  "document",
  `${extract("findTabStrip")}; return findTabStrip();`
);

function element(options = {}) {
  return {
    tagName: options.tagName ?? "DIV",
    className: options.className ?? "",
    textContent: options.textContent ?? "",
    children: options.children ?? [],
    parentElement: options.parentElement ?? null,
    querySelector: () => options.querySelector ?? null,
    querySelectorAll: () => options.querySelectorAll ?? [],
    contains: (node) => options.contains ? options.contains(node) : false,
  };
}

function documentWith(header) {
  return {
    querySelector(selector) {
      return selector === '[data-slot="main.conversation"]' ? { querySelector: () => header } : null;
    },
  };
}

test("the row that owns the tab list is returned, not the list itself", () => {
  const list = element({ role: "tablist" });
  const more = element({ tagName: "BUTTON", className: "viewsMore" });
  const row = element({ children: [list, more] });
  list.parentElement = row;
  const header = element({
    querySelector: list,
    querySelectorAll: [],
    contains: () => true,
  });
  assert.equal(findTabStrip(documentWith(header)), row);
});

test("the older shape detection still finds a row of tab buttons", () => {
  const tabA = element({ tagName: "BUTTON", textContent: "对话" });
  const tabB = element({ tagName: "BUTTON", textContent: "轨迹" });
  const list = element({ children: [tabA, tabB] });
  const row = element({ children: [list] });
  list.parentElement = row;
  const header = element({
    querySelector: null,
    querySelectorAll: [list],
    contains: () => true,
  });
  assert.equal(findTabStrip(documentWith(header)), row);
});

test("a tab list parented by the header itself is returned as-is", () => {
  const list = element({});
  const header = element({
    querySelector: list,
    querySelectorAll: [],
    contains: () => true,
  });
  list.parentElement = header;
  assert.equal(findTabStrip(documentWith(header)), list);
});

test("no header or no tabs yields null", () => {
  const header = element({ querySelector: null, querySelectorAll: [] });
  assert.equal(findTabStrip(documentWith(header)), null);
  assert.equal(findTabStrip({ querySelector: () => null }), null);
});
