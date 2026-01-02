function collectElements(node, out) {
  if (!node) return;
  if (node.name && !node.name.startsWith("#") && node.name !== "!doctype") {
    out.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      collectElements(child, out);
    }
  }
  if (node.template_content) {
    collectElements(node.template_content, out);
  }
}

export function query(root, selector) {
  const candidates = [];
  collectElements(root, candidates);
  const trimmed = selector.trim();
  if (!trimmed || trimmed === "*") {
    return candidates;
  }
  return candidates.filter((node) => node.name === trimmed.toLowerCase());
}
