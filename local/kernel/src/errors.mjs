export class KernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details = {}) {
  if (!condition) {
    throw new KernelError(code, message, details);
  }
}
