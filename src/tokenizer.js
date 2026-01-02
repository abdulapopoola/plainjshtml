import { CommentToken, CharacterTokens, Doctype, DoctypeToken, EOFToken, Tag } from "./tokens.js";

export class TokenizerOpts {
  constructor() {
    this.initial_state = null;
    this.initial_rawtext_tag = null;
  }
}

export class Tokenizer {
  constructor(sink, opts = new TokenizerOpts(), { collectErrors = false, trackNodeLocations = false } = {}) {
    this.sink = sink;
    this.opts = opts;
    this.collect_errors = collectErrors;
    this.track_node_locations = trackNodeLocations;
    this.errors = [];
  }

  run(html) {
    const tagRe = /<[^>]*>/g;
    let lastIndex = 0;

    for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
      const tag = match[0];
      if (match.index > lastIndex) {
        const text = html.slice(lastIndex, match.index);
        this.sink.process(new CharacterTokens(text));
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
        const { name, attrs, selfClosing } = parseStartTag(tag);
        this.sink.process(new Tag(Tag.START, name, attrs, selfClosing));
      }

      lastIndex = tagRe.lastIndex;
    }

    if (lastIndex < html.length) {
      this.sink.process(new CharacterTokens(html.slice(lastIndex)));
    }

    this.sink.process(new EOFToken());
  }
}

function parseStartTag(tag) {
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
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[key] = value;
    }
  }

  return { name, attrs, selfClosing };
}
