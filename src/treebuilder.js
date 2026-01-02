import { FORMATTING_ELEMENTS, IMPLIED_END_TAGS, VOID_ELEMENTS } from "./constants.js";
import { ElementNode, SimpleDomNode, TemplateNode, TextNode } from "./node.js";
import { generateErrorMessage } from "./errors.js";
import { CharacterTokens, CommentToken, DoctypeToken, EOFToken, ParseError, Tag } from "./tokens.js";
import { InsertionMode, doctypeErrorAndQuirks, isAllWhitespace } from "./treebuilder_utils.js";

export class TreeBuilder {
  constructor({ fragmentContext = null, iframeSrcdoc = false, collectErrors = false } = {}) {
    this.fragment_context = fragmentContext;
    this.iframe_srcdoc = iframeSrcdoc;
    this.collect_errors = collectErrors;
    this.errors = [];
    this.tokenizer = null;

    this.document = new SimpleDomNode(fragmentContext ? "#document-fragment" : "#document");
    this.mode = InsertionMode.INITIAL;
    this.original_mode = null;
    this.open_elements = [];
    this.head_element = null;
    this.form_element = null;
    this.frameset_ok = true;
    this.quirks_mode = "no-quirks";

    if (fragmentContext) {
      const html = new ElementNode("html", {}, "html");
      this.document.appendChild(html);
      this.open_elements.push(html);
      this.mode = InsertionMode.IN_BODY;
    }
  }

  process(token) {
    switch (this.mode) {
      case InsertionMode.INITIAL:
        return this._handleInitial(token);
      case InsertionMode.BEFORE_HTML:
        return this._handleBeforeHtml(token);
      case InsertionMode.BEFORE_HEAD:
        return this._handleBeforeHead(token);
      case InsertionMode.IN_HEAD:
        return this._handleInHead(token);
      case InsertionMode.AFTER_HEAD:
        return this._handleAfterHead(token);
      case InsertionMode.IN_BODY:
        return this._handleInBody(token);
      case InsertionMode.AFTER_BODY:
        return this._handleAfterBody(token);
      case InsertionMode.IN_TABLE:
        return this._handleInTable(token);
      case InsertionMode.IN_TABLE_BODY:
        return this._handleInTableBody(token);
      case InsertionMode.IN_ROW:
        return this._handleInRow(token);
      case InsertionMode.IN_CELL:
        return this._handleInCell(token);
      case InsertionMode.IN_FRAMESET:
        return this._handleInFrameset(token);
      case InsertionMode.AFTER_FRAMESET:
        return this._handleAfterFrameset(token);
      default:
        return this._handleInBody(token);
    }
  }

  finish() {
    if (this.collect_errors) {
      const last = this.open_elements[this.open_elements.length - 1];
      if (last && last.name && !["#document", "html", "body"].includes(last.name)) {
        if (this.mode === InsertionMode.IN_FRAMESET && last.name === "frameset") {
          return this.document;
        }
        if (IMPLIED_END_TAGS.has(last.name)) {
          return this.document;
        }
        this._error("expected-closing-tag-but-got-eof", last.name);
      }
    }
    return this.document;
  }

  _handleInitial(token) {
    if (token instanceof CharacterTokens) {
      if (isAllWhitespace(token.data)) {
        return;
      }
      this._error("expected-doctype-but-got-chars");
      this.mode = InsertionMode.BEFORE_HTML;
      return this._handleBeforeHtml(token);
    }
    if (token instanceof DoctypeToken) {
      const node = new SimpleDomNode("!doctype", null, token.doctype);
      this.document.appendChild(node);
      const [parseError, quirksMode] = doctypeErrorAndQuirks(token.doctype, { iframeSrcdoc: this.iframe_srcdoc });
      this.quirks_mode = quirksMode;
      if (parseError) {
        this._error("unknown-doctype");
      }
      this.mode = InsertionMode.BEFORE_HTML;
      return;
    }
    if (token instanceof CommentToken) {
      this.document.appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof EOFToken) {
      this._error("expected-doctype-but-got-eof");
      return;
    }
    this._error("expected-doctype-but-got-start-tag");
    this.mode = InsertionMode.BEFORE_HTML;
    return this._handleBeforeHtml(token);
  }

