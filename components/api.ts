// Browser-side helpers for talking to Shelf's seller API. Safe to import from client components.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const tokenKey = (shopId: string) => `shelf_token_${shopId}`;

export function getToken(shopId: string): string | null {
  try {
    return window.localStorage.getItem(tokenKey(shopId));
  } catch {
    return null;
  }
}

export function saveToken(shopId: string, token: string) {
  try {
    window.localStorage.setItem(tokenKey(shopId), token);
  } catch {
    // Private mode / blocked storage: the httpOnly cookie set by the server still authenticates.
  }
}

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  shopId?: string;
  signal?: AbortSignal;
};

/** JSON fetch with the seller token attached. Throws ApiError with the server's `{ error }` message. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.shopId) {
    const token = getToken(opts.shopId);
    if (token) headers["x-shop-token"] = token;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Can't reach Shelf. Check your connection and try again.", 0);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const serverMsg = (data as { error?: unknown } | null)?.error;
    const msg =
      typeof serverMsg === "string" && serverMsg
        ? serverMsg
        : res.status === 401
          ? "This shop's key is missing or wrong."
          : `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function errorMessage(err: unknown, fallback = "Something went wrong.") {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
