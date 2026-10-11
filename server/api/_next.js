// Adapter: runs the existing Vercel-style (req, res) handlers inside a
// Next.js App Router route handler. Handlers in this folder stay untouched.

function createRes() {
  const headers = {};
  let statusCode = 200;
  let body = null;
  let ended = false;

  return {
    get ended() {
      return ended;
    },
    setHeader(name, value) {
      headers[name] = value;
      return this;
    },
    getHeader(name) {
      return headers[name];
    },
    removeHeader(name) {
      delete headers[name];
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      ended = true;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      body = JSON.stringify(data);
      return this;
    },
    send(data) {
      ended = true;
      if (data !== null && data !== undefined) {
        body = typeof data === 'string' ? data : JSON.stringify(data);
      }
      return this;
    },
    end(data) {
      ended = true;
      if (data !== null && data !== undefined) {
        body = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      }
      return this;
    },
    toResponse() {
      return new Response(body, { status: statusCode, headers });
    },
  };
}

export function toRoute(handler) {
  return async function routeHandler(request) {
    const url = new URL(request.url);

    const query = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (key in query) {
        if (Array.isArray(query[key])) query[key].push(value);
        else query[key] = [query[key], value];
      } else {
        query[key] = value;
      }
    }

    const headers = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let text = '';
    try {
      text = await request.text();
    } catch {
      text = '';
    }

    const req = {
      method: request.method || 'GET',
      url: request.url,
      headers,
      query,
      // parseBody() accepts an object or a JSON string; empty bodies -> {}
      body: text ? text : {},
      // readRawBody() (Stripe webhook) picks this up directly
      rawBody: Buffer.from(text || '', 'utf8'),
      socket: {
        remoteAddress:
          (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
          headers['x-real-ip'] ||
          'unknown',
      },
    };

    const res = createRes();
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[api] Unhandled route error:', err);
      if (!res.ended) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
    return res.toResponse();
  };
}
