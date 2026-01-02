import {
  HTML4_PUBLIC_PREFIXES,
  LIMITED_QUIRKY_PUBLIC_PREFIXES,
  QUIRKY_PUBLIC_MATCHES,
  QUIRKY_PUBLIC_PREFIXES,
  QUIRKY_SYSTEM_MATCHES,
} from "./constants.js";

export const InsertionMode = Object.freeze({
  INITIAL: 0,
  BEFORE_HTML: 1,
  BEFORE_HEAD: 2,
  IN_HEAD: 3,
  IN_HEAD_NOSCRIPT: 4,
  AFTER_HEAD: 5,
  TEXT: 6,
  IN_BODY: 7,
  AFTER_BODY: 8,
  AFTER_AFTER_BODY: 9,
  IN_TABLE: 10,
  IN_TABLE_TEXT: 11,
  IN_CAPTION: 12,
  IN_COLUMN_GROUP: 13,
  IN_TABLE_BODY: 14,
  IN_ROW: 15,
  IN_CELL: 16,
  IN_FRAMESET: 17,
  AFTER_FRAMESET: 18,
  AFTER_AFTER_FRAMESET: 19,
  IN_SELECT: 20,
  IN_TEMPLATE: 21,
});

export function isAllWhitespace(text) {
  return text.trim().length === 0;
}

function containsPrefix(haystack, needle) {
  return haystack.some((prefix) => needle.startsWith(prefix));
}

export function doctypeErrorAndQuirks(doctype, { iframeSrcdoc = false } = {}) {
  const name = doctype.name ? doctype.name.toLowerCase() : null;
  const publicId = doctype.public_id;
  const systemId = doctype.system_id;

  const acceptable = [
    ["html", null, null],
    ["html", null, "about:legacy-compat"],
    ["html", "-//W3C//DTD HTML 4.0//EN", null],
    ["html", "-//W3C//DTD HTML 4.0//EN", "http://www.w3.org/TR/REC-html40/strict.dtd"],
    ["html", "-//W3C//DTD HTML 4.01//EN", null],
    ["html", "-//W3C//DTD HTML 4.01//EN", "http://www.w3.org/TR/html4/strict.dtd"],
    ["html", "-//W3C//DTD XHTML 1.0 Strict//EN", "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"],
    ["html", "-//W3C//DTD XHTML 1.1//EN", "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"],
  ];

  const key = [name, publicId, systemId];
  const parseError = !acceptable.some((tuple) => tuple[0] === key[0] && tuple[1] === key[1] && tuple[2] === key[2]);

  const publicLower = publicId ? publicId.toLowerCase() : null;
  const systemLower = systemId ? systemId.toLowerCase() : null;

  let quirksMode;
  if (doctype.force_quirks) {
    quirksMode = "quirks";
  } else if (iframeSrcdoc) {
    quirksMode = "no-quirks";
  } else if (name !== "html") {
    quirksMode = "quirks";
  } else if (publicLower && QUIRKY_PUBLIC_MATCHES.includes(publicLower)) {
    quirksMode = "quirks";
  } else if (systemLower && QUIRKY_SYSTEM_MATCHES.includes(systemLower)) {
    quirksMode = "quirks";
  } else if (publicLower && containsPrefix(QUIRKY_PUBLIC_PREFIXES, publicLower)) {
    quirksMode = "quirks";
  } else if (publicLower && containsPrefix(LIMITED_QUIRKY_PUBLIC_PREFIXES, publicLower)) {
    quirksMode = "limited-quirks";
  } else if (publicLower && containsPrefix(HTML4_PUBLIC_PREFIXES, publicLower)) {
    quirksMode = systemLower == null ? "quirks" : "limited-quirks";
  } else {
    quirksMode = "no-quirks";
  }

  return [parseError, quirksMode];
}
