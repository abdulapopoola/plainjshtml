import { SimpleDomNode, ElementNode, TemplateNode, TextNode } from "./node.js";

export class UrlRule {
  constructor({
    allowRelative = true,
    allowFragment = true,
    resolveProtocolRelative = "https",
    allowedSchemes = new Set(),
    allowedHosts = null,
    proxyUrl = null,
    proxyParam = "url",
  } = {}) {
    this.allow_relative = allowRelative;
    this.allow_fragment = allowFragment;
    this.resolve_protocol_relative = resolveProtocolRelative;
    this.allowed_schemes = allowedSchemes;
    this.allowed_hosts = allowedHosts;
    this.proxy_url = proxyUrl;
    this.proxy_param = proxyParam;
  }
}

export class SanitizationPolicy {
  constructor() {
    this.allowed_tags = new Set();
    this.allowed_attributes = new Map();
    this.allowed_url_rules = new Map();
    this.allowed_styles = new Set();
    this.allow_unknown_protocols = false;
  }
}

export const DEFAULT_POLICY = new SanitizationPolicy();
export const DEFAULT_DOCUMENT_POLICY = new SanitizationPolicy();

function cloneNode(node) {
  if (node instanceof TextNode) {
    return node.cloneNode();
  }
  if (node instanceof TemplateNode) {
    return node.cloneNode({ deep: true });
  }
  if (node instanceof ElementNode || node instanceof SimpleDomNode) {
    return node.cloneNode({ deep: true });
  }
  return node;
}

export function sanitize(node, { policy = null } = {}) {
  // Placeholder sanitizer; full policy-driven sanitization will follow.
  // Clone to avoid mutations in caller's tree.
  void policy;
  return cloneNode(node);
}