  _handleBeforeHtml(token) {
    if (token instanceof CharacterTokens && isAllWhitespace(token.data)) {
      return;
    }
    if (token instanceof CommentToken) {
      this.document.appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START && token.name === "html") {
      const node = this._insertElement(token.name, token.attrs);
      this.open_elements.push(node);
      this.mode = InsertionMode.BEFORE_HEAD;
      return;
    }
    if (token instanceof EOFToken) {
      const html = this._insertElement("html", {});
      this.open_elements.push(html);
      this.mode = InsertionMode.BEFORE_HEAD;
      return;
    }

    const html = this._insertElement("html", {});
    this.open_elements.push(html);
    this.mode = InsertionMode.BEFORE_HEAD;
    return this._handleBeforeHead(token);
  }

  _handleBeforeHead(token) {
    if (token instanceof CharacterTokens && isAllWhitespace(token.data)) {
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof DoctypeToken) {
      this._error("unexpected-doctype");
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START && token.name === "head") {
      const node = this._insertElement(token.name, token.attrs);
      this.head_element = node;
      this.open_elements.push(node);
      this.mode = InsertionMode.IN_HEAD;
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && ["head", "body", "html", "br"].includes(token.name)) {
      const node = this._insertElement("head", {});
      this.head_element = node;
      this.open_elements.push(node);
      this.mode = InsertionMode.IN_HEAD;
      return this._handleInHead(token);
    }
    if (token instanceof EOFToken) {
      const node = this._insertElement("head", {});
      this.head_element = node;
      this.open_elements.push(node);
      this.mode = InsertionMode.IN_HEAD;
      return this._handleInHead(token);
    }

    const node = this._insertElement("head", {});
    this.head_element = node;
    this.open_elements.push(node);
    this.mode = InsertionMode.IN_HEAD;
    return this._handleInHead(token);
  }

  _handleInHead(token) {
    if (token instanceof CharacterTokens && isAllWhitespace(token.data)) {
      this._insertText(token.data);
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START) {
      if (["base", "basefont", "bgsound", "link", "meta"].includes(token.name)) {
        const node = this._insertElement(token.name, token.attrs);
        if (!VOID_ELEMENTS.has(token.name)) {
          this.open_elements.push(node);
          this.open_elements.pop();
        }
        return;
      }
      if (token.name === "title" || token.name === "style" || token.name === "script") {
        const node = this._insertElement(token.name, token.attrs);
        this.open_elements.push(node);
        this.open_elements.pop();
        return;
      }
      if (token.name === "head") {
        this._error("unexpected-start-tag");
        return;
      }
      if (token.name === "html") {
        return this._handleInBody(token);
      }
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "head") {
      this.open_elements.pop();
      this.mode = InsertionMode.AFTER_HEAD;
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && ["body", "html", "br"].includes(token.name)) {
      this.open_elements.pop();
      this.mode = InsertionMode.AFTER_HEAD;
      return this._handleAfterHead(token);
    }
    if (token instanceof EOFToken) {
      this.open_elements.pop();
      this.mode = InsertionMode.AFTER_HEAD;
      return this._handleAfterHead(token);
    }

    this.open_elements.pop();
    this.mode = InsertionMode.AFTER_HEAD;
    return this._handleAfterHead(token);
  }

  _handleAfterHead(token) {
    if (token instanceof CharacterTokens && isAllWhitespace(token.data)) {
      this._insertText(token.data);
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START) {
      if (token.name === "body") {
        const node = this._insertElement("body", token.attrs);
        this.open_elements.push(node);
        this.mode = InsertionMode.IN_BODY;
        return;
      }
      if (token.name === "frameset") {
        const node = this._insertElement("frameset", token.attrs);
        this.open_elements.push(node);
        this.mode = InsertionMode.IN_FRAMESET;
        return;
      }
      if (token.name === "html") {
        return this._handleInBody(token);
      }
    }
    if (token instanceof EOFToken) {
      const node = this._insertElement("body", {});
      this.open_elements.push(node);
      this.mode = InsertionMode.IN_BODY;
      return;
    }

    const node = this._insertElement("body", {});
    this.open_elements.push(node);
    this.mode = InsertionMode.IN_BODY;
    return this._handleInBody(token);
  }

