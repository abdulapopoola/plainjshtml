const ASCII_WHITESPACE = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);

function asciiLower(b) {
  if (b >= 0x41 && b <= 0x5a) {
    return b | 0x20;
  }
  return b;
}

function isAsciiAlpha(b) {
  const lowered = asciiLower(b);
  return lowered >= 0x61 && lowered <= 0x7a;
}

function skipAsciiWhitespace(data, i) {
  while (i < data.length && ASCII_WHITESPACE.has(data[i])) {
    i += 1;
  }
  return i;
}

function stripAsciiWhitespace(value) {
  if (value == null) return null;
  let start = 0;
  let end = value.length;
  while (start < end && ASCII_WHITESPACE.has(value[start])) {
    start += 1;
  }
  while (end > start && ASCII_WHITESPACE.has(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

export function normalizeEncodingLabel(label) {
  if (!label) return null;

  let s = label;
  if (typeof label !== "string") {
    s = new TextDecoder("ascii", { fatal: false }).decode(label);
  }

  const normalized = String(s).trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "utf-7" || normalized === "utf7" || normalized === "x-utf-7") {
    return "windows-1252";
  }

  if (normalized === "utf-8" || normalized === "utf8") {
    return "utf-8";
  }

  if (
    normalized === "iso-8859-1" ||
    normalized === "iso8859-1" ||
    normalized === "latin1" ||
    normalized === "latin-1" ||
    normalized === "l1" ||
    normalized === "cp819" ||
    normalized === "ibm819"
  ) {
    return "windows-1252";
  }

  if (
    normalized === "windows-1252" ||
    normalized === "windows1252" ||
    normalized === "cp1252" ||
    normalized === "x-cp1252"
  ) {
    return "windows-1252";
  }

  if (normalized === "iso-8859-2" || normalized === "iso8859-2" || normalized === "latin2" || normalized === "latin-2") {
    return "iso-8859-2";
  }

  if (normalized === "euc-jp" || normalized === "eucjp") {
    return "euc-jp";
  }

  if (normalized === "utf-16" || normalized === "utf16") {
    return "utf-16";
  }
  if (normalized === "utf-16le" || normalized === "utf16le") {
    return "utf-16le";
  }
  if (normalized === "utf-16be" || normalized === "utf16be") {
    return "utf-16be";
  }

  return null;
}

function normalizeMetaDeclaredEncoding(label) {
  const enc = normalizeEncodingLabel(label);
  if (!enc) return null;
  if (
    enc === "utf-16" ||
    enc === "utf-16le" ||
    enc === "utf-16be" ||
    enc === "utf-32" ||
    enc === "utf-32le" ||
    enc === "utf-32be"
  ) {
    return "utf-8";
  }
  return enc;
}

function sniffBom(data) {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return ["utf-8", 3];
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return ["utf-16le", 2];
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return ["utf-16be", 2];
  }
  return [null, 0];
}

function extractCharsetFromContent(contentBytes) {
  if (!contentBytes || contentBytes.length === 0) return null;

  const b = new Uint8Array(contentBytes.length);
  for (let i = 0; i < contentBytes.length; i += 1) {
    const ch = contentBytes[i];
    b[i] = ASCII_WHITESPACE.has(ch) ? 0x20 : asciiLower(ch);
  }
  const s = b;
  const text = new TextDecoder("ascii", { fatal: false }).decode(s);
  const idx = text.indexOf("charset");
  if (idx === -1) return null;

  let i = idx + "charset".length;
  const n = s.length;
  while (i < n && ASCII_WHITESPACE.has(s[i])) {
    i += 1;
  }
  if (i >= n || s[i] !== 0x3d) {
    return null;
  }
  i += 1;
  while (i < n && ASCII_WHITESPACE.has(s[i])) {
    i += 1;
  }
  if (i >= n) return null;

  let quote = null;
  if (s[i] === 0x22 || s[i] === 0x27) {
    quote = s[i];
    i += 1;
  }

  const start = i;
  while (i < n) {
    const ch = s[i];
    if (quote != null) {
      if (ch === quote) {
        break;
      }
    } else if (ASCII_WHITESPACE.has(ch) || ch === 0x3b) {
      break;
    }
    i += 1;
  }

  if (quote != null && (i >= n || s[i] !== quote)) {
    return null;
  }

  return s.slice(start, i);
}

function prescanForMetaCharset(data) {
  const maxNonComment = 1024;
  const maxTotalScan = 65536;
  const n = data.length;
  let i = 0;
  let nonComment = 0;

  while (i < n && i < maxTotalScan && nonComment < maxNonComment) {
    if (data[i] !== 0x3c) {
      i += 1;
      nonComment += 1;
      continue;
    }

    if (i + 3 < n && data[i + 1] === 0x21 && data[i + 2] === 0x2d && data[i + 3] === 0x2d) {
      const end = findBytes(data, "-->", i + 4);
      if (end === -1) {
        return null;
      }
      i = end + 3;
      continue;
    }

    let j = i + 1;
    if (j < n && data[j] === 0x2f) {
      const end = findTagEnd(data, i + 2);
      if (end === -1) {
        return null;
      }
      nonComment += end - i;
      i = end;
      continue;
    }

    if (j >= n || !isAsciiAlpha(data[j])) {
      i += 1;
      nonComment += 1;
      continue;
    }

    const tagStart = j;
    j += 1;
    while (j < n && (isAsciiAlpha(data[j]) || data[j] === 0x2d)) {
      j += 1;
    }
    const tagName = new TextDecoder("ascii", { fatal: false }).decode(data.slice(tagStart, j)).toLowerCase();
    if (tagName !== "meta") {
      const end = findTagEnd(data, j);
      if (end === -1) {
        return null;
      }
      nonComment += end - i;
      i = end;
      continue;
    }

    const endTag = findTagEnd(data, j);
    if (endTag === -1) {
      return null;
    }

    const tagContent = data.slice(j, endTag);
    const charset = extractCharsetFromMeta(tagContent);
    if (charset) {
      return charset;
    }

    nonComment += endTag - i;
    i = endTag;
  }

  return null;
}

function findTagEnd(data, i) {
  const n = data.length;
  let quote = null;
  while (i < n) {
    const ch = data[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === 0x22 || ch === 0x27) {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === 0x3e) {
      return i + 1;
    }
    i += 1;
  }
  return -1;
}

function findBytes(data, needle, start) {
  const bytes = new TextEncoder().encode(needle);
  outer: for (let i = start; i <= data.length - bytes.length; i += 1) {
    for (let j = 0; j < bytes.length; j += 1) {
      if (data[i + j] !== bytes[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function extractCharsetFromMeta(tagContent) {
  const contentLower = new Uint8Array(tagContent.length);
  for (let i = 0; i < tagContent.length; i += 1) {
    const ch = tagContent[i];
    contentLower[i] = ASCII_WHITESPACE.has(ch) ? 0x20 : asciiLower(ch);
  }

  const text = new TextDecoder("ascii", { fatal: false }).decode(contentLower);
  let i = 0;
  const n = contentLower.length;
  let gotPragma = false;
  let charset = null;

  while (i < n) {
    i = skipAsciiWhitespace(contentLower, i);
    if (i >= n) break;

    if (contentLower[i] === 0x2f) {
      i += 1;
      continue;
    }

    if (!isAsciiAlpha(contentLower[i])) {
      i += 1;
      continue;
    }

    const attrStart = i;
    i += 1;
    while (i < n && (isAsciiAlpha(contentLower[i]) || contentLower[i] === 0x2d)) {
      i += 1;
    }
    const attrName = text.slice(attrStart, i);

    i = skipAsciiWhitespace(contentLower, i);
    if (i < n && contentLower[i] === 0x3d) {
      i += 1;
    } else {
      continue;
    }

    i = skipAsciiWhitespace(contentLower, i);
    if (i >= n) break;

    let value = null;
    if (contentLower[i] === 0x22 || contentLower[i] === 0x27) {
      const quote = contentLower[i];
      i += 1;
      const start = i;
      while (i < n && contentLower[i] !== quote) {
        i += 1;
      }
      value = tagContent.slice(start, i);
      if (i < n && contentLower[i] === quote) {
        i += 1;
      }
    } else {
      const start = i;
      while (i < n && !ASCII_WHITESPACE.has(contentLower[i])) {
        i += 1;
      }
      value = tagContent.slice(start, i);
    }

    if (!value) {
      continue;
    }

    if (attrName === "http-equiv") {
      const httpEquiv = new TextDecoder("ascii", { fatal: false }).decode(value).trim().toLowerCase();
      if (httpEquiv === "content-type") {
        gotPragma = true;
      }
      continue;
    }

    if (attrName === "content") {
      const declared = extractCharsetFromContent(value);
      if (declared) {
        charset = declared;
      }
      continue;
    }

    if (attrName === "charset") {
      charset = value;
      gotPragma = true;
    }
  }

  if (charset == null) {
    return null;
  }

  const stripped = stripAsciiWhitespace(charset);
  if (!stripped) return null;

  const normalized = normalizeMetaDeclaredEncoding(stripped);
  if (!normalized) return null;

  if (!gotPragma) {
    return null;
  }

  return normalized;
}

function decodeWithEncoding(bytes, encoding) {
  const decoder = new TextDecoder(encoding, { fatal: false });
  return decoder.decode(bytes);
}

export function decodeHtml(data, transportEncoding = null) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const [bomEncoding, bomSkip] = sniffBom(bytes);
  let encoding = null;

  if (bomEncoding) {
    encoding = bomEncoding;
  } else if (transportEncoding) {
    encoding = normalizeEncodingLabel(transportEncoding);
  }

  if (!encoding) {
    const meta = prescanForMetaCharset(bytes);
    if (meta) {
      encoding = meta;
    }
  }

  if (!encoding) {
    encoding = "windows-1252";
  }

  const slice = bomSkip ? bytes.slice(bomSkip) : bytes;
  const html = decodeWithEncoding(slice, encoding);

  return [html, encoding];
}
