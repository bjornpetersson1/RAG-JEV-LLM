/**
 * Wraps `build` so it runs once per key object and its result is reused, e.g. statements per
 * database connection or a prompt per vocabulary. Entries go when the key is garbage collected.
 */
export function memoizeByIdentity<K extends object, V>(build: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key) => {
    let value = cache.get(key);
    if (value === undefined) {
      value = build(key);
      cache.set(key, value);
    }
    return value;
  };
}
