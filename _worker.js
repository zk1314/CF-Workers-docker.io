export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const userAgent = (request.headers.get("User-Agent") || "").toLowerCase();
    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";

    // === 配置加载 ===
    const UA_BLOCK_LIST = await parseEnvList(env.UA || "");
    const BLOCKED_UA = ["netcraft", ...UA_BLOCK_LIST];
    const AUTH_URL = "https://auth.docker.io";
    const HUB_HOST = "registry-1.docker.io";

    // === 屏蔽爬虫 UA ===
    if (BLOCKED_UA.some(ua => userAgent.includes(ua))) {
      return makeResponse(await getNginxPage(), {
        "content-type": "text/html; charset=utf-8"
      }, 200);
    }

    // === 处理预检请求 ===
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "*",
          "access-control-max-age": "86400"
        }
      });
    }

    // === 路由映射表 ===
    const ROUTES = {
      "quay": "quay.io",
      "gcr": "gcr.io",
      "k8s-gcr": "k8s.gcr.io",
      "k8s": "registry.k8s.io",
      "ghcr": "ghcr.io",
      "cloudsmith": "docker.cloudsmith.io",
      "nvcr": "nvcr.io",
      "test": HUB_HOST
    };

    let upstreamHost = HUB_HOST;
    let useFakePage = false;

    const hostPrefix = url.hostname.split('.')[0];

    // 优先使用 ns 参数
    const ns = url.searchParams.get("ns");
    if (ns) {
      upstreamHost = ns === "docker.io" ? HUB_HOST : ns;
    } else {
      const route = ROUTES[hostPrefix];
      if (route) {
        upstreamHost = route;
        useFakePage = true;
      }
    }

    // === 构造上游 URL ===
    const upstreamUrl = new URL(url.href);
    upstreamUrl.hostname = upstreamHost;

    // 特殊路径处理
    if (upstreamUrl.pathname.startsWith("/v1/")) {
      upstreamUrl.hostname = "index.docker.io";
    } else if (useFakePage && upstreamUrl.pathname === "/") {
      upstreamUrl.hostname = "hub.docker.com";
    }

    // 修正 library/ 查询
    if (upstreamUrl.searchParams.get("q")?.includes("library/") && upstreamUrl.searchParams.get("q") !== "library/") {
      const q = upstreamUrl.searchParams.get("q").replace("library/", "");
      upstreamUrl.searchParams.set("q", q);
    }

    // === 首页或搜索页伪装 ===
    if (upstreamUrl.pathname === "/" && useFakePage) {
      if (env.URL302) {
        return Response.redirect(env.URL302, 302);
      }
      if (env.URL?.toLowerCase() === "nginx") {
        return makeResponse(await getNginxPage(), {
          "content-type": "text/html; charset=utf-8"
        });
      }
      if (env.URL) {
        return fetch(new Request(env.URL, request));
      }
      return makeResponse(await searchInterface(), {
        "content-type": "text/html; charset=utf-8"
      });
    }

    // === Token 请求代理 ===
    if (upstreamUrl.pathname.includes("/token")) {
      const tokenUrl = `${AUTH_URL}${upstreamUrl.pathname}${upstreamUrl.search}`;
      const tokenReq = new Request(tokenUrl, request);
      const headers = new Headers(request.headers);
      headers.set("Host", "auth.docker.io");
      return fetch(tokenReq, { headers });
    }

    // === v2/library 自动补全 ===
    if (
      upstreamHost === HUB_HOST &&
      /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(upstreamUrl.pathname) &&
      !/^\/v2\/library/.test(upstreamUrl.pathname)
    ) {
      upstreamUrl.pathname = "/v2/library/" + upstreamUrl.pathname.slice(5);
    }

    // === v2/manifests|blobs|tags 请求：自动获取 Token ===
    if (
      upstreamUrl.pathname.startsWith("/v2/") &&
      (upstreamUrl.pathname.includes("/manifests/") ||
       upstreamUrl.pathname.includes("/blobs/") ||
       upstreamUrl.pathname.includes("/tags/") ||
       upstreamUrl.pathname.endsWith("/tags/list"))
    ) {
      const match = upstreamUrl.pathname.match(/^\/v2\/(.+?)\//);
      const repo = match ? match[1] : null;

      if (repo) {
        const scope = `repository:${repo}:pull`;
        const tokenRes = await fetch(`${AUTH_URL}/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`, {
          headers: pickHeaders(request.headers, [
            "User-Agent", "Accept", "Accept-Language", "Accept-Encoding"
          ])
        });

        const tokenData = await tokenRes.json();
        const token = tokenData.token;

        const newHeaders = new Headers(request.headers);
        newHeaders.set("Authorization", `Bearer ${token}`);
        newHeaders.set("Host", upstreamHost);

        const finalReq = new Request(upstreamUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.body
        });

        let res = await fetch(finalReq);
        return rewriteResponse(res, request.url);
      }
    }

    // === 普通请求代理 ===
    const finalHeaders = new Headers(request.headers);
    finalHeaders.set("Host", upstreamHost);
    if (request.headers.has("X-Amz-Content-Sha256")) {
      finalHeaders.set("X-Amz-Content-Sha256", request.headers.get("X-Amz-Content-Sha256"));
    }

    const proxyReq = new Request(upstreamUrl, {
      method: request.method,
      headers: finalHeaders,
      body: request.body
    });

    try {
      const res = await fetch(proxyReq);
      return rewriteResponse(res, request.url);
    } catch (err) {
      return makeResponse(`Proxy Error: ${err.message}`, { "content-type": "text/plain" }, 502);
    }
  }
};

