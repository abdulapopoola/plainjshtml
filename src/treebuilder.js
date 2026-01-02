import { VOID_ELEMENTS } from "./constants.js";
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
      default:
        return this._handleInBody(token);
    }
  }

  finish() {
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
      if (token.name === "html") {
        return this._handleInBody(token);
      }
    }
    if (token instanceof EOFToken) {
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
      const node = this._insertElement(token.name, token.attrs);
      if (!token.self_closing && !VOID_ELEMENTS.has(token.name)) {
        this.open_elements.push(node);
      }
      return;
    }
    if (token instanceof Tag && token.kind === Tag.END) {
      this._popUntil(token.name);
      return;
    }
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

  _error(code) {
    if (!this.collect_errors) return;
    const message = generateErrorMessage(code);
    this.errors.push(new ParseError(code, null, null, message));
  }
}
