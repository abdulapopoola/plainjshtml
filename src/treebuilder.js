import { VOID_ELEMENTS } from "./constants.js";
import { ElementNode, SimpleDomNode, TextNode } from "./node.js";
import { CharacterTokens, CommentToken, DoctypeToken, EOFToken, Tag } from "./tokens.js";

export class TreeBuilder {
  constructor({ fragmentContext = null, collectErrors = false } = {}) {
    this.fragment_context = fragmentContext;
    this.collect_errors = collectErrors;
    this.errors = [];
    this.document = new SimpleDomNode(fragmentContext ? "#document-fragment" : "#document");
    this.open_elements = [this.document];
  }

  process(token) {
    if (token instanceof CharacterTokens) {
      this._insertText(token.data);
      return;
    }
    if (token instanceof CommentToken) {
      const node = new SimpleDomNode("#comment", null, token.data);
      this._currentNode().appendChild(node);
      return;
    }
    if (token instanceof DoctypeToken) {
      const node = new SimpleDomNode("!doctype", null, token.doctype);
      this._currentNode().appendChild(node);
      return;
    }
    if (token instanceof Tag) {
      if (token.kind === Tag.START) {
        const node = new ElementNode(token.name, token.attrs, "html");
        this._currentNode().appendChild(node);
        if (!token.self_closing && !VOID_ELEMENTS.has(token.name)) {
          this.open_elements.push(node);
        }
      } else {
        this._popUntil(token.name);
      }
      return;
    }
    if (token instanceof EOFToken) {
      return;
    }
  }

  finish() {
    return this.document;
  }

  _currentNode() {
    return this.open_elements[this.open_elements.length - 1];
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
}