// ================= 工具函数 =================

/**
 * 解析环境变量中的列表（支持逗号、换行、空格分隔）
 * @param {string} str
 * @returns {string[]}
 */
async function parseEnvList(str) {
  return str
    .replace(/[\s"'\r\n]+/g, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 构造响应
 * @param {any} body
 * @param {Object} headers
 * @param {number} status
 * @returns {Response}
 */
function makeResponse(body, headers = {}, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      ...headers
    }
  });
}

/**
 * 提取指定请求头
 * @param {Headers} headers
 * @param {string[]} keys
 * @returns {Object}
 */
function pickHeaders(headers, keys) {
  const result = {};
  for (const key of keys) {
    const value = headers.get(key);
    if (value) result[key] = value;
  }
  return result;
}

/**
 * 重写响应头（修复认证、缓存、CORS）
 * @param {Response} res
 * @param {string} clientUrl
 * @returns {Response}
 */
function rewriteResponse(res, clientUrl) {
  const newHeaders = new Headers(res.headers);
  const workersHost = new URL(clientUrl).origin;

  // 修复 Www-Authenticate
  if (newHeaders.has("Www-Authenticate")) {
    newHeaders.set("Www-Authenticate", res.headers.get("Www-Authenticate").replace(/https?:\/\/[^\/]+\/auth/g, `${workersHost}/token`));
  }

  // 修复 Location 重定向
  if (newHeaders.has("Location")) {
    const loc = newHeaders.get("Location");
    if (loc.startsWith("https://")) {
      const locUrl = new URL(loc);
      locUrl.hostname = new URL(clientUrl).hostname;
      newHeaders.set("Location", locUrl.toString());
    }
  }

  // 设置缓存
  newHeaders.set("Cache-Control", "public, max-age=3600");
  newHeaders.set("access-control-allow-origin", "*");
  newHeaders.set("access-control-expose-headers", "*");

  // 移除安全策略头
  newHeaders.delete("content-security-policy");
  newHeaders.delete("content-security-policy-report-only");
  newHeaders.delete("clear-site-data");

  return new Response(res.body, {
    status: res.status,
    headers: newHeaders
  });
}

// ================= 页面内容 =================

/**
 * 返回伪装的 nginx 页面
 */
async function getNginxPage() {
  return `
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif;}</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working.</p>
</body>
</html>`;
}

/**
 * 返回 Docker 搜索首页
 */
async function searchInterface() {
  return `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>Docker Hub 镜像搜索</title>
  <style>
    body { font-family: -apple-system, sans-serif; text-align: center; margin: 10% auto; max-width: 600px; }
    .logo { margin-bottom: 20px; }
    input[type="text"] { padding: 10px; width: 70%; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 15px; background: #0066ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .tip { color: #666; margin-top: 20px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="logo">
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" fill="#0066ff"><path d="M23.763 6.886c-.065-.053-.673-.512-1.954-.512..."/></svg>
  </div>
  <h1>Docker Hub 镜像搜索</h1>
  <p>快速查找你需要的镜像</p>
  <input type="text" id="q" placeholder="如: nginx, redis, mysql">
  <button onclick="search()">搜索</button>
  <p class="tip">基于 Cloudflare Workers 全球加速</p>
  <script>
    function search() {
      const q = document.getElementById('q').value.trim();
      if (q) location.href = '/search?q=' + encodeURIComponent(q);
    }
    document.getElementById('q').addEventListener('keypress', e => e.key === 'Enter' && search());
    document.getElementById('q').focus();
  </script>
</body>
</html>`;
}
