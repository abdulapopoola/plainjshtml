import { decodeEntitiesInText } from "./entities.js";
import { generateErrorMessage } from "./errors.js";
import { CommentToken, CharacterTokens, Doctype, DoctypeToken, EOFToken, ParseError, Tag } from "./tokens.js";

const ATTR_VALUE_UNQUOTED_TERMINATORS = "\t\n\f >&\"'<=`\0";
const RCDATA_ELEMENTS = new Set(["title", "textarea"]);
const RAWTEXT_SWITCH_TAGS = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "textarea",
  "title",
]);

export class TokenizerOpts {
  constructor({ exactErrors = false, discardBom = true, initialState = null, initialRawtextTag = null, xmlCoercion = false } = {}) {
    this.exact_errors = Boolean(exactErrors);
    this.discard_bom = Boolean(discardBom);
    this.initial_state = initialState;
    this.initial_rawtext_tag = initialRawtextTag;
    this.xml_coercion = Boolean(xmlCoercion);
  }
}

export class Tokenizer {
  static DATA = 0;
  static TAG_OPEN = 1;
  static END_TAG_OPEN = 2;
  static TAG_NAME = 3;
  static BEFORE_ATTRIBUTE_NAME = 4;
  static ATTRIBUTE_NAME = 5;
  static AFTER_ATTRIBUTE_NAME = 6;
  static BEFORE_ATTRIBUTE_VALUE = 7;
  static ATTRIBUTE_VALUE_DOUBLE = 8;
  static ATTRIBUTE_VALUE_SINGLE = 9;
  static ATTRIBUTE_VALUE_UNQUOTED = 10;
  static AFTER_ATTRIBUTE_VALUE_QUOTED = 11;
  static SELF_CLOSING_START_TAG = 12;
  static MARKUP_DECLARATION_OPEN = 13;
  static COMMENT_START = 14;
  static COMMENT_START_DASH = 15;
  static COMMENT = 16;
  static COMMENT_END_DASH = 17;
  static COMMENT_END = 18;
  static COMMENT_END_BANG = 19;
  static BOGUS_COMMENT = 20;
  static DOCTYPE = 21;
  static BEFORE_DOCTYPE_NAME = 22;
  static DOCTYPE_NAME = 23;
  static AFTER_DOCTYPE_NAME = 24;
  static BOGUS_DOCTYPE = 25;
  static AFTER_DOCTYPE_PUBLIC_KEYWORD = 26;
  static AFTER_DOCTYPE_SYSTEM_KEYWORD = 27;
  static BEFORE_DOCTYPE_PUBLIC_IDENTIFIER = 28;
  static DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED = 29;
  static DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED = 30;
  static AFTER_DOCTYPE_PUBLIC_IDENTIFIER = 31;
  static BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS = 32;
  static BEFORE_DOCTYPE_SYSTEM_IDENTIFIER = 33;
  static DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED = 34;
  static DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED = 35;
  static AFTER_DOCTYPE_SYSTEM_IDENTIFIER = 36;
  static CDATA_SECTION = 37;
  static CDATA_SECTION_BRACKET = 38;
  static CDATA_SECTION_END = 39;
  static RCDATA = 40;
  static RCDATA_LESS_THAN_SIGN = 41;
  static RCDATA_END_TAG_OPEN = 42;
  static RCDATA_END_TAG_NAME = 43;
  static RAWTEXT = 44;
  static RAWTEXT_LESS_THAN_SIGN = 45;
  static RAWTEXT_END_TAG_OPEN = 46;
  static RAWTEXT_END_TAG_NAME = 47;
  static PLAINTEXT = 48;
  static SCRIPT_DATA_ESCAPED = 49;
  static SCRIPT_DATA_ESCAPED_DASH = 50;
  static SCRIPT_DATA_ESCAPED_DASH_DASH = 51;
  static SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN = 52;
  static SCRIPT_DATA_ESCAPED_END_TAG_OPEN = 53;
  static SCRIPT_DATA_ESCAPED_END_TAG_NAME = 54;
  static SCRIPT_DATA_DOUBLE_ESCAPE_START = 55;
  static SCRIPT_DATA_DOUBLE_ESCAPED = 56;
  static SCRIPT_DATA_DOUBLE_ESCAPED_DASH = 57;
  static SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH = 58;
  static SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN = 59;
  static SCRIPT_DATA_DOUBLE_ESCAPE_END = 60;

  constructor(sink, opts = new TokenizerOpts(), { collectErrors = false, trackNodeLocations = false } = {}) {
    this.sink = sink;
    this.opts = opts;
    this.collect_errors = collectErrors;
    this.track_node_locations = trackNodeLocations;
    this.errors = [];
    this._newline_positions = [];
  }

  run(html) {
    this._newline_positions = this._computeNewlines(html);

    // Minimal tokenizer for now: emit tags/comments/doctypes with entity decoding.
    const tagRe = /<[^>]*>/g;
    let lastIndex = 0;

    for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
      const tag = match[0];
      if (match.index > lastIndex) {
        const text = html.slice(lastIndex, match.index);
        const decoded = decodeEntitiesInText(text, { reportError: (code) => this._error(code, match.index) });
        this.sink.process(new CharacterTokens(decoded));
      }

      if (tag.startsWith("<!--")) {
        const data = tag.slice(4, -3);
        this.sink.process(new CommentToken(data));
      } else if (tag.startsWith("<!DOCTYPE") || tag.startsWith("<!doctype")) {
        const name = tag.replace(/<!doctype/i, "").replace(/>/g, "").trim() || "html";
        this.sink.process(new DoctypeToken(new Doctype(name)));
      } else if (tag.startsWith("</")) {
        const name = tag.slice(2, -1).trim().toLowerCase();
        this.sink.process(new Tag(Tag.END, name, null, false));
      } else if (tag.startsWith("<!")) {
        // Ignore other markup declarations.
      } else {
        const { name, attrs, selfClosing } = parseStartTag(tag, (code) => this._error(code, match.index));
        this.sink.process(new Tag(Tag.START, name, attrs, selfClosing));
      }

      lastIndex = tagRe.lastIndex;
    }

    if (lastIndex < html.length) {
      const tail = html.slice(lastIndex);
      const decoded = decodeEntitiesInText(tail, { reportError: (code) => this._error(code, lastIndex) });
      this.sink.process(new CharacterTokens(decoded));
    }

    this.sink.process(new EOFToken());
  }

  _computeNewlines(html) {
    const positions = [];
    for (let i = 0; i < html.length; i += 1) {
      if (html[i] === "\n") {
        positions.push(i);
      }
    }
    return positions;
  }

  _posToLineCol(pos) {
    let lo = 0;
    let hi = this._newline_positions.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this._newline_positions[mid] < pos) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const line = lo + 1;
    const lineStart = lo === 0 ? 0 : this._newline_positions[lo - 1] + 1;
    const col = pos - lineStart + 1;
    return [line, col];
  }

  _error(code, pos) {
    if (!this.collect_errors) return;
    const [line, column] = this._posToLineCol(pos);
    const message = generateErrorMessage(code);
    this.errors.push(new ParseError(code, line, column, message));
  }
}

function parseStartTag(tag, reportError) {
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
      const valueRaw = match[2] ?? match[3] ?? match[4] ?? "";
      const value = decodeEntitiesInText(valueRaw, { inAttribute: true, reportError });
      attrs[key] = value;
    }
  }

  return { name, attrs, selfClosing };
}
