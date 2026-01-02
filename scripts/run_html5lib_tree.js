import fs from "node:fs";
import path from "node:path";
import { JustHTML } from "../src/index.js";
import { FragmentContext } from "../src/context.js";

function parseTests(contents) {
  const blocks = contents.trimEnd().split("\n\n");
  const tests = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    let i = 0;
    let data = "";
    let errors = [];
    let newErrors = [];
    let docLines = [];
    let fragmentContext = null;
    let script = null;

    while (i < lines.length) {
      const line = lines[i];
      if (line === "#data") {
        i += 1;
        const dataLines = [];
        while (i < lines.length && !lines[i].startsWith("#")) {
          dataLines.push(lines[i]);
          i += 1;
        }
        data = dataLines.join("\n");
        continue;
      }
      if (line === "#errors") {
        i += 1;
        const errLines = [];
        while (i < lines.length && !lines[i].startsWith("#")) {
          errLines.push(lines[i]);
          i += 1;
        }
        errors = errLines.filter(Boolean);
        continue;
      }
      if (line === "#new-errors") {
        i += 1;
        const errLines = [];
        while (i < lines.length && !lines[i].startsWith("#")) {
          errLines.push(lines[i]);
          i += 1;
        }
        newErrors = errLines.filter(Boolean);
        continue;
      }
      if (line === "#document-fragment") {
        const contextLine = lines[i + 1] ?? "";
        let ns = null;
        let tag = contextLine;
        if (contextLine.startsWith("svg ")) {
          ns = "svg";
          tag = contextLine.slice(4);
        } else if (contextLine.startsWith("math ")) {
          ns = "math";
          tag = contextLine.slice(5);
        }
        fragmentContext = new FragmentContext(tag, { namespace: ns });
        i += 2;
        continue;
      }
      if (line === "#script-on") {
        script = "on";
        i += 1;
        continue;
      }
      if (line === "#script-off") {
        script = "off";
        i += 1;
        continue;
      }
      if (line === "#document") {
        i += 1;
        const doc = [];
        while (i < lines.length && !lines[i].startsWith("#")) {
          doc.push(lines[i]);
          i += 1;
        }
        docLines = doc;
        continue;
      }
      i += 1;
    }

    tests.push({ data, errors: errors.concat(newErrors), docLines, fragmentContext, script });
  }

  return tests;
}

function dumpNode(node, depth, lines) {
  if (node.name === "#document" || node.name === "#document-fragment") {
    for (const child of node.children || []) {
      dumpNode(child, depth, lines);
    }
    return;
  }

  const indent = "  ".repeat(depth);

  if (node.name === "#text") {
    lines.push(`| ${indent}\"${node.data ?? ""}\"`);
    return;
  }

  if (node.name === "#comment") {
    lines.push(`| ${indent}<!-- ${node.data ?? ""} -->`);
    return;
  }

  if (node.name === "!doctype") {
    const dt = node.data;
    if (!dt) {
      lines.push(`| ${indent}<!DOCTYPE html>`);
      return;
    }
    const name = dt.name || "";
    const publicId = dt.public_id || "";
    const systemId = dt.system_id || "";
    if (!publicId && !systemId) {
      lines.push(`| ${indent}<!DOCTYPE ${name}>`);
    } else {
      lines.push(`| ${indent}<!DOCTYPE ${name} \"${publicId}\" \"${systemId}\">`);
    }
    return;
  }

  let tagPrefix = "";
  if (node.namespace === "svg") tagPrefix = "svg ";
  if (node.namespace === "math") tagPrefix = "math ";
  lines.push(`| ${indent}<${tagPrefix}${node.name}>`);

  if (node.attrs) {
    const attrNames = Object.keys(node.attrs).sort();
    for (const name of attrNames) {
      lines.push(`| ${indent}  ${name}=\"${node.attrs[name]}\"`);
    }
  }

  if (node.template_content) {
    lines.push(`| ${indent}  content`);
    dumpNode(node.template_content, depth + 2, lines);
  }

  for (const child of node.children || []) {
    dumpNode(child, depth + 1, lines);
  }
}

function dumpTree(root) {
  const lines = [];
  dumpNode(root, 0, lines);
  return lines.join("\n");
}

function runFile(filePath, { limit = null } = {}) {
  const contents = fs.readFileSync(filePath, "utf8");
  const tests = parseTests(contents);
  let passed = 0;
  let failed = 0;
  const failures = [];

  const max = limit ? Math.min(limit, tests.length) : tests.length;

  for (let idx = 0; idx < max; idx += 1) {
    const test = tests[idx];
    const doc = new JustHTML(test.data, {
      fragmentContext: test.fragmentContext,
      fragment: Boolean(test.fragmentContext),
      collectErrors: true,
    });
    const actual = dumpTree(doc.root);
    const expected = test.docLines.join("\n");
    if (actual === expected) {
      passed += 1;
    } else {
      failed += 1;
      failures.push({ index: idx, actual, expected });
    }
  }

  return { passed, failed, failures, total: max };
}

function main() {
  const args = process.argv.slice(2);
  const fileArg = args[0];
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;

  if (!fileArg) {
    console.error("usage: node scripts/run_html5lib_tree.js <file.dat> [--limit=N]");
    process.exit(2);
  }

  const filePath = path.resolve(fileArg);
  const result = runFile(filePath, { limit });
  console.log(`${path.basename(filePath)}: ${result.passed}/${result.total} passed`);
  if (result.failed) {
    const first = result.failures[0];
    console.log(`first failure index: ${first.index}`);
    console.log("expected:\n" + first.expected);
    console.log("actual:\n" + first.actual);
    process.exit(1);
  }
}

main();
