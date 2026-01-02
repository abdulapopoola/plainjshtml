import { FragmentContext } from "./context.js";
import { decodeHtml } from "./encoding.js";
import { Tokenizer, TokenizerOpts } from "./tokenizer.js";
import { TreeBuilder } from "./treebuilder.js";

export class StrictModeError extends SyntaxError {
  constructor(error) {
    super(error.message || error.code);
    this.error = error;
  }
}

export class JustHTML {
  constructor(
    html,
    {
      collectErrors = false,
      debug = false,
      encoding = null,
      fragment = false,
      fragmentContext = null,
      iframeSrcdoc = false,
      strict = false,
      tokenizerOpts = null,
      treeBuilder = null,
    } = {},
  ) {
    if (fragmentContext != null) {
      fragment = true;
    }

    if (fragment && fragmentContext == null) {
      fragmentContext = new FragmentContext("div");
    }

    this.debug = Boolean(debug);
    this.fragment_context = fragmentContext;
    this.encoding = null;

    let htmlStr = "";
    if (html instanceof Uint8Array || html instanceof ArrayBuffer || ArrayBuffer.isView(html)) {
      const bytes = html instanceof Uint8Array ? html : new Uint8Array(html.buffer ?? html);
      const [decoded, chosen] = decodeHtml(bytes, encoding);
      htmlStr = decoded;
      this.encoding = chosen;
    } else if (html != null) {
      htmlStr = String(html);
    }

    const shouldCollect = collectErrors || strict;
    this.tree_builder = treeBuilder || new TreeBuilder({
      fragmentContext,
      iframeSrcdoc,
      collectErrors: shouldCollect,
    });
    const opts = tokenizerOpts || new TokenizerOpts();

    if (fragmentContext && !fragmentContext.namespace) {
      const rawtextElements = new Set(["textarea", "title", "style"]);
      const tagName = fragmentContext.tag_name.toLowerCase();
      if (rawtextElements.has(tagName)) {
        opts.initial_state = Tokenizer.RAWTEXT;
        opts.initial_rawtext_tag = tagName;
      } else if (tagName === "plaintext" || tagName === "script") {
        opts.initial_state = Tokenizer.PLAINTEXT;
      }
    }

    this.tokenizer = new Tokenizer(this.tree_builder, opts, {
      collectErrors: shouldCollect,
    });

    this.tokenizer.run(htmlStr);
    this.root = this.tree_builder.finish();

    if (shouldCollect) {
      this.errors = [...this.tokenizer.errors, ...this.tree_builder.errors];
    } else {
      this.errors = [];
    }

    if (strict && this.errors.length) {
      throw new StrictModeError(this.errors[0]);
    }
  }

  query(selector) {
    return this.root.query(selector);
  }

  toHTML({ indent = 0, indentSize = 2, pretty = true, safe = true, policy = null } = {}) {
    return this.root.toHTML({ indent, indentSize, pretty, safe, policy });
  }

  toText({ separator = " ", strip = true, safe = true, policy = null } = {}) {
    return this.root.toText({ separator, strip, safe, policy });
  }

  toMarkdown({ safe = true, policy = null } = {}) {
    return this.root.toMarkdown({ safe, policy });
  }
}
