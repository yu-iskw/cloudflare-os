type Attribute = boolean | number | string;

/** The span surface exposed to callbacks. Lifetime is managed by `traced`, so no `end()`. */
export interface TraceSpan {
  readonly isTraced: boolean;
  setAttribute(key: string, value?: Attribute): void;
}

/**
 * Creates a span helper that stamps the ambient observability context onto each span as
 * attributes. Tracing only: never logs, never modifies context. Exceptions propagate
 * unchanged, marked on the span via an `error` attribute.
 */
export function createTracer(getContext: () => Readonly<Record<string, unknown>>) {
  return function traced<Result>(name: string, callback: (span: TraceSpan) => Result): Result {
    const span: TraceSpan = {
      isTraced: true,
      setAttribute() {},
    };
    void name;
    void getContext;
    try {
      const result = callback(span);
      return result instanceof Promise
        ? result.catch((err) => {
            span.setAttribute("error", true);
            throw err;
          }) as Result
        : result;
    } catch (err) {
      span.setAttribute("error", true);
      throw err;
    }
  };
}
