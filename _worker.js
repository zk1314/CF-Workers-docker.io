// functions/_middleware.js

export async function onRequest(context) {
	return await handleRequest(context);
}

// ==================== 配置 ====================
const DEFAULT_HUB = 'registry-1.docker.io';
const AUTH_URL = 'https://auth.docker.io';
const BLOCKED_UA = ['netcraft', 'crawler', 'bot', 'spider'];
const HUB_PATHS = ['/v1/search', '/v1/repositories'];

const ROUTES = {
	// 生产
	quay: 'quay.io',
	gcr: 'gcr.io',
	'k8s-gcr': 'k8s.gcr.io',
	k8s: 'registry.k8s.io',
	ghcr: 'ghcr.io',
	cloudsmith: 'docker.cloudsmith.io',
	nvcr: 'nvcr.io',
	// 测试
	test: 'registry-1.docker.io',
};

// ==================== 主处理函数 ====================
async function handleRequest({ request, env }) {
	const url = new URL(request.url);
	const headers = request.headers;
	const ua = (headers.get('User-Agent') || '').toLowerCase();

	// 屏蔽爬虫
	const blockUa = [...BLOCKED_UA, ...(env.BLOCK_UA ? await parseEnvList(env.BLOCK_UA) : [])];
	if (blockUa.some(b => ua.includes(b))) {
		return new Response(await getNginxPage(), {
			headers: { 'content-type': 'text/html; charset=utf-8' }
		});
	}

	// 获取 host 头部
	const host = url.searchParams.get('hubhost') || url.hostname;
	const hostTop = host.split('.')[0];
	const ns = url.searchParams.get('ns');

	let upstream = ns || ROUTES[hostTop] || DEFAULT_HUB;
	let isFakePage = !ns && !!ROUTES[hostTop]; // 是否是伪装页（如 k8s → registry.k8s.io）

	console.log(`Host: ${hostTop} → Upstream: ${upstream} (fake: ${isFakePage})`);

	// 重写 URL
	url.hostname = upstream;

	// 首页处理
	if (url.pathname === '/') {
		if (env.REDIRECT_URL) return Response.redirect(env.REDIRECT_URL, 302);
		if (env.HOME === 'nginx') {
			return new Response(await getNginxPage(), {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			});
		}
		if (isFakePage && (env.SEARCH_UI !== 'false')) {
			return new Response(await getSearchPage(), {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			});
		}
	}

	// 特殊路径处理
	if (HUB_PATHS.some(p => url.pathname === p || url.pathname.startsWith(p + '?'))) {
		url.hostname = 'hub.docker.com';
	}

	// /v1/ 路径
	if (url.pathname.startsWith('/v1/')) {
		url.hostname = 'index.docker.io';
	}

	// /v2/ library 注入
	if (url.pathname.startsWith('/v2/') && !url.pathname.startsWith('/v2/library/')) {
		const parts = url.pathname.split('/');
		if (parts.length >= 3) {
			const repo = parts[2];
			if (!repo.includes('/')) {
				url.pathname = `/v2/library/${repo}${url.pathname.slice(`/v2/${repo}`.length)}`;
			}
		}
	}

	// 修复 q=library/nginx → q=nginx
	if (url.searchParams.get('q')?.startsWith('library/')) {
		url.searchParams.set('q', url.searchParams.get('q').replace(/^library\//, ''));
	}

	// Token 请求代理
	if (url.pathname.includes('/token')) {
		const tokenUrl = AUTH_URL + url.pathname + url.search;
		const init = {
			headers: pickHeaders(headers, [
				'User-Agent', 'Accept', 'Accept-Language', 'Accept-Encoding'
			])
		};
		return fetch(tokenUrl, init);
	}

	// /v2/manifests, blobs, tags 等需要 token
	if (
		url.pathname.startsWith('/v2/') &&
		(/\/(manifests|blobs|tags|tags\/list)$/.test(url.pathname) || url.pathname.includes('/manifests/'))
	) {
		const repoMatch = url.pathname.match(/^\/v2\/([^/]+(?:\/[^/]+)*)/);
		const repo = repoMatch ? repoMatch[1] : 'library';
		const tokenData = await getToken(repo, headers);
		const newHeaders = new Headers(headers);
		newHeaders.set('Authorization', `Bearer ${tokenData.token}`);

		const newReq = new Request(url, {
			...request,
			headers: newHeaders
		});

		let res = await fetch(newReq);
		res = await rewriteResponse(res, url, request.headers.get('origin'));
		return res;
	}

	// 普通代理
	const newReq = new Request(url, request);
	let res = await fetch(newReq);
	res = await rewriteResponse(res, url, request.headers.get('origin'));
	return res;
}

// ==================== 工具函数 ====================

async function getToken(repo, headers) {
	const scope = `repository:${repo}:pull`;
	const url = `${AUTH_URL}/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`;
	const cache = await caches.default;
	const cached = await cache.match(url);
	if (cached) return await cached.json();

	const res = await fetch(url, {
		headers: pickHeaders(headers, ['User-Agent', 'Accept', 'Accept-Encoding'])
	});
	const data = await res.json();

	const resp = new Response(JSON.stringify(data));
	resp.headers.set('Cache-Control', 'public, max-age=60');
	await cache.put(url, resp.clone());
	return data;
}

function pickHeaders(headers, keys) {
	const h = {};
	keys.forEach(k => {
		const v = headers.get(k);
		if (v) h[k] = v;
	});
	return h;
}

async function rewriteResponse(res, url, origin) {
	const newHeaders = new Headers(res.headers);
	const auth = newHeaders.get('Www-Authenticate');
	if (auth) {
		newHeaders.set('Www-Authenticate', auth.replace(new RegExp(AUTH_URL, 'g'), url.origin));
	}
	if (newHeaders.get('Location')) {
		const loc = newHeaders.get('Location');
		newHeaders.set('Location', loc.replace(new RegExp(`https?://${res.url.split('/')[2]}`), url.origin));
	}

	if (origin) {
		newHeaders.set('access-control-allow-origin', origin);
		newHeaders.set('access-control-allow-credentials', 'true');
		newHeaders.set('access-control-expose-headers', '*');
	}
	newHeaders.set('Cache-Control', 'public, max-age=300');

	// 安全头清理
	['content-security-policy', 'x-frame-options', 'clear-site-data'].forEach(h => newHeaders.delete(h));

	return new Response(res.body, {
		status: res.status,
		headers: newHeaders
	});
}

// ==================== 页面内容 ====================

async function getNginxPage() {
	return `
		<!DOCTYPE html><html><head><title>Welcome to nginx!</title>
		<style>body{font-family:Arial,sans-serif;text-align:center;margin-top:100px;}</style>
		</head><body><h1>Welcome to nginx!</h1></body></html>
	`;
}

async function getSearchPage() {
	return `
		<!DOCTYPE html><html><head><title>Docker 镜像搜索</title>
		<meta charset="UTF-8">
		<style>body{font-family:Arial;text-align:center;margin:100px auto;max-width:600px;}
		input,button{padding:10px;font-size:16px;}</style>
		</head><body>
		<h1>🔍 Docker 镜像搜索</h1>
		<p>输入镜像名称，如 <code>nginx</code>, <code>redis</code></p>
		<input id="q" placeholder="搜索镜像..." />
		<button onclick="go()">搜索</button>
		<script>function go(){const q=document.getElementById('q').value;location='/v1/search?q='+q;}</script>
		</body></html>
	`;
}

// 解析环境变量列表（逗号、空格、换行分隔）
async function parseEnvList(str) {
	return str
		.replace(/[,\s\n\r\t]+/g, ',')
		.split(',')
		.filter(s => s);
}
