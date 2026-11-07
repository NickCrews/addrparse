/** Open-addressing hash table from nonzero int32 feature hashes to dense indices. */
export class FeatureTable {
  keys: Int32Array;
  values: Int32Array;
  size = 0;
  private mask: number;

  constructor(capacity = 1024) {
    let slots = 16;
    while (slots < capacity * 2) slots *= 2;
    this.keys = new Int32Array(slots);
    this.values = new Int32Array(slots);
    this.mask = slots - 1;
  }

  /** Index of `key`, or -1. */
  get(key: number): number {
    const keys = this.keys;
    const mask = this.mask;
    let s = key & mask;
    for (;;) {
      const k = keys[s]!;
      if (k === key) return this.values[s]!;
      if (k === 0) return -1;
      s = (s + 1) & mask;
    }
  }

  /** Slot of `key`, inserting it with value `value` when absent. */
  slot(key: number, value: number): number {
    if ((this.size + 1) * 2 > this.keys.length) this.grow();
    const keys = this.keys;
    const mask = this.mask;
    let s = key & mask;
    for (;;) {
      const k = keys[s]!;
      if (k === key) return s;
      if (k === 0) {
        keys[s] = key;
        this.values[s] = value;
        this.size++;
        return s;
      }
      s = (s + 1) & mask;
    }
  }

  private grow(): void {
    const oldKeys = this.keys;
    const oldValues = this.values;
    this.keys = new Int32Array(oldKeys.length * 2);
    this.values = new Int32Array(oldKeys.length * 2);
    this.mask = this.keys.length - 1;
    this.size = 0;
    for (let s = 0; s < oldKeys.length; s++) {
      if (oldKeys[s] !== 0) this.slot(oldKeys[s]!, oldValues[s]!);
    }
  }
}
