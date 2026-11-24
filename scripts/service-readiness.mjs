import http from "node:http";

/** Check an HTTP response, not just an open port; never send cookies or credentials. */
export function serviceResponds(port, path, expectedStatus = null, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    let timer;
    const finish = (ready) => {
      clearTimeout(timer);
      resolve(ready);
    };
    const request = http.get({ hostname: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (expectedStatus !== null) {
          body += chunk;
          if (body.length > 64_000) response.destroy();
        }
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 400) return finish(false);
        if (expectedStatus === null) return finish(true);
        try {
          finish(JSON.parse(body).status === expectedStatus);
        } catch {
          finish(false);
        }
      });
      response.on("error", () => finish(false));
      response.on("close", () => { if (!response.complete) finish(false); });
    });
    // An absolute deadline also covers servers that send bytes indefinitely.
    timer = setTimeout(() => {
      request.destroy();
      finish(false);
    }, timeoutMs);
    timer.unref();
    request.on("error", () => finish(false));
  });
}
