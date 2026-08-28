const MODELS_DEV_URL = "https://catalog.stencil.so/models.json.zstd";
const ZSTD_MAGIC = 0xfd2fb528;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchCatalogJson(
  customFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<unknown> {
  const fetchFn = customFetch ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), DEFAULT_TIMEOUT_MS);

  const abortListener = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw signal.reason;
    }
    signal.addEventListener("abort", abortListener, { once: true });
  }

  try {
    const response = await fetchFn(MODELS_DEV_URL, {
      method: "GET",
      headers: {
        Accept: "application/zstd, application/json",
        "User-Agent": "omp-switch",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`models catalog fetch failed: ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const isZstd = bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === ZSTD_MAGIC;
    const text = new TextDecoder().decode(isZstd ? await Bun.zstdDecompress(bytes) : bytes);
    return JSON.parse(text);
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}
