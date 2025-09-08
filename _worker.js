// _worker.js

// Docker镜像仓库主机地址配置
const REGISTRY_CONFIG = {
  // 生产环境
  "quay": "quay.io",
  "gcr": "gcr.io",
  "k8s-gcr": "k8s.gcr.io", 
  "k8s": "registry.k8s.io",
  "ghcr": "ghcr.io",
  "cloudsmith": "docker.cloudsmith.io",
  "nvcr": "nvcr.io",
  // 测试环境
  "test": "registry-1.docker.io",
  // 默认
  "default": "registry-1.docker.io"
};

// Docker认证服务器地址
const AUTH_URL = 'https://auth.docker.io';

// 默认屏蔽的UA列表
const DEFAULT_BLOCKED_UAS = ['netcraft', 'zgrab', 'masscan', 'nmap', 'sqlmap', 'wpscan', 'nikto'];

// 响应头配置
const RESPONSE_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
  'access-control-max-age': '1728000',
  'cache-control': 'public, max-age=3600'
};

/**
 * 根据主机名选择对应的上游地址
 * @param {string} host 主机名
 * @returns {Array} [上游地址, 是否显示搜索界面]
 */
function routeByHost(host) {
  const hostTop = host.split('.')[0];
  return REGISTRY_CONFIG[hostTop] 
    ? [REGISTRY_CONFIG[hostTop], false] 
    : [REGISTRY_CONFIG.default, true];
}

/**
 * 构造响应
 * @param {any} body 响应体
 * @param {number} status 响应状态码
 * @param {Object} headers 响应头
 */
function createResponse(body, status = 200, headers = {}) {
  const responseHeaders = new Headers({
    ...RESPONSE_HEADERS,
    ...headers
  });
  
  return new Response(body, { status, headers: responseHeaders });
}

/**
 * 安全地构造URL对象
 * @param {string} urlStr URL字符串
 * @param {string} base URL base
 */
function safeCreateUrl(urlStr, base) {
  try {
    return new URL(urlStr, base);
  } catch (err) {
    console.error('URL creation error:', err);
    return null;
  }
}

/**
 * 获取NGINX欢迎页面
 */
