import assert from "node:assert/strict";
import { JustHTML } from "../src/index.js";

const html = "<div id=\"main\"><p>Hello <b>world</b>!</p></div>";
const doc = new JustHTML(html);

assert.equal(doc.root.name, "#document");

const outHtml = doc.toHTML({ indent: 0, pretty: false });
assert.equal(outHtml, "<div id=\"main\"><p>Hello <b>world</b>!</p></div>");

const outText = doc.toText();
assert.equal(outText, "Hello world !");

console.log("smoke test passed");
