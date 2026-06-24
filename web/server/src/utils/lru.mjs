export class LruCache {
  constructor(limit = 100) {
    this.limit = limit;
    this.items = new Map();
  }

  get(key) {
    if (!this.items.has(key)) return undefined;
    const value = this.items.get(key);
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  set(key, value) {
    this.items.delete(key);
    this.items.set(key, value);
    if (this.items.size > this.limit) {
      this.items.delete(this.items.keys().next().value);
    }
    return value;
  }

  clear() {
    this.items.clear();
  }

  deleteWhere(predicate) {
    let deleted = 0;
    for (const key of this.items.keys()) {
      if (predicate(key)) {
        this.items.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}