  _handleInBody(token) {
    if (token instanceof CharacterTokens) {
      this._insertText(token.data);
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START) {
      if (token.name === "html") {
        const html = this.open_elements[0];
        if (html && html.attrs) {
          for (const [key, value] of Object.entries(token.attrs || {})) {
            if (html.attrs[key] == null) {
              html.attrs[key] = value;
            }
          }
        }
        return;
      }
      if (token.name === "p") {
        this._closeIfOpen("p");
      }
      if (token.name === "frame") {
        this._error("unexpected-start-tag-ignored", token.name);
        return;
      }
      if (token.name === "table") {
        const node = this._insertElement("table", token.attrs);
        this.open_elements.push(node);
        this.mode = InsertionMode.IN_TABLE;
        return;
      }
      const node = this._insertElement(token.name, token.attrs);
      if (!token.self_closing && !VOID_ELEMENTS.has(token.name)) {
        this.open_elements.push(node);
      }
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END) {
      if (token.name === "body") {
        this.mode = InsertionMode.AFTER_BODY;
        return;
      }
      if (token.name === "html") {
        this.mode = InsertionMode.AFTER_BODY;
        return;
      }
      if (token.name === "table") {
        this._popUntil("table");
        this.mode = InsertionMode.IN_BODY;
        return;
      }
      if (FORMATTING_ELEMENTS.has(token.name)) {
        const idx = this._findOpenElement(token.name);
        if (idx !== -1 && idx !== this.open_elements.length - 1) {
          this._error("adoption-agency-1.3");
          this._error("adoption-agency-1.3");
          const formatting = this.open_elements[idx];
          const pNode = this._findOpenNode("p");
          if (pNode && formatting && formatting.children && pNode.parent === formatting && formatting.parent) {
            formatting.removeChild(pNode);
            const parent = formatting.parent;
            const siblings = parent.children;
            const pos = siblings.indexOf(formatting);
            siblings.splice(pos + 1, 0, pNode);
            pNode.parent = parent;
          }
          const current = this._currentNode();
          if (pNode && current && current.parent === pNode) {
            const clone = new ElementNode(token.name, formatting.attrs || {}, "html");
            pNode.appendChild(clone);
            pNode.removeChild(current);
            clone.appendChild(current);
          }
          this._popUntil(token.name);
          return;
        }
      }
      this._popUntil(token.name);
      return;
    }
  }

  _handleInTable(token) {
    if (token instanceof CharacterTokens) {
      this._insertText(token.data);
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START) {
      if (["tbody", "thead", "tfoot"].includes(token.name)) {
        const node = this._insertElement(token.name, token.attrs);
        this.open_elements.push(node);
        this.mode = InsertionMode.IN_TABLE_BODY;
        return;
      }
      if (token.name === "tr") {
        this._insertTableBody();
        const node = this._insertElement("tr", token.attrs);
        this.open_elements.push(node);
        this.mode = InsertionMode.IN_ROW;
        return;
      }
      if (token.name === "td" || token.name === "th") {
        this._error("unexpected-cell-in-table-body");
        this._insertTableBody();
        const row = this._insertElement("tr", {});
        this.open_elements.push(row);
        const cell = this._insertElement(token.name, token.attrs);
        this.open_elements.push(cell);
        this.mode = InsertionMode.IN_CELL;
        return;
      }
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "table") {
      this._popUntil("table");
      this.mode = InsertionMode.IN_BODY;
      return;
    }
    return this._handleInBody(token);
  }

  _handleInTableBody(token) {
    if (token instanceof Tag && token.kind === Tag.START) {
      if (token.name === "tr") {
        const node = this._insertElement("tr", token.attrs);
        this.open_elements.push(node);
        this.mode = InsertionMode.IN_ROW;
        return;
      }
      if (token.name === "td" || token.name === "th") {
        const row = this._insertElement("tr", {});
        this.open_elements.push(row);
        const cell = this._insertElement(token.name, token.attrs);
        this.open_elements.push(cell);
        this.mode = InsertionMode.IN_CELL;
        return;
      }
    }
    if (token instanceof Tag && token.kind === Tag.END && ["tbody", "thead", "tfoot"].includes(token.name)) {
      this._popUntil(token.name);
      this.mode = InsertionMode.IN_TABLE;
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "table") {
      this._popUntil("table");
      this.mode = InsertionMode.IN_BODY;
      return;
    }
    return this._handleInTable(token);
  }