async function getNginxWelcomePage() {
  return `
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
  body {
    width: 35em;
    margin: 0 auto;
    font-family: Tahoma, Verdana, Arial, sans-serif;
  }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}

/**
 * 获取搜索界面
 */
async function getSearchInterface() {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Docker Hub 镜像搜索</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
  :root {
    --github-color: rgb(27,86,198);
    --github-bg-color: #ffffff;
    --primary-color: #0066ff;
    --primary-dark: #0052cc;
    --gradient-start: #1a90ff;
    --gradient-end: #003eb3;
    --text-color: #ffffff;
    --shadow-color: rgba(0,0,0,0.1);
    --transition-time: 0.3s;
  }
  
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    margin: 0;
    background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
    padding: 20px;
    color: var(--text-color);
    overflow-x: hidden;
  }

  .container {
    text-align: center;
    width: 100%;
    max-width: 800px;
    padding: 20px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 60vh;
    animation: fadeIn 0.8s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .github-corner {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 999;
    transition: transform var(--transition-time) ease;
  }
  
  .github-corner:hover {
    transform: scale(1.08);
  }

  .github-corner svg {
    fill: var(--github-bg-color);
    color: var(--github-color);
    position: absolute;
    top: 0;
    border: 0;
    right: 0;
    width: 80px;
    height: 80px;
    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.2));
  }

  .logo {
    margin-bottom: 20px;
    transition: transform var(--transition-time) ease;
    animation: float 6s ease-in-out infinite;
  }
  
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }
  
  .logo:hover {
    transform: scale(1.08) rotate(5deg);
  }
  
  .logo svg {
    filter: drop-shadow(0 5px 15px rgba(0, 0, 0, 0.2));
  }
  
  .title {
    color: var(--text-color);
    font-size: 2.3em;
    margin-bottom: 10px;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    font-weight: 700;
    letter-spacing: -0.5px;
    animation: slideInFromTop 0.5s ease-out 0.2s both;
  }
  
  @keyframes slideInFromTop {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .subtitle {
    color: rgba(255, 255, 255, 0.9);
    font-size: 1.1em;
    margin-bottom: 25px;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.4;
    animation: slideInFromTop 0.5s ease-out 0.4s both;
  }
  
  .search-container {
    display: flex;
    align-items: stretch;
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    height: 55px;
    position: relative;
    animation: slideInFromBottom 0.5s ease-out 0.6s both;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    border-radius: 12px;
    overflow: hidden;
  }
  
  @keyframes slideInFromBottom {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  #search-input {
    flex: 1;
    padding: 0 20px;
    font-size: 16px;
    border: none;
    outline: none;
    transition: all var(--transition-time) ease;
    height: 100%;
  }
  
  #search-input:focus {
    padding-left: 25px;
  }
  
  #search-button {
    width: 60px;
    background-color: var(--primary-color);
    border: none;
    cursor: pointer;
    transition: all var(--transition-time) ease;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  
  #search-button svg {
    transition: transform 0.3s ease;
    stroke: white;
  }
  
  #search-button:hover {
    background-color: var(--primary-dark);
  }
  
  #search-button:hover svg {
    transform: translateX(2px);
  }
  
  #search-button:active svg {
    transform: translateX(4px);
  }
  
  .tips {
    color: rgba(255, 255, 255, 0.8);
    margin-top: 20px;
    font-size: 0.9em;
    animation: fadeIn 0.5s ease-out 0.8s both;
    transition: transform var(--transition-time) ease;
  }
  
  .tips:hover {
    transform: translateY(-2px);
  }
  
  @media (max-width: 768px) {
    .container {
      padding: 20px 15px;
      min-height: 60vh;
    }
    
    .title {
      font-size: 2em;
    }
    
    .subtitle {
      font-size: 1em;
      margin-bottom: 20px;
    }
    
    .search-container {
      height: 50px;
    }
  }
  
  @media (max-width: 480px) {
    .container {
      padding: 15px 10px;
      min-height: 60vh;
    }
    
    .github-corner svg {
      width: 60px;
      height: 60px;
    }
    
    .search-container {
      height: 45px;
    }
    
    .search-input {
      padding: 0 15px;
    }
    
    .search-button {
      width: 50px;
    }
    
    .search-button svg {
      width: 18px;
      height: 18px;
    }
    
    .title {
      font-size: 1.7em;
      margin-bottom: 8px;
    }
    
    .subtitle {
      font-size: 0.95em;
      margin-bottom: 18px;
    }
  }
  </style>
</head>
<body>
  <a href="https://github.com/cmliu/CF-Workers-docker.io" target="_blank" class="github-corner" aria-label="View source on Github">
    <svg viewBox="0 0 250 250" aria-hidden="true">
      <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
      <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path>
      <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path>
    </svg>
  </a>
  <div class="container">
    <div class="logo">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18" fill="#ffffff" width="110" height="85">
        <path d="M23.763 6.886c-.065-.053-.673-.512-1.954-.512-.32 0-.659.03-1.01.087-.248-1.703-1.651-2.533-1.716-2.57l-.345-.2-.227.328a4.596 4.596 0 0 0-.611 1.433c-.23.972-.09 1.884.403 2.666-.596.331-1.546.418-1.744.42H.752a.753.753 0 0 0-.75.749c-.007 1.456.233 2.864.692 4.07.545 1.43 1.355 2.483 2.409 3.13 1.181.725 3.104 1.14 5.276 1.14 1.016 0 2.03-.092 2.93-.266 1.417-.273 2.705-.742 3.826-1.391a10.497 10.497 0 0 0 2.610-2.140c1.252-1.420 1.998-3.005 2.553-4.408.075.003.148.005.221.005 1.371 0 2.215-.550 2.680-1.010.505-.500.685-.998.704-1.053L24 7.076l-.237-.190Z"></path>
        <path d="M2.216 8.075h2.119a.186.186 0 0 0 .185-.186V6a.186.186 0 0 0-.185-.186H2.216A.186.186 0 0 0 2.031 6v1.89c0 .103.083.186.185.186Zm2.92 0h2.118a.185.185 0 0 0 .185-.186V6a.185.185 0 0 0-.185-.186H5.136A.185.185 0 0 0 4.95 6v1.89c0 .103.083.186.186.186Zm2.964 0h2.118a.186.186 0 0 0 .185-.186V6a.186.186 0 0 0-.185-.186H8.1A.185.185 0 0 0 7.914 6v1.89c0 .103.083.186.186.186Zm2.928 0h2.119a.185.185 0 0 0 .185-.186V6a.185.185 0 0 0-.185-.186h-2.119a.186.186 0 0 0-.185.186v1.89c0 .103.083.186.185.186Zm-5.892-2.72h2.118a.185.185 0 0 0 .185-.186V3.28a.186.186 0 0 0-.185-.186H5.136a.186.186 0 0 0-.186.186v1.89c0 .103.083.186.186.186Zm2.964 0h2.118a.186.186 0 0 0 .185-.186V3.28a.186.186 0 0 0-.185-.186H8.1a.186.186 0 0 0-.186.186v1.89c0 .103.083.186.186.186Zm2.928 0h2.119a.185.185 0 0 0 .185-.186V3.28a.186.186 0 0 0-.185-.186h-2.119a.186.186 0 0 0-.185.186v1.89c0 .103.083.186.185.186Zm0-2.72h2.119a.186.186 0 0 0 .185-.186V.56a.185.185 0 0 0-.185-.186h-2.119a.186.186 0 0 0-.185.186v1.89c0 .103.083.186.185.186Zm2.955 5.44h2.118a.185.185 0 0 0 .186-.186V6a.185.185 0 0 0-.186-.186h-2.118a.185.185 0 0 0-.185.186v1.89c0 .103.083.186.185.186Z"></path>
      </svg>
    </div>
    <h1 class="title">Docker Hub 镜像搜索</h1>
    <p class="subtitle">快速查找、下载和部署 Docker 容器镜像</p>
    <div class="search-container">
      <input type="text" id="search-input" class="search-input" placeholder="输入关键词搜索镜像，如: nginx, mysql, redis...">
      <button id="search-button" class="search-button" title="搜索">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M13 5l7 7-7 7M5 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>
    </div>
    <p class="tips">基于 Cloudflare Workers / Pages 构建，利用全球边缘网络实现毫秒级响应。</p>
  </div>
  <script>
  function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (query) {
      window.location.href = '/search?q=' + encodeURIComponent(query);
    }
  }

  document.getElementById('search-button').addEventListener('click', performSearch);
  document.getElementById('search-input').addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
      performSearch();
    }
  });

  // 添加焦点在搜索框
  window.addEventListener('load', function() {
    document.getElementById('search-input').focus();
  });
  </script>
</body>
</html>`;
}

