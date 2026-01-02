# plainjshtml spec

## Goal
Build a zero-dependency JavaScript port of `../justhtml` that passes the full `../html5lib-tests` suite and ships an API that mirrors JustHTML's public surface, while working in both browsers and Node.js.

## Guiding principles
- Correctness first: HTML5 tokenizer + tree builder must match html5lib test fixtures.
- Zero dependencies: plain JS only (ES2020+), no DOM reliance.
- Same ergonomic API: keep method names and behavior aligned with JustHTML unless JS ergonomics demand tiny adjustments.
- Environment-neutral: works in browsers, Node.js, and workers.

## Public API (JS)

### Main entry points
```js
import {
  JustHTML,
  stream,
  sanitize,
  DEFAULT_POLICY,
  DEFAULT_DOCUMENT_POLICY,
  SanitizationPolicy,
  UrlRule,
  FragmentContext,
  StrictModeError,
} from "plainjshtml";
```

### `JustHTML`
```js
new JustHTML(html, {
  strict = false,
  collectErrors = false,
  encoding = null,
  fragment = false,
  fragmentContext = null,
} = {})
```
- `html`: `string | Uint8Array | ArrayBuffer | Buffer` (Node) or any ArrayBufferView.
- `strict`: throw on earliest parse error.
- `collectErrors`: keep all errors in `errors`.
- `encoding`: override encoding for byte input.
- `fragment`: parse as fragment in a default `<div>` context.
- `fragmentContext`: explicit context element for fragment parsing.

Properties:
- `root`: `SimpleDomNode` (`#document` or `#document-fragment`)
- `errors`: `ParseError[]` (only if `collectErrors`)
- `encoding`: resolved encoding (for byte input)

Methods:
- `toText({ separator = " ", strip = true, safe = true, policy = null } = {})`
- `toHTML({ indent = 2, safe = true, policy = null } = {})`
- `toMarkdown({ safe = true, policy = null } = {})`
- `query(selector)`: returns `SimpleDomNode[]`

### `SimpleDomNode`
Represents element/text/comment/document nodes.

Properties:
- `name`: tag name or `#text`, `#comment`, `#document`, `#document-fragment`
- `attrs`: object map of attributes (elements only)
- `children`: `SimpleDomNode[]`
- `parent`: `SimpleDomNode | null`
- `text`: text content for text/comment nodes (empty string for others)

Methods:
- `toHTML({ indent = 2, safe = true, policy = null } = {})`
- `toText({ separator = " ", strip = true, safe = true, policy = null } = {})`
- `toMarkdown({ safe = true, policy = null } = {})`
- `query(selector)`

### `stream(input, options)`
```js
for (const [event, data] of stream(html, { encoding })) {
  // event: "start" | "end" | "text" | "comment" | "doctype"
}
```
Events:
- `"start"`: `[tagName, attrsObject]`
- `"end"`: `tagName`
- `"text"`: `text`
- `"comment"`: `text`
- `"doctype"`: `name`

### Fragment context
```js
new FragmentContext(tagName, { namespace = null } = {})
```
- `namespace`: `null` (HTML), `"svg"`, or `"math"`.

### Sanitization
```js
sanitize(node, { policy = null } = {})
```
- Returns a sanitized clone.
- `DEFAULT_POLICY` and `DEFAULT_DOCUMENT_POLICY` mirror JustHTML defaults.

`SanitizationPolicy` and `UrlRule` match the Python shape, with JS-friendly options:
```js
new UrlRule({
  allowRelative = true,
  allowFragment = true,
  resolveProtocolRelative = "https",
  allowedSchemes = new Set(),
  allowedHosts = null,
  proxyUrl = null,
  proxyParam = "url",
})
```

### Errors
- `StrictModeError`: thrown in `strict` mode.
- `ParseError`: instances stored in `errors` with `{ code, message, line, col }`.

## CSS selector support
Match the JustHTML selector surface:
- Tag, class, id, universal.
- Attribute selectors: `=`, `^=`, `$=`, `*=`, `~=`, `|=`.
- Combinators: descendant, child, adjacent, sibling.
- Pseudo-classes: `:first-child`, `:last-child`, `:only-child`, `:nth-child`, `:nth-last-child`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-of-type`, `:nth-last-of-type`, `:empty`, `:root`, `:not(...)`, and non-standard `:contains("...")`.
- Groups with commas.

## Encoding behavior
- For byte input, implement HTML encoding sniffing + `windows-1252` fallback.
- Expose resolved `encoding` on `JustHTML` instances.

## Project layout (proposed)
```
src/
  index.js              // public exports
  parser/               // tokenizer + tree builder + state machines
  dom/                  // SimpleDomNode, tree helpers
  stream/               // streaming parser wrapper
  selectors/            // CSS selector parser + matcher
  sanitize/             // policy, url rules, sanitizer
  encoding/             // sniffing + decoding
  markdown/             // html-to-markdown conversion
  html/                 // serializer
```

## Compatibility targets
- ESM build by default; optional CJS wrapper for Node.
- No reliance on DOM globals (`document`, `DOMParser`).
- Works in modern browsers, Node.js, Deno, and workers.

## Implementation plan
1. Audit JustHTML behavior:
   - Review `docs/api.md`, `docs/sanitization.md`, `docs/streaming.md`, `docs/encoding.md`, and selector docs to match semantics.
   - Extract parse error codes and fragment parsing rules.
2. Build a thin vertical slice:
   - Parse a simple, valid HTML document end-to-end.
   - Verify `root`, `toHTML()`, and `toText()` return expected results.
3. Port core parser:
   - Tokenizer state machine (HTML5 spec).
   - Tree builder, insertion modes, active formatting elements.
   - Implement parse error reporting with line/col tracking.
4. DOM model + serializer:
   - Implement `SimpleDomNode` tree and HTML serializer with pretty/compact output.
5. Encoding:
   - Implement HTML encoding sniffing and byte decoding.
6. Stream API:
   - Expose event-driven parser without building the full tree.
7. CSS selector engine:
   - Parse selectors and match against `SimpleDomNode` trees.
8. Sanitization + Markdown:
   - Implement policy-driven sanitizer and HTML-to-Markdown conversion.
9. Test harness:
   - Port `../justhtml/run_tests.py` logic to JS runner.
   - Run `../html5lib-tests` tree-construction fixtures and compare DOM serialization.
   - Add unit tests for sanitizer, selectors, and encoding.

## Open questions
- Do we need a CLI equivalent for Node (like `justhtml`)?
- Should we expose a `parse` function as a functional alias of `new JustHTML(...)`?
- Should `toHTML` use `indent = 2` or `indentSize = 2` (JS naming)?
