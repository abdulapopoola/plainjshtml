const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

class SimpleDomNode {
  constructor({ name, attrs = null, parent = null, text = "" }) {
    this.name = name;
    this.attrs = attrs || {};
    this.children = [];
    this.parent = parent;
    this.text = text;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  toHTML({ indent = 2 } = {}) {
    return serializeNode(this, indent, 0);
  }

  toText({ separator = " ", strip = true } = {}) {
    const parts = [];
    collectText(this, parts, strip);
    return parts.join(separator);
  }
}

class JustHTML {
  constructor(html, { fragment = false } = {}) {
    this.root = new SimpleDomNode({
      name: fragment ? "#document-fragment" : "#document",
    });
    parseHTMLSimple(html, this.root);
  }

  toHTML({ indent = 2 } = {}) {
    return this.root.toHTML({ indent });
  }

  toText({ separator = " ", strip = true } = {}) {
    return this.root.toText({ separator, strip });
  }
}

function parseHTMLSimple(html, root) {
  const stack = [root];
  const tagRe = /<[^>]*>/g;
  let lastIndex = 0;

  for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
    const tag = match[0];
    if (match.index > lastIndex) {
      const text = html.slice(lastIndex, match.index);
      appendTextNode(stack[stack.length - 1], text);
    }

    if (tag.startsWith("</")) {
      const name = tag.slice(2, -1).trim().toLowerCase();
      closeElement(stack, name);
    } else if (tag.startsWith("<!--")) {
      // Ignore comments in the minimal parser.
    } else if (tag.startsWith("<!")) {
      // Ignore doctype in the minimal parser.
    } else {
      const { name, attrs, selfClosing } = parseStartTag(tag);
      const node = new SimpleDomNode({ name, attrs });
      stack[stack.length - 1].appendChild(node);
      if (!selfClosing && !VOID_ELEMENTS.has(name)) {
        stack.push(node);
      }
    }

    lastIndex = tagRe.lastIndex;
  }

  if (lastIndex < html.length) {
    appendTextNode(stack[stack.length - 1], html.slice(lastIndex));
  }
}

function parseStartTag(tag) {
  const inner = tag.slice(1, -1).trim();
  const selfClosing = inner.endsWith("/");
  const content = selfClosing ? inner.slice(0, -1).trim() : inner;
  const parts = content.split(/\s+/, 2);
  const name = parts[0].toLowerCase();
  const attrs = {};
  const attrText = content.slice(name.length).trim();

  if (attrText) {
    const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = attrRe.exec(attrText))) {
      const key = match[1];
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[key] = value;
    }
  }

  return { name, attrs, selfClosing };
}

function closeElement(stack, name) {
  for (let i = stack.length - 1; i > 0; i -= 1) {
    if (stack[i].name === name) {
      stack.splice(i);
      return;
    }
  }
}

function appendTextNode(parent, text) {
  if (!text) return;
  const node = new SimpleDomNode({ name: "#text", text });
  parent.appendChild(node);
}

function collectText(node, parts, strip) {
  if (node.name === "#text") {
    const value = strip ? node.text.trim() : node.text;
    if (value) {
      parts.push(value);
    }
  }
  for (const child of node.children) {
    collectText(child, parts, strip);
  }
}

function serializeNode(node, indent, depth) {
  if (node.name === "#document" || node.name === "#document-fragment") {
    return node.children.map((child) => serializeNode(child, indent, depth)).join("");
  }

  if (node.name === "#text") {
    return escapeText(node.text);
  }

  const pad = indent > 0 ? " ".repeat(indent * depth) : "";
  const newline = indent > 0 ? "\n" : "";
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");

  if (node.children.length === 0 || VOID_ELEMENTS.has(node.name)) {
    return `${pad}<${node.name}${attrs}>${newline}`;
  }

  const inner = node.children
    .map((child) => serializeNode(child, indent, depth + 1))
    .join("");
  const endPad = indent > 0 ? pad : "";
  return `${pad}<${node.name}${attrs}>${newline}${inner}${endPad}</${node.name}>${newline}`;
}

function escapeText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { JustHTML, SimpleDomNode };