/**
 * 处理Docker认证令牌请求
 * @param {Request} request 原始请求
 * @param {URL} url 请求URL
 */
async function handleTokenRequest(request, url) {
  const tokenHeaders = {
    'Host': 'auth.docker.io',
    'User-Agent': request.headers.get("User-Agent") || '',
    'Accept': request.headers.get("Accept") || '*/*',
    'Accept-Language': request.headers.get("Accept-Language") || '',
    'Accept-Encoding': request.headers.get("Accept-Encoding") || '',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0'
  };
  
  const tokenUrl = `${AUTH_URL}${url.pathname}${url.search}`;
  return fetch(new Request(tokenUrl, { headers: tokenHeaders }));
}

/**
 * 获取Docker Registry令牌
 * @param {string} repo 仓库名称
 */
async function getRegistryToken(repo) {
  const tokenUrl = `${AUTH_URL}/token?service=registry.docker.io&scope=repository:${repo}:pull`;
  
  try {
    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) {
      throw new Error(`Token request failed: ${tokenRes.status}`);
    }
    
    const tokenData = await tokenRes.json();
    return tokenData.token;
  } catch (error) {
    console.error('Failed to get registry token:', error);
    return null;
  }
}

/**
 * 处理Docker Registry API请求
 * @param {Request} request 原始请求
 * @param {URL} url 请求URL
 * @param {string} hubHost 上游主机
 * @param {string} workersUrl Workers URL
 */
