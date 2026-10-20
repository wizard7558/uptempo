export type RegistrationAdapterErrorCode = "number_unavailable" | "inventory_incomplete";

/** Safe, non-PII adapter errors used by resumable registration steps. */
export class RegistrationAdapterError extends Error {
  constructor(readonly code: RegistrationAdapterErrorCode) {
    super(code);
    this.name = "RegistrationAdapterError";
  }
}
