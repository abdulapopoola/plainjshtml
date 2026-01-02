import { decodeHtml } from "./encoding.js";
import { Tokenizer } from "./tokenizer.js";
import { Tag, CharacterTokens, CommentToken, DoctypeToken, EOFToken } from "./tokens.js";

class StreamSink {
  constructor(events) {
    this.events = events;
  }

  process(token) {
    if (token instanceof Tag) {
      if (token.kind === Tag.START) {
        this.events.push(["start", [token.name, token.attrs]]);
      } else {
        this.events.push(["end", token.name]);
      }
      return;
    }
    if (token instanceof CharacterTokens) {
      this.events.push(["text", token.data]);
      return;
    }
    if (token instanceof CommentToken) {
      this.events.push(["comment", token.data]);
      return;
    }
    if (token instanceof DoctypeToken) {
      this.events.push(["doctype", token.doctype?.name ?? ""]);
      return;
    }
    if (token instanceof EOFToken) {
      return;
    }
  }
}

export function* stream(input, { encoding = null } = {}) {
  let html = "";
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const [decoded] = decodeHtml(bytes, encoding);
    html = decoded;
  } else {
    html = String(input ?? "");
  }

  const events = [];
  const tokenizer = new Tokenizer(new StreamSink(events));
  tokenizer.run(html);

  for (const event of events) {
    yield event;
  }
}