async function handleRegistryRequest(request, url, hubHost, workersUrl) {
  // 提取镜像名
  let repo = '';
  const v2Match = url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/);
  if (v2Match) {
    repo = v2Match[1];
  }
  
  if (!repo) {
    return createResponse('Invalid repository path', 400);
  }
  
  // 获取认证令牌
  const token = await getRegistryToken(repo);
  if (!token) {
    return createResponse('Failed to obtain authentication token', 500);
  }
  
  // 构造请求参数
  const requestHeaders = {
    'Host': hubHost,
    'User-Agent': request.headers.get("User-Agent") || '',
    'Accept': request.headers.get("Accept") || '*/*',
    'Accept-Language': request.headers.get("Accept-Language") || '',
    'Accept-Encoding': request.headers.get("Accept-Encoding") || '',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Authorization': `Bearer ${token}`
  };
  
  // 添加可能存在字段X-Amz-Content-Sha256
  if (request.headers.has("X-Amz-Content-Sha256")) {
    requestHeaders['X-Amz-Content-Sha256'] = request.headers.get("X-Amz-Content-Sha256");
  }
  
  // 发起请求
  const requestInit = {
    method: request.method,
    headers: requestHeaders,
    cacheTtl: 3600
  };
  
  let response = await fetch(url.toString(), requestInit);
  
  // 处理响应头
  const responseHeaders = new Headers(response.headers);
  
  // 修改 Www-Authenticate 头
  if (responseHeaders.has("Www-Authenticate")) {
    const authHeader = responseHeaders.get("Www-Authenticate");
    responseHeaders.set("Www-Authenticate", authHeader.replace(
      new RegExp(AUTH_URL, 'g'), 
      workersUrl
    ));
  }
  
  // 处理重定向
  if (responseHeaders.has("Location")) {
    const location = responseHeaders.get("Location");
    console.info(`Found redirection location, redirecting to ${location}`);
    return handleHttpRequest(request, location, hubHost);
  }
  
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  });
}

/**
 * 处理HTTP请求
 * @param {Request} request 原始请求
 * @param {string} pathname 请求路径
 * @param {string} baseHost 基地址
 */
async function handleHttpRequest(request, pathname, baseHost) {
  // 处理预检请求
  if (request.method === 'OPTIONS' && request.headers.has('access-control-request-headers')) {
    return new Response(null, {
      headers: RESPONSE_HEADERS
    });
  }
  
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("Authorization"); // 修复S3错误
  
  const url = safeCreateUrl(pathname, `https://${baseHost}`);
  if (!url) {
    return createResponse('Invalid URL', 400);
  }
  
  const requestInit = {
    method: request.method,
    headers: requestHeaders,
    redirect: 'follow',
    body: request.body
  };
  
  return proxyRequest(url, requestInit);
}

/**
 * 代理请求
 * @param {URL} url 目标URL
 * @param {RequestInit} requestInit 请求配置
 */
async function proxyRequest(url, requestInit) {
  const response = await fetch(url.href, requestInit);
  const responseHeaders = new Headers(response.headers);
  
  responseHeaders.set('access-control-expose-headers', '*');
  responseHeaders.set('access-control-allow-origin', '*');
  responseHeaders.set('Cache-Control', 'max-age=1500');
  
  // 删除不必要的头
  responseHeaders.delete('content-security-policy');
  responseHeaders.delete('content-security-policy-report-only');
  responseHeaders.delete('clear-site-data');
  
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  });
}

/**
 * 解析环境变量中的UA列表
 * @param {string} envUa 环境变量中的UA字符串
 */
