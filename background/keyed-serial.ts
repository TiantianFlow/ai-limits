export type KeyedSerialExecutor<Key> = <Result>(
  key: Key,
  operation: () => Promise<Result> | Result,
) => Promise<Result>;

export function createKeyedSerialExecutor<Key>(): KeyedSerialExecutor<Key> {
  const tails = new Map<Key, Promise<void>>();

  return async <Result>(
    key: Key,
    operation: () => Promise<Result> | Result,
  ): Promise<Result> => {
    const ready = (tails.get(key) ?? Promise.resolve()).catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = ready.then(() => gate);
    tails.set(key, tail);
    await ready;
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
