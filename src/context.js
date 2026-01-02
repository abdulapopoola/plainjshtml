export class FragmentContext {
  constructor(tagName, { namespace = null } = {}) {
    this.tag_name = tagName;
    this.namespace = namespace;
  }
}
