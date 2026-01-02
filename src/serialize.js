import { FOREIGN_ATTRIBUTE_ADJUSTMENTS, SPECIAL_ELEMENTS, VOID_ELEMENTS } from "./constants.js";
import { DEFAULT_DOCUMENT_POLICY, DEFAULT_POLICY, sanitize } from "./sanitize.js";

function escapeText(text) {
  if (!text) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chooseAttrQuote(value, forcedQuoteChar = null) {
  if (forcedQuoteChar === '"' || forcedQuoteChar === "'") {
    return forcedQuoteChar;
  }
  if (value == null) {
    return '"';
  }
  const stringValue = String(value);
  if (stringValue.includes('"') && !stringValue.includes("'")) {
    return "'";
  }
  return '"';
}

function escapeAttrValue(value, quoteChar, { escapeLtInAttrs = false } = {}) {
  if (value == null) return "";
  let out = String(value).replace(/&/g, "&amp;");
  if (escapeLtInAttrs) {
    out = out.replace(/</g, "&lt;");
  }
  if (quoteChar === '"') {
    return out.replace(/"/g, "&quot;");
  }
  return out.replace(/'/g, "&#39;");
}

function canUnquoteAttrValue(value) {
  if (value == null) return false;
  const stringValue = String(value);
  for (const ch of stringValue) {
    if (ch === ">") return false;
    if (ch === '"' || ch === "'" || ch === "=") return false;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\f" || ch === "\r") {
      return false;
    }
  }
  return true;
}

function serializerMinimizeAttrValue(name, value, minimizeBooleanAttributes) {
  if (!minimizeBooleanAttributes) return false;
  if (value == null || value === "") return true;
  return String(value).toLowerCase() === String(name).toLowerCase();
}

export function serializeStartTag(
  name,
  attrs,
  {
    quoteAttrValues = true,
    minimizeBooleanAttributes = true,
    quoteChar = null,
    escapeLtInAttrs = false,
    useTrailingSolidus = false,
    isVoid = false,
  } = {},
) {
  const safeAttrs = attrs || {};
  const parts = ["<", name];
  for (const [key, value] of Object.entries(safeAttrs)) {
    if (serializerMinimizeAttrValue(key, value, minimizeBooleanAttributes)) {
      parts.push(" ", key);
      continue;
    }

    if (value == null || String(value) === "") {
      parts.push(" ", key, '=""');
      continue;
    }

    const valueStr = String(value);
    if (!quoteAttrValues && canUnquoteAttrValue(valueStr)) {
      let escaped = valueStr.replace(/&/g, "&amp;");
      if (escapeLtInAttrs) {
        escaped = escaped.replace(/</g, "&lt;");
      }
      parts.push(" ", key, "=", escaped);
    } else {
      const quote = chooseAttrQuote(valueStr, quoteChar);
      const escaped = escapeAttrValue(valueStr, quote, { escapeLtInAttrs });
      parts.push(" ", key, "=", quote, escaped, quote);
    }
  }

  if (useTrailingSolidus && isVoid) {
    parts.push(" />");
  } else {
    parts.push(">");
  }
  return parts.join("");
}

export function serializeEndTag(name) {
  return `</${name}>`;
}

const PREFORMATTED_ELEMENTS = new Set(["pre", "textarea", "code"]);
const RAWTEXT_ELEMENTS = new Set(["script", "style"]);

function collapseHtmlWhitespace(text) {
  if (!text) return "";

  const parts = [];
  let inWhitespace = false;
  for (const ch of text) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\f" || ch === "\r") {
      if (!inWhitespace) {
        parts.push(" ");
        inWhitespace = true;
      }
      continue;
    }
    parts.push(ch);
    inWhitespace = false;
  }

  return parts.join("").trim();
}