function parseBlockedUAs(envUa) {
  if (!envUa) return DEFAULT_BLOCKED_UAS;
  
  try {
    const uaList = envUa
      .replace(/[	 |"'\r\n]+/g, ',')
      .replace(/,+/g, ',')
      .replace(/^,|,$/g, '')
      .split(',');
    
    return [...DEFAULT_BLOCKED_UAS, ...uaList];
  } catch (error) {
    console.error('Failed to parse blocked UAs:', error);
    return DEFAULT_BLOCKED_UAS;
  }
}

/**
 * 主处理函数
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    const userAgentLower = userAgent.toLowerCase();
    
    // 解析屏蔽的UA列表
    const blockedUAs = parseBlockedUAs(env.UA);
    
    // 检查是否需要屏蔽请求
    if (blockedUAs.some(ua => userAgentLower.includes(ua))) {
      return createResponse(await getNginxWelcomePage(), 200, {
        'Content-Type': 'text/html; charset=UTF-8'
      });
    }
    
    const workersUrl = `https://${url.hostname}`;
    
    // 获取命名空间参数
    const ns = url.searchParams.get('ns');
    const hostname = url.searchParams.get('hubhost') || url.hostname;
    
    let hubHost;
    let showSearchInterface;
    
    // 如果存在 ns 参数，优先使用它来确定 hub_host
    if (ns) {
      hubHost = ns === 'docker.io' ? 'registry-1.docker.io' : ns;
      showSearchInterface = false;
    } else {
      [hubHost, showSearchInterface] = routeByHost(hostname);
    }
    
    console.log(`域名: ${hostname} 上游地址: ${hubHost} 显示搜索界面: ${showSearchInterface}`);
    
    // 更改请求的主机名
    url.hostname = hubHost;
    
    // 处理浏览器请求或搜索请求
    const isBrowserRequest = userAgentLower.includes('mozilla');
    const isSearchRequest = ['/v1/search', '/v1/repositories'].some(param => url.pathname.includes(param));
    
    if (isBrowserRequest || isSearchRequest) {
      // 首页处理
      if (url.pathname === '/') {
        if (env.URL302) {
          return Response.redirect(env.URL302, 302);
        } else if (env.URL) {
          if (env.URL.toLowerCase() === 'nginx') {
            return createResponse(await getNginxWelcomePage(), 200, {
              'Content-Type': 'text/html; charset=UTF-8'
            });
          }
          return fetch(new Request(env.URL, request));
        } else if (showSearchInterface) {
          return createResponse(await getSearchInterface(), 200, {
            'Content-Type': 'text/html; charset=UTF-8'
          });
        }
      } else {
        // 特殊路径处理
        if (url.pathname.startsWith('/v1/')) {
          url.hostname = 'index.docker.io';
        } else if (showSearchInterface) {
          url.hostname = 'hub.docker.com';
        }
        
        // 处理 library/ 查询参数
        if (url.searchParams.has('q')) {
          const searchQuery = url.searchParams.get('q');
          if (searchQuery.includes('library/') && searchQuery !== 'library/') {
            url.searchParams.set('q', searchQuery.replace('library/', ''));
          }
        }
        
        return fetch(new Request(url, request));
      }
    }
    
    // 处理token请求
    if (url.pathname.includes('/token')) {
      return handleTokenRequest(request, url);
    }
    
    // 修改 /v2/ 请求路径
    if (hubHost === 'registry-1.docker.io' && 
        /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && 
        !/^\/v2\/library/.test(url.pathname)) {
      url.pathname = '/v2/library/' + url.pathname.split('/v2/')[1];
      console.log(`修改后的URL路径: ${url.pathname}`);
    }
    
    // 处理Docker Registry API请求
    if (url.pathname.startsWith('/v2/') && 
        (url.pathname.includes('/manifests/') ||
         url.pathname.includes('/blobs/') ||
         url.pathname.includes('/tags/') ||
         url.pathname.endsWith('/tags/list'))) {
      return handleRegistryRequest(request, url, hubHost, workersUrl);
    }
    
    // 构造通用请求参数
    const requestHeaders = {
      'Host': hubHost,
      'User-Agent': request.headers.get("User-Agent") || '',
      'Accept': request.headers.get("Accept") || '*/*',
      'Accept-Language': request.headers.get("Accept-Language") || '',
      'Accept-Encoding': request.headers.get("Accept-Encoding") || '',
      'Connection': 'keep-alive',
      'Cache-Control': 'max-age=0'
    };
    
    // 添加认证头
    if (request.headers.has("Authorization")) {
      requestHeaders.Authorization = request.headers.get("Authorization");
    }
    
    // 添加可能存在字段X-Amz-Content-Sha256
    if (request.headers.has("X-Amz-Content-Sha256")) {
      requestHeaders['X-Amz-Content-Sha256'] = request.headers.get("X-Amz-Content-Sha256");
    }
    
    // 发起请求
    const requestInit = {
      method: request.method,
      headers: requestHeaders,
      cacheTtl: 3600
    };
    
    let response = await fetch(url.toString(), requestInit);
    const responseHeaders = new Headers(response.headers);
    
    // 修改 Www-Authenticate 头
    if (responseHeaders.has("Www-Authenticate")) {
      const authHeader = responseHeaders.get("Www-Authenticate");
      responseHeaders.set("Www-Authenticate", authHeader.replace(
        new RegExp(AUTH_URL, 'g'), 
        workersUrl
      ));
    }
    
    // 处理重定向
    if (responseHeaders.has("Location")) {
      const location = responseHeaders.get("Location");
      console.info(`Found redirection location, redirecting to ${location}`);
      return handleHttpRequest(request, location, hubHost);
    }
    
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  }
};
