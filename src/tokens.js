export class Tag {
  static START = 0;
  static END = 1;

  constructor(kind, name, attrs = null, selfClosing = false, startPos = null) {
    this.kind = kind;
    this.name = name;
    this.attrs = attrs ?? {};
    this.self_closing = Boolean(selfClosing);
    this.start_pos = startPos;
  }
}

export class CharacterTokens {
  constructor(data) {
    this.data = data;
  }
}

export class CommentToken {
  constructor(data, startPos = null) {
    this.data = data;
    this.start_pos = startPos;
  }
}

export class Doctype {
  constructor(name = null, publicId = null, systemId = null, forceQuirks = false) {
    this.name = name;
    this.public_id = publicId;
    this.system_id = systemId;
    this.force_quirks = Boolean(forceQuirks);
  }
}

export class DoctypeToken {
  constructor(doctype) {
    this.doctype = doctype;
  }
}

export class EOFToken {}

export class TokenSinkResult {
  static Continue = 0;
  static Plaintext = 1;
}

export class ParseError {
  constructor(code, line = null, column = null, message = null, sourceHtml = null, endColumn = null) {
    this.code = code;
    this.line = line;
    this.column = column;
    this.message = message ?? code;
    this._source_html = sourceHtml;
    this._end_column = endColumn;
  }

  toString() {
    if (this.line != null && this.column != null) {
      if (this.message !== this.code) {
        return `(${this.line},${this.column}): ${this.code} - ${this.message}`;
      }
      return `(${this.line},${this.column}): ${this.code}`;
    }
    if (this.message !== this.code) {
      return `${this.code} - ${this.message}`;
    }
    return this.code;
  }

  asException(endColumn = null) {
    if (this.line == null || this.column == null || !this._source_html) {
      const err = new SyntaxError(this.message);
      err.msg = this.message;
      return err;
    }

    const lines = this._source_html.split("\n");
    if (this.line < 1 || this.line > lines.length) {
      const err = new SyntaxError(this.message);
      err.msg = this.message;
      return err;
    }

    const errorLine = lines[this.line - 1];
    const err = new SyntaxError(this.message);
    err.filename = "<html>";
    err.lineno = this.line;
    err.offset = this.column;
    err.text = errorLine;
    err.msg = this.message;

    const resolvedEnd = this._end_column ?? endColumn;
    if (resolvedEnd != null) {
      err.end_lineno = this.line;
      err.end_offset = resolvedEnd;
    }

    return err;
  }
}
