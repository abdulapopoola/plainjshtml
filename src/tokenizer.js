import { decodeEntitiesInText } from "./entities.js";
import { generateErrorMessage } from "./errors.js";
import { CommentToken, CharacterTokens, Doctype, DoctypeToken, EOFToken, ParseError, Tag } from "./tokens.js";

const WHITESPACE = new Set(["\t", "\n", "\f", " "]);

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
  static RCDATA = 40;
  static RAWTEXT = 44;
  static PLAINTEXT = 48;

  constructor(sink, opts = new TokenizerOpts(), { collectErrors = false, trackNodeLocations = false } = {}) {
    this.sink = sink;
    this.opts = opts;
    this.collect_errors = collectErrors;
    this.track_node_locations = trackNodeLocations;
    this.errors = [];
    this._newline_positions = [];
    this._source_html = null;
  }

  run(html) {
    this._source_html = html;
    this._newline_positions = this._computeNewlines(html);

    let state = this.opts.initial_state ?? Tokenizer.DATA;
    let pos = 0;
    let buffer = "";

    let currentTag = null;
    let currentAttrName = "";
    let currentAttrValue = "";
    let currentComment = "";
    let currentDoctype = null;

    const flushText = () => {
      if (!buffer) return;
      const decoded = decodeEntitiesInText(buffer, { reportError: (code) => this._error(code, pos) });
      this.sink.process(new CharacterTokens(decoded));
      buffer = "";
    };

    const emitTag = () => {
      if (!currentTag) return;
      this.sink.process(currentTag);
      currentTag = null;
    };

    const commitAttr = () => {
      if (!currentTag || !currentAttrName) return;
      const name = currentAttrName;
      if (currentTag.attrs[name] == null) {
        currentTag.attrs[name] = decodeEntitiesInText(currentAttrValue, { inAttribute: true, reportError: (code) => this._error(code, pos) });
      } else {
        this._error("duplicate-attribute", pos);
      }
      currentAttrName = "";
      currentAttrValue = "";
    };

    while (pos < html.length) {
      const ch = html[pos];

      switch (state) {
        case Tokenizer.DATA:
          if (ch === "<") {
            flushText();
            state = Tokenizer.TAG_OPEN;
            pos += 1;
            continue;
          }
          if (state === Tokenizer.PLAINTEXT) {
            buffer += ch;
            pos += 1;
            continue;
          }
          buffer += ch;
          pos += 1;
          continue;

        case Tokenizer.TAG_OPEN:
          if (ch === "/") {
            state = Tokenizer.END_TAG_OPEN;
            pos += 1;
            continue;
          }
          if (ch === "!") {
            state = Tokenizer.MARKUP_DECLARATION_OPEN;
            pos += 1;
            continue;
          }
          if (/[A-Za-z]/.test(ch)) {
            currentTag = new Tag(Tag.START, ch.toLowerCase(), {});
            state = Tokenizer.TAG_NAME;
            pos += 1;
            continue;
          }
          if (ch === "?") {
            this._error("unexpected-question-mark-instead-of-tag-name", pos);
            state = Tokenizer.BOGUS_COMMENT;
            currentComment = "?";
            pos += 1;
            continue;
          }
          buffer += "<";
          state = Tokenizer.DATA;
          continue;

        case Tokenizer.END_TAG_OPEN:
          if (/[A-Za-z]/.test(ch)) {
            currentTag = new Tag(Tag.END, ch.toLowerCase(), {});
            state = Tokenizer.TAG_NAME;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this._error("missing-end-tag-name", pos);
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          this._error("invalid-first-character-of-tag-name", pos);
          state = Tokenizer.BOGUS_COMMENT;
          currentComment = "";
          continue;

        case Tokenizer.TAG_NAME:
          if (WHITESPACE.has(ch)) {
            state = Tokenizer.BEFORE_ATTRIBUTE_NAME;
            pos += 1;
            continue;
          }
          if (ch === "/") {
            state = Tokenizer.SELF_CLOSING_START_TAG;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentTag.name += ch.toLowerCase();
          pos += 1;
          continue;

        case Tokenizer.BEFORE_ATTRIBUTE_NAME:
          if (WHITESPACE.has(ch)) {
            pos += 1;
            continue;
          }
          if (ch === "/") {
            state = Tokenizer.SELF_CLOSING_START_TAG;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentAttrName = ch.toLowerCase();
          currentAttrValue = "";
          state = Tokenizer.ATTRIBUTE_NAME;
          pos += 1;
          continue;

        case Tokenizer.ATTRIBUTE_NAME:
          if (WHITESPACE.has(ch)) {
            state = Tokenizer.AFTER_ATTRIBUTE_NAME;
            pos += 1;
            continue;
          }
          if (ch === "=") {
            state = Tokenizer.BEFORE_ATTRIBUTE_VALUE;
            pos += 1;
            continue;
          }
          if (ch === "/") {
            commitAttr();
            state = Tokenizer.SELF_CLOSING_START_TAG;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            commitAttr();
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentAttrName += ch.toLowerCase();
          pos += 1;
          continue;

        case Tokenizer.AFTER_ATTRIBUTE_NAME:
          if (WHITESPACE.has(ch)) {
            pos += 1;
            continue;
          }
          if (ch === "=") {
            state = Tokenizer.BEFORE_ATTRIBUTE_VALUE;
            pos += 1;
            continue;
          }
          if (ch === "/") {
            commitAttr();
            state = Tokenizer.SELF_CLOSING_START_TAG;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            commitAttr();
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          commitAttr();
          currentAttrName = ch.toLowerCase();
          currentAttrValue = "";
          state = Tokenizer.ATTRIBUTE_NAME;
          pos += 1;
          continue;

        case Tokenizer.BEFORE_ATTRIBUTE_VALUE:
          if (WHITESPACE.has(ch)) {
            pos += 1;
            continue;
          }
          if (ch === '"') {
            state = Tokenizer.ATTRIBUTE_VALUE_DOUBLE;
            pos += 1;
            continue;
          }
          if (ch === "'") {
            state = Tokenizer.ATTRIBUTE_VALUE_SINGLE;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this._error("missing-attribute-value", pos);
            commitAttr();
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          state = Tokenizer.ATTRIBUTE_VALUE_UNQUOTED;
          continue;

        case Tokenizer.ATTRIBUTE_VALUE_DOUBLE:
          if (ch === '"') {
            commitAttr();
            state = Tokenizer.AFTER_ATTRIBUTE_VALUE_QUOTED;
            pos += 1;
            continue;
          }
          currentAttrValue += ch;
          pos += 1;
          continue;

        case Tokenizer.ATTRIBUTE_VALUE_SINGLE:
          if (ch === "'") {
            commitAttr();
            state = Tokenizer.AFTER_ATTRIBUTE_VALUE_QUOTED;
            pos += 1;
            continue;
          }
          currentAttrValue += ch;
          pos += 1;
          continue;

        case Tokenizer.ATTRIBUTE_VALUE_UNQUOTED:
          if (WHITESPACE.has(ch)) {
            commitAttr();
            state = Tokenizer.BEFORE_ATTRIBUTE_NAME;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            commitAttr();
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentAttrValue += ch;
          pos += 1;
          continue;

        case Tokenizer.AFTER_ATTRIBUTE_VALUE_QUOTED:
          if (WHITESPACE.has(ch)) {
            state = Tokenizer.BEFORE_ATTRIBUTE_NAME;
            pos += 1;
            continue;
          }
          if (ch === "/") {
            state = Tokenizer.SELF_CLOSING_START_TAG;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          state = Tokenizer.BEFORE_ATTRIBUTE_NAME;
          continue;

        case Tokenizer.SELF_CLOSING_START_TAG:
          if (ch === ">") {
            if (currentTag) {
              currentTag.self_closing = true;
            }
            emitTag();
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          state = Tokenizer.BEFORE_ATTRIBUTE_NAME;
          continue;

        case Tokenizer.MARKUP_DECLARATION_OPEN:
          if (html.slice(pos, pos + 2) === "--") {
            state = Tokenizer.COMMENT_START;
            currentComment = "";
            pos += 2;
            continue;
          }
          if (/doctype/i.test(html.slice(pos, pos + 7))) {
            state = Tokenizer.DOCTYPE;
            pos += 7;
            currentDoctype = new Doctype();
            continue;
          }
          state = Tokenizer.BOGUS_COMMENT;
          currentComment = "";
          continue;

        case Tokenizer.COMMENT_START:
          if (ch === "-") {
            state = Tokenizer.COMMENT_START_DASH;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this._error("abrupt-closing-of-empty-comment", pos);
            this.sink.process(new CommentToken(""));
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          state = Tokenizer.COMMENT;
          continue;

        case Tokenizer.COMMENT_START_DASH:
          if (ch === "-") {
            state = Tokenizer.COMMENT_END;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this._error("abrupt-closing-of-empty-comment", pos);
            this.sink.process(new CommentToken(""));
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentComment += "-";
          state = Tokenizer.COMMENT;
          continue;

        case Tokenizer.COMMENT:
          if (ch === "-") {
            state = Tokenizer.COMMENT_END_DASH;
            pos += 1;
            continue;
          }
          currentComment += ch;
          pos += 1;
          continue;

        case Tokenizer.COMMENT_END_DASH:
          if (ch === "-") {
            state = Tokenizer.COMMENT_END;
            pos += 1;
            continue;
          }
          currentComment += "-" + ch;
          state = Tokenizer.COMMENT;
          pos += 1;
          continue;

        case Tokenizer.COMMENT_END:
          if (ch === ">") {
            this.sink.process(new CommentToken(currentComment));
            currentComment = "";
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          if (ch === "!") {
            state = Tokenizer.COMMENT_END_BANG;
            pos += 1;
            continue;
          }
          currentComment += "--" + ch;
          state = Tokenizer.COMMENT;
          pos += 1;
          continue;

        case Tokenizer.COMMENT_END_BANG:
          if (ch === ">") {
            this._error("incorrectly-closed-comment", pos);
            this.sink.process(new CommentToken(currentComment));
            currentComment = "";
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentComment += "--!" + ch;
          state = Tokenizer.COMMENT;
          pos += 1;
          continue;

        case Tokenizer.BOGUS_COMMENT:
          if (ch === ">") {
            this.sink.process(new CommentToken(currentComment));
            currentComment = "";
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentComment += ch;
          pos += 1;
          continue;

        case Tokenizer.DOCTYPE:
          if (WHITESPACE.has(ch)) {
            state = Tokenizer.BEFORE_DOCTYPE_NAME;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this._error("missing-doctype-name", pos);
            this.sink.process(new DoctypeToken(new Doctype(null, null, null, true)));
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          state = Tokenizer.BEFORE_DOCTYPE_NAME;
          continue;

        case Tokenizer.BEFORE_DOCTYPE_NAME:
          if (WHITESPACE.has(ch)) {
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this._error("missing-doctype-name", pos);
            this.sink.process(new DoctypeToken(new Doctype(null, null, null, true)));
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentDoctype.name = ch.toLowerCase();
          state = Tokenizer.DOCTYPE_NAME;
          pos += 1;
          continue;

        case Tokenizer.DOCTYPE_NAME:
          if (WHITESPACE.has(ch)) {
            state = Tokenizer.AFTER_DOCTYPE_NAME;
            pos += 1;
            continue;
          }
          if (ch === ">") {
            this.sink.process(new DoctypeToken(currentDoctype));
            currentDoctype = null;
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          currentDoctype.name += ch.toLowerCase();
          pos += 1;
          continue;

        case Tokenizer.AFTER_DOCTYPE_NAME:
          if (ch === ">") {
            this.sink.process(new DoctypeToken(currentDoctype));
            currentDoctype = null;
            state = Tokenizer.DATA;
            pos += 1;
            continue;
          }
          pos += 1;
          continue;

        default:
          buffer += ch;
          pos += 1;
      }
    }

    if (buffer) {
      const decoded = decodeEntitiesInText(buffer, { reportError: (code) => this._error(code, pos) });
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
    this.errors.push(new ParseError(code, line, column, message, this._source_html));
  }
}
