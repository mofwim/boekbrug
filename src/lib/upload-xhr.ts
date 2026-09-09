// src/lib/upload-xhr.ts
// [INTAKE-VOORTGANG] Send a form and hear how far the bytes are.
// Run: npx tsx --test src/lib/upload-xhr.test.ts
//
// fetch() cannot say how much of an upload has left the phone — the Fetch standard has no upload
// progress. XMLHttpRequest has had it since 2008. So the intake goes over XHR, wrapped to look
// exactly like fetch to its caller: the same URL, the same FormData, the same cookies (same
// origin), and a Response back, so sendWithFit and every `res.json()` after it are untouched.
//
// Two honesty rules live here:
//   · a percentage only when the browser knows the total (lengthComputable). A progress event
//     without a total is not a percentage, and a bar that invents one is a bar that lies;
//   · a failed connection rejects with the TypeError fetch would throw, so the caller's catch —
//     "Toevoegen mislukt, probeer opnieuw" — keeps meaning what it meant.
//
// `make` is injectable for the same reason `send` is in upload-fit.ts: a test runner has no
// XMLHttpRequest, and the wrapping — progress forwarded, status kept, body kept, 204 without a
// body — is exactly what must be proved.

export interface ProgressHandlers {
  /** Called with bytes sent so far and the total, only when the total is known. */
  onProgress?: (sent: number, total: number) => void
  /** Called once the whole body has left the browser — from here on the server is working. */
  onUploaded?: () => void
}

/** The slice of XMLHttpRequest this module touches, so a test can hand in a fake. */
export interface XhrLike {
  open(method: string, url: string): void
  send(body: FormData | null): void
  addEventListener(type: 'load' | 'error' | 'abort', listener: () => void): void
  upload: {
    addEventListener(type: 'progress' | 'load', listener: (e: { lengthComputable: boolean; loaded: number; total: number }) => void): void
  }
  responseType: string
  status: number
  statusText: string
  responseText: string
  getAllResponseHeaders(): string
}

/** "name: value\r\n…" as XHR reports it → the Headers a Response wants. */
export function parseHeaders(raw: string): Headers {
  const headers = new Headers()
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const name = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (name) headers.append(name, value)
  }
  return headers
}

export function postFormWithProgress(
  url: string,
  body: FormData,
  handlers: ProgressHandlers = {},
  make: () => XhrLike = () => new XMLHttpRequest(),
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const xhr = make()
    xhr.open('POST', url)
    xhr.responseType = 'text'
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && e.total > 0) handlers.onProgress?.(e.loaded, e.total)
    })
    xhr.upload.addEventListener('load', () => handlers.onUploaded?.())
    xhr.addEventListener('load', () => {
      const status = xhr.status
      // A Response's status must be 200–599; XHR reports 0 when nothing came back at all, which
      // is the connection failing, not a reply.
      if (status < 200 || status > 599) {
        reject(new TypeError('Network request failed'))
        return
      }
      // A Response may not carry a body on these three statuses — the constructor throws.
      const text = status === 204 || status === 205 || status === 304 ? null : xhr.responseText
      resolve(new Response(text, { status, statusText: xhr.statusText, headers: parseHeaders(xhr.getAllResponseHeaders()) }))
    })
    xhr.addEventListener('error', () => reject(new TypeError('Network request failed')))
    xhr.addEventListener('abort', () => reject(new DOMException('The upload was aborted', 'AbortError')))
    xhr.send(body)
  })
}