  _handleInRow(token) {
    if (token instanceof Tag && token.kind === Tag.START && (token.name === "td" || token.name === "th")) {
      const cell = this._insertElement(token.name, token.attrs);
      this.open_elements.push(cell);
      this.mode = InsertionMode.IN_CELL;
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "tr") {
      this._popUntil("tr");
      this.mode = InsertionMode.IN_TABLE_BODY;
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "table") {
      this._popUntil("table");
      this.mode = InsertionMode.IN_BODY;
      return;
    }
    return this._handleInTable(token);
  }

  _handleInCell(token) {
    if (token instanceof Tag && token.kind === Tag.END && (token.name === "td" || token.name === "th")) {
      this._popUntil(token.name);
      this.mode = InsertionMode.IN_ROW;
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START && (token.name === "td" || token.name === "th")) {
      this._popUntil("td");
      this.mode = InsertionMode.IN_ROW;
      return this._handleInRow(token);
    }
    return this._handleInBody(token);
  }

  _handleInFrameset(token) {
    if (token instanceof CharacterTokens) {
      const chars = token.data.split("");
      let whitespace = "";
      for (const ch of chars) {
        if (isAllWhitespace(ch)) {
          whitespace += ch;
        } else {
          this._error("unexpected-char-in-frameset");
        }
      }
      if (whitespace) {
        this._insertText(whitespace);
      }
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof DoctypeToken) {
      this._error("unexpected-doctype");
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START && token.name === "frameset") {
      const node = this._insertElement("frameset", token.attrs);
      this.open_elements.push(node);
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "frameset") {
      this._popUntil("frameset");
      this.mode = InsertionMode.AFTER_FRAMESET;
      return;
    }
    if (token instanceof EOFToken) {
      this._error("eof-in-frameset");
      return;
    }
  }

  _handleAfterFrameset(token) {
    if (token instanceof CharacterTokens) {
      const chars = token.data.split("");
      let whitespace = "";
      for (const ch of chars) {
        if (isAllWhitespace(ch)) {
          whitespace += ch;
        } else {
          this._error("unexpected-char-after-frameset");
        }
      }
      if (whitespace) {
        this._insertText(whitespace);
      }
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END && token.name === "html") {
      this.mode = InsertionMode.AFTER_AFTER_FRAMESET;
      return;
    }
    if (token instanceof EOFToken) {
      return;
    }
    this._error("unexpected-token-after-frameset");
  }

  _handleAfterBody(token) {
    if (token instanceof CharacterTokens && isAllWhitespace(token.data)) {
      this._insertText(token.data);
      return;
    }
    if (token instanceof CommentToken) {
      this._currentNode().appendChild(new SimpleDomNode("#comment", null, token.data));
      return;
    }
    if (token instanceof Tag && token.kind === Tag.START && token.name === "html") {
      return this._handleInBody(token);
    }
    if (token instanceof EOFToken) {
      return;
    }
    this.mode = InsertionMode.IN_BODY;
    return this._handleInBody(token);
  }

  _currentNode() {
    return this.open_elements[this.open_elements.length - 1] || this.document;
  }

  _insertElement(name, attrs) {
    const node = name === "template" ? new TemplateNode(name, attrs, "html") : new ElementNode(name, attrs, "html");
    this._currentNode().appendChild(node);
    return node;
  }

  _insertText(text) {
    if (!text) return;
    const node = new TextNode(text);
    this._currentNode().appendChild(node);
  }

  _popUntil(name) {
    for (let i = this.open_elements.length - 1; i > 0; i -= 1) {
      if (this.open_elements[i].name === name) {
        this.open_elements.splice(i);
        return;
      }
    }
  }

  _closeIfOpen(name) {
    for (let i = this.open_elements.length - 1; i > 0; i -= 1) {
      if (this.open_elements[i].name === name) {
        this.open_elements.splice(i);
        return;
      }
    }
  }

  _findOpenElement(name) {
    for (let i = this.open_elements.length - 1; i > 0; i -= 1) {
      if (this.open_elements[i].name === name) {
        return i;
      }
    }
    return -1;
  }

  _findOpenNode(name) {
    const idx = this._findOpenElement(name);
    if (idx === -1) return null;
    return this.open_elements[idx];
  }

  _insertTableBody() {
    const tbody = this._insertElement("tbody", {});
    this.open_elements.push(tbody);
    this.mode = InsertionMode.IN_TABLE_BODY;
  }

  _error(code, tagName = null) {
    if (!this.collect_errors) return;
    const message = generateErrorMessage(code, tagName);
    this.errors.push(new ParseError(code, null, null, message));
  }
}