function normalizeFormattingWhitespace(text) {
  if (!text) return "";
  if (!text.includes("\n") && !text.includes("\r") && !text.includes("\t") && !text.includes("\f")) {
    return text;
  }

  const startsWithFormatting = ["\n", "\r", "\t", "\f"].includes(text[0]);
  const endsWithFormatting = ["\n", "\r", "\t", "\f"].includes(text[text.length - 1]);

  const out = [];
  let inWs = false;
  let sawFormattingWs = false;

  for (const ch of text) {
    if (ch === " ") {
      if (inWs) {
        if (sawFormattingWs) {
          continue;
        }
        out.push(" ");
        continue;
      }
      inWs = true;
      sawFormattingWs = false;
      out.push(" ");
      continue;
    }

    if (ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f") {
      if (inWs) {
        sawFormattingWs = true;
        continue;
      }
      inWs = true;
      sawFormattingWs = true;
      out.push(" ");
      continue;
    }

    inWs = false;
    sawFormattingWs = false;
    out.push(ch);
  }

  let result = out.join("");
  if (startsWithFormatting && result.startsWith(" ")) {
    result = result.slice(1);
  }
  if (endsWithFormatting && result.endsWith(" ")) {
    result = result.slice(0, -1);
  }
  return result;
}

function normalizeAttributeName(name, namespace) {
  const key = name.toLowerCase();
  const adjustment = FOREIGN_ATTRIBUTE_ADJUSTMENTS[key];
  if (!adjustment || namespace === "html") {
    return name;
  }
  const [, localName] = adjustment;
  return localName;
}

function serializeAttributes(attrs, namespace) {
  if (!attrs) return {};
  if (!namespace || namespace === "html") {
    return attrs;
  }
  const out = {};
  for (const [key, value] of Object.entries(attrs)) {
    out[normalizeAttributeName(key, namespace)] = value;
  }
  return out;
}

function nodeToHtml(node, indent, indentSize, pretty, inPre) {
  if (node.name === "#text") {
    const text = node.data || "";
    if (inPre || RAWTEXT_ELEMENTS.has(node.parent?.name)) {
      return text;
    }
    if (!pretty) {
      return escapeText(text);
    }
    return escapeText(normalizeFormattingWhitespace(text));
  }

  if (node.name === "#comment") {
    return `<!--${node.data || ""}-->`;
  }

  if (node.name === "!doctype") {
    const doctype = node.data;
    if (!doctype || !doctype.name) {
      return "<!DOCTYPE html>";
    }
    if (!doctype.public_id && !doctype.system_id) {
      return `<!DOCTYPE ${doctype.name}>`;
    }
    if (!doctype.system_id) {
      return `<!DOCTYPE ${doctype.name} PUBLIC \"${doctype.public_id || ""}\">`;
    }
    if (!doctype.public_id) {
      return `<!DOCTYPE ${doctype.name} SYSTEM \"${doctype.system_id || ""}\">`;
    }
    return `<!DOCTYPE ${doctype.name} PUBLIC \"${doctype.public_id || ""}\" \"${doctype.system_id || ""}\">`;
  }

  const tagName = node.name;
  const isVoid = VOID_ELEMENTS.has(tagName);
  const isPre = inPre || PREFORMATTED_ELEMENTS.has(tagName);
  const attrs = serializeAttributes(node.attrs, node.namespace);

  const startTag = serializeStartTag(tagName, attrs, {
    isVoid,
  });

  if (!node.children || node.children.length === 0) {
    return isVoid ? startTag : `${startTag}${serializeEndTag(tagName)}`;
  }

  const childHtml = node.children.map((child) => nodeToHtml(child, indent + 1, indentSize, pretty, isPre));
  if (!pretty || SPECIAL_ELEMENTS.has(tagName)) {
    return `${startTag}${childHtml.join("")}${serializeEndTag(tagName)}`;
  }

  const pad = " ".repeat(indentSize * indent);
  const childPad = " ".repeat(indentSize * (indent + 1));
  const inner = childHtml
    .map((chunk) => {
      if (chunk === "") return "";
      return `${childPad}${chunk}`;
    })
    .join("\n");

  return `${startTag}\n${inner}\n${pad}${serializeEndTag(tagName)}`;
}

export function toHtml(node, indent = 0, indentSize = 2, { pretty = true, safe = true, policy = null } = {}) {
  let current = node;
  if (safe) {
    if (policy == null && node.name === "#document") {
      current = sanitize(node, { policy: DEFAULT_DOCUMENT_POLICY });
    } else {
      current = sanitize(node, { policy: policy ?? DEFAULT_POLICY });
    }
  }

  if (current.name === "#document") {
    const parts = [];
    for (const child of current.children || []) {
      parts.push(nodeToHtml(child, indent, indentSize, pretty, false));
    }
    return pretty ? parts.join("\n") : parts.join("");
  }

  return nodeToHtml(current, indent, indentSize, pretty, false);
}
