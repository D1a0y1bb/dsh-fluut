import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The lookup helpers only touch `children`, `parentElement`, `className`,
// `attributes` and `querySelectorAll`, so a handful of plain objects exercises
// them without a browser. The two helpers are sliced out of the shipped bundle
// the same way alignment.test.mjs does it.
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

const HIDE_ATTR = "data-sbt-hidden";
const HIDEROW_ATTR = "data-sbt-hiderow";
const findNewSession = new Function(
  `var HIDE_ATTR = ${JSON.stringify(HIDE_ATTR)}; ${extract("findNewSession")}; return findNewSession;`
)();
const collapseEmptyRow = new Function(
  `var HIDE_ATTR = ${JSON.stringify(HIDE_ATTR)}; var HIDEROW_ATTR = ${JSON.stringify(HIDEROW_ATTR)}; ` +
    `${extract("collapseEmptyRow")}; return collapseEmptyRow;`
)();

/** A stand-in element with just the surface the helpers read. */
function node(options = {}) {
  const attributes = new Map();
  return {
    tagName: options.tagName ?? "DIV",
    className: options.className ?? "",
    children: options.children ?? [],
    parentElement: options.parentElement ?? null,
    buttons: options.buttons ?? [],
    others: options.others ?? [],
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value = "") => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    querySelectorAll(selector) {
      return selector === "button" ? this.buttons : this.others;
    },
  };
}

test("a nested new-session button is found, not only a direct child", () => {
  const button = node({ tagName: "BUTTON", className: "kB3qhq_newSession" });
  const row = node({ buttons: [button] });
  const root = node({ children: [row], buttons: [button] });
  assert.equal(findNewSession(root), button);
});

test("a plain direct child button still works on the old layout", () => {
  const button = node({ tagName: "BUTTON", className: "old_newSession" });
  const root = node({ children: [button], buttons: [] });
  assert.equal(findNewSession(root), button);
});

test("an unrelated direct child button is the last resort only", () => {
  const stray = node({ tagName: "BUTTON", className: "noise" });
  const root = node({ children: [stray], buttons: [] });
  assert.equal(findNewSession(root), stray);
});

test("nothing to hide yields null instead of throwing", () => {
  assert.equal(findNewSession(node()), null);
});

test("the fallback never swallows the collapse toggle", () => {
  const toggle = node({ tagName: "BUTTON", className: "kB3qhq_iconButton kB3qhq_toggle" });
  assert.equal(findNewSession(node({ children: [toggle], buttons: [] })), null);
});

test("the emptied row is collapsed when no other control lives in it", () => {
  const button = node({ tagName: "BUTTON" });
  const root = node();
  const row = node({ others: [] });
  row.parentElement = root;
  const anchor = node({ others: [] });
  anchor.parentElement = row;
  button.parentElement = anchor;
  collapseEmptyRow(button, root);
  assert.equal(row.hasAttribute(HIDEROW_ATTR), true);
});

test("a row shared with another plugin action stays visible", () => {
  const button = node({ tagName: "BUTTON" });
  const other = node({ tagName: "BUTTON", className: "other-action" });
  const root = node();
  const row = node({ others: [other] });
  row.parentElement = root;
  button.parentElement = row;
  collapseEmptyRow(button, root);
  assert.equal(row.hasAttribute(HIDEROW_ATTR), false);
});

test("a direct child button has no row to collapse", () => {
  const button = node({ tagName: "BUTTON" });
  const root = node();
  button.parentElement = root;
  collapseEmptyRow(button, root);
  assert.equal(button.hasAttribute(HIDEROW_ATTR), false);
});
