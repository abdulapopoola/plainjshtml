import { sanitize } from "./sanitize.js";
import { query } from "./selector.js";
import { toHtml } from "./serialize.js";

function toTextCollect(node, parts, strip) {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current.name === "#text") {
      let data = current.data;
      if (!data) {
        continue;
      }
      if (strip) {
        data = data.trim();
        if (!data) {
          continue;
        }
      }
      parts.push(data);
      continue;
    }

    if (current instanceof TemplateNode && current.template_content) {
      stack.push(current.template_content);
    }

    if (current.children && current.children.length) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) {
        stack.push(current.children[i]);
      }
    }
  }
}

export class SimpleDomNode {
  constructor(name, attrs = null, data = null, namespace = null) {
    this.name = name;
    this.parent = null;
    this.data = data;
    this._origin_pos = null;
    this._origin_line = null;
    this._origin_col = null;

    if (name.startsWith("#") || name === "!doctype") {
      this.namespace = namespace;
      if (name === "#comment" || name === "!doctype") {
        this.children = null;
        this.attrs = null;
      } else {
        this.children = [];
        this.attrs = attrs ?? {};
      }
    } else {
      this.namespace = namespace ?? "html";
      this.children = [];
      this.attrs = attrs ?? {};
    }
  }

  appendChild(node) {
    if (this.children) {
      this.children.push(node);
      node.parent = this;
    }
  }

  removeChild(node) {
    if (this.children) {
      this.children.splice(this.children.indexOf(node), 1);
      node.parent = null;
    }
  }

  insertBefore(node, referenceNode) {
    if (!this.children) {
      throw new Error(`Node ${this.name} cannot have children`);
    }

    if (referenceNode == null) {
      this.appendChild(node);
      return;
    }

    const index = this.children.indexOf(referenceNode);
    if (index === -1) {
      throw new Error("Reference node is not a child of this node");
    }

    this.children.splice(index, 0, node);
    node.parent = this;
  }

  replaceChild(newNode, oldNode) {
    if (!this.children) {
      throw new Error(`Node ${this.name} cannot have children`);
    }

    const index = this.children.indexOf(oldNode);
    if (index === -1) {
      throw new Error("The node to be replaced is not a child of this node");
    }

    this.children[index] = newNode;
    newNode.parent = this;
    oldNode.parent = null;
    return oldNode;
  }

  hasChildNodes() {
    return Boolean(this.children && this.children.length);
  }

  get origin_offset() {
    return this._origin_pos;
  }

  get origin_line() {
    return this._origin_line;
  }

  get origin_col() {
    return this._origin_col;
  }

  get origin_location() {
    if (this._origin_line == null || this._origin_col == null) {
      return null;
    }
    return [this._origin_line, this._origin_col];
  }

  toHTML({ indent = 0, indentSize = 2, pretty = true, safe = true, policy = null } = {}) {
    return toHtml(this, indent, indentSize, { pretty, safe, policy });
  }

  query(selector) {
    return query(this, selector);
  }

  get text() {
    if (this.name === "#text") {
      return typeof this.data === "string" ? this.data : "";
    }
    return "";
  }

  toText({ separator = " ", strip = true, safe = true, policy = null } = {}) {
    const node = safe ? sanitize(this, { policy }) : this;
    const parts = [];
    toTextCollect(node, parts, strip);
    if (!parts.length) {
      return "";
    }
    return parts.join(separator);
  }

  toMarkdown({ safe = true, policy = null } = {}) {
    if (safe) {
      const node = sanitize(this, { policy });
      return node.toMarkdown({ safe: false });
    }
    throw new Error("Markdown output not implemented yet");
  }

  cloneNode({ deep = false } = {}) {
    const clone = new SimpleDomNode(
      this.name,
      this.attrs ? { ...this.attrs } : null,
      this.data,
      this.namespace,
    );
    clone._origin_pos = this._origin_pos;
    clone._origin_line = this._origin_line;
    clone._origin_col = this._origin_col;
    if (deep && this.children) {
      for (const child of this.children) {
        clone.appendChild(child.cloneNode({ deep: true }));
      }
    }
    return clone;
  }
}

export class ElementNode extends SimpleDomNode {
  constructor(name, attrs, namespace) {
    super(name, attrs, null, namespace);
    this.template_content = null;
  }

  cloneNode({ deep = false } = {}) {
    const clone = new ElementNode(this.name, this.attrs ? { ...this.attrs } : {}, this.namespace);
    clone._origin_pos = this._origin_pos;
    clone._origin_line = this._origin_line;
    clone._origin_col = this._origin_col;
    if (deep) {
      for (const child of this.children) {
        clone.appendChild(child.cloneNode({ deep: true }));
      }
    }
    return clone;
  }
}

export class TemplateNode extends ElementNode {
  constructor(name, attrs = null, namespace = null) {
    super(name, attrs, namespace);
    if (this.namespace === "html") {
      this.template_content = new SimpleDomNode("#document-fragment");
    } else {
      this.template_content = null;
    }
  }

  cloneNode({ deep = false } = {}) {
    const clone = new TemplateNode(this.name, this.attrs ? { ...this.attrs } : {}, this.namespace);
    clone._origin_pos = this._origin_pos;
    clone._origin_line = this._origin_line;
    clone._origin_col = this._origin_col;
    if (deep) {
      if (this.template_content) {
        clone.template_content = this.template_content.cloneNode({ deep: true });
      }
      for (const child of this.children) {
        clone.appendChild(child.cloneNode({ deep: true }));
      }
    }
    return clone;
  }
}

export class TextNode {
  constructor(data) {
    this.data = data;
    this.parent = null;
    this.name = "#text";
    this.namespace = null;
    this._origin_pos = null;
    this._origin_line = null;
    this._origin_col = null;
  }

  get origin_offset() {
    return this._origin_pos;
  }

  get origin_line() {
    return this._origin_line;
  }

  get origin_col() {
    return this._origin_col;
  }

  get origin_location() {
    if (this._origin_line == null || this._origin_col == null) {
      return null;
    }
    return [this._origin_line, this._origin_col];
  }

  get text() {
    return this.data || "";
  }

  toText({ strip = true } = {}) {
    if (this.data == null) {
      return "";
    }
    if (strip) {
      return this.data.trim();
    }
    return this.data;
  }

  toMarkdown() {
    return this.toText({ strip: false });
  }

  cloneNode() {
    const clone = new TextNode(this.data);
    clone._origin_pos = this._origin_pos;
    clone._origin_line = this._origin_line;
    clone._origin_col = this._origin_col;
    return clone;
  }
}
