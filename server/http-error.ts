export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Readonly<Record<string, string>> = {}) { super(message); }
}
