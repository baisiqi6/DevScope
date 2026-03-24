/**
 * @package @devscope/api
 * @description API 文档页面
 *
 * 提供类似 FastAPI /docs 的交互式 API 文档
 */

import type { FastifyInstance } from "fastify";

/**
 * API 端点信息（手动维护）
 */
const API_ENDPOINTS = [
  {
    path: "health",
    method: "query",
    description: "健康检查接口 - 检查服务是否正常运行",
    input: null,
    output: { status: "string", timestamp: "string" },
  },
  {
    path: "greet",
    method: "query",
    description: "问候接口 - 接收名字并返回问候消息",
    input: { name: "string" },
    output: { message: "string" },
  },
  {
    path: "getTrendingRepos",
    method: "query",
    description: "获取趋势仓库列表 - 从 OSSInsight 获取当前热门的 GitHub 仓库",
    input: { limit: "number (optional)", period: "string (optional)", language: "string (optional)" },
    output: "Array<TrendingRepo>",
  },
  {
    path: "getTrendingByLanguage",
    method: "query",
    description: "按语言获取趋势仓库",
    input: { language: "string", limit: "number" },
    output: "Array<TrendingRepo>",
  },
  {
    path: "getRepoInsights",
    method: "query",
    description: "获取仓库深度洞察 - 从 OSSInsight 获取仓库的综合分析数据",
    input: { owner: "string", repo: "string" },
    output: "RepoInsights",
  },
  {
    path: "getCollection",
    method: "query",
    description: "获取集合统计 - 获取 OSSInsight 预定义的项目集合数据",
    input: { collectionId: "string" },
    output: "CollectionStats",
  },
  {
    path: "searchRepos",
    method: "query",
    description: "搜索仓库 - 使用 OSSInsight API 搜索 GitHub 仓库",
    input: { query: "string", limit: "number" },
    output: "Array<TrendingRepo>",
  },
  {
    path: "getFollowing",
    method: "query",
    description: "获取用户关注的仓库列表 - 从 GitHub API 获取认证用户关注的仓库",
    input: { limit: "number (optional)" },
    output: "Array<FollowingRepo>",
  },
  {
    path: "getRepositories",
    method: "query",
    description: "获取已采集的仓库列表",
    input: { limit: "number (optional)", offset: "number (optional)" },
    output: "Array<Repository>",
  },
  {
    path: "getRepository",
    method: "query",
    description: "获取仓库详情 - 根据 ID 获取单个仓库的详细信息",
    input: { id: "number" },
    output: "RepositoryDetail",
  },
  {
    path: "collectRepository",
    method: "mutation",
    description: "采集仓库数据 - 触发数据采集流程，拉取 GitHub 数据并存储到数据库",
    input: { repo: "string (格式: owner/repo)" },
    output: "CollectionResult",
  },
  {
    path: "analyzeRepository",
    method: "mutation",
    description: "仓库健康度分析 - 对 GitHub 仓库进行全面分析，返回结构化的健康度报告",
    input: { owner: "string", repo: "string", context: "string (optional)" },
    output: "RepositoryAnalysis",
  },
  {
    path: "semanticSearch",
    method: "mutation",
    description: "语义搜索 - 对已采集的仓库内容进行语义搜索，返回相关分块和 AI 生成的综合回答",
    input: { repo: "string", query: "string", limit: "number", generateAnswer: "boolean" },
    output: "SemanticSearchResponse",
  },
  {
    path: "workflow.trigger",
    method: "mutation",
    description: "触发工作流执行 - 启动 Langtum 平台的工作流",
    input: { workflowId: "string", input: "object" },
    output: "WorkflowExecutionResponse",
  },
  {
    path: "workflow.getStatus",
    method: "query",
    description: "获取工作流执行状态 - 查询工作流的执行进度和结果",
    input: { executionId: "string" },
    output: "WorkflowExecutionDetail",
  },
];

/**
 * 注册文档路由
 */
export async function registerDocsRoute(fastify: FastifyInstance) {
  // 提供文档页面 HTML
  fastify.get("/docs", async (req, reply) => {
    reply.type("text/html");
    return generateDocsPage();
  });

  // 提供端点列表 JSON
  fastify.get("/api/endpoints", async () => {
    return { endpoints: API_ENDPOINTS, count: API_ENDPOINTS.length };
  });

  console.log("[Docs] API documentation available at http://localhost:" + (process.env.PORT || 3100) + "/docs");
}

/**
 * 生成文档页面 HTML
 */
function generateDocsPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevScope API Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.6;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 20px;
      margin: -20px -20px 40px;
      border-radius: 0 0 20px 20px;
    }
    h1 { font-size: 2.5rem; margin-bottom: 10px; }
    .subtitle { opacity: 0.9; font-size: 1.1rem; }
    .endpoint-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      margin-bottom: 20px;
      overflow: hidden;
      transition: all 0.2s;
    }
    .endpoint-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.2);
    }
    .endpoint-header {
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .method {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      min-width: 80px;
      text-align: center;
    }
    .method.query { background: #059669; color: white; }
    .method.mutation { background: #dc2626; color: white; }
    .path-info { flex: 1; }
    .path { font-family: 'Monaco', 'Consolas', monospace; font-size: 14px; font-weight: 600; }
    .description { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .toggle { margin-left: auto; transition: transform 0.2s; color: #667eea; }
    .endpoint-card.open .toggle { transform: rotate(180deg); }
    .endpoint-body {
      display: none;
      padding: 0 20px 20px;
      border-top: 1px solid #334155;
    }
    .endpoint-card.open .endpoint-body { display: block; }
    .schema-box {
      background: #0f172a;
      border-radius: 8px;
      padding: 16px;
      margin-top: 12px;
    }
    .schema-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #94a3b8;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    pre {
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 13px;
      overflow-x: auto;
      color: #a5b4fc;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .try-it {
      margin-top: 16px;
      padding: 16px;
      background: #1e3a5f30;
      border: 1px solid #1e3a5f;
      border-radius: 8px;
    }
    .try-it h4 { margin-bottom: 12px; color: #667eea; }
    .input-group { margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
    input, textarea {
      width: 100%;
      padding: 10px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #e2e8f0;
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 13px;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      padding: 10px 20px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.2s;
    }
    button:hover { background: #5a67d8; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .response {
      margin-top: 12px;
      padding: 12px;
      background: #0f172a;
      border-radius: 6px;
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 12px;
      max-height: 300px;
      overflow: auto;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .stat-value { font-size: 2.5rem; font-weight: 700; color: #667eea; }
    .stat-label { color: #94a3b8; font-size: 14px; }
    .filter {
      margin-bottom: 24px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .filter-btn {
      padding: 8px 16px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      color: #94a3b8;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn:hover, .filter-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .no-schema { color: #64748b; font-style: italic; }
    .example-value {
      color: #22c55e;
      font-size: 12px;
      margin-top: 4px;
    }
    @media (max-width: 768px) {
      h1 { font-size: 1.8rem; }
      .endpoint-header { flex-wrap: wrap; }
      .toggle { margin-left: 0; width: 100%; text-align: center; margin-top: 8px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>🚀 DevScope API</h1>
      <p class="subtitle">tRPC + Fastify + PostgreSQL | Interactive API Documentation</p>
    </div>
  </header>

  <div class="container">
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value" id="totalEndpoints">0</div>
        <div class="stat-label">Total Endpoints</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="queryCount">0</div>
        <div class="stat-label">Queries (GET)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="mutationCount">0</div>
        <div class="stat-label">Mutations (POST)</div>
      </div>
    </div>

    <div class="filter">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="query">Queries</button>
      <button class="filter-btn" data-filter="mutation">Mutations</button>
    </div>

    <div id="endpoints"></div>
  </div>

  <script>
    const endpoints = ${JSON.stringify(API_ENDPOINTS)};
    const baseUrl = window.location.origin;

    // Update stats
    document.getElementById('totalEndpoints').textContent = endpoints.length;
    document.getElementById('queryCount').textContent = endpoints.filter(e => e.method === 'query').length;
    document.getElementById('mutationCount').textContent = endpoints.filter(e => e.method === 'mutation').length;

    // Render endpoints
    function renderEndpoints(filter = 'all') {
      const container = document.getElementById('endpoints');
      const filtered = filter === 'all' ? endpoints : endpoints.filter(e => e.method === filter);

      container.innerHTML = filtered.map((ep, idx) => \`
        <div class="endpoint-card" data-method="\${ep.method}">
          <div class="endpoint-header" onclick="toggleCard(this)">
            <span class="method \${ep.method}">\${ep.method === 'query' ? 'GET' : 'POST'}</span>
            <div class="path-info">
              <div class="path">/trpc/\${ep.path}</div>
              <div class="description">\${ep.description || 'No description'}</div>
            </div>
            <span class="toggle">▼</span>
          </div>
          <div class="endpoint-body">
            \${ep.input ? \`
              <div class="schema-box">
                <div class="schema-title">📥 Input Schema</div>
                <pre>\${formatSchema(ep.input)}</pre>
              </div>
            \` : '<div class="no-schema">No input required</div>'}
            \${ep.output ? \`
              <div class="schema-box">
                <div class="schema-title">📤 Output Schema</div>
                <pre>\${formatSchema(ep.output)}</pre>
              </div>
            \` : ''}
            <div class="try-it">
              <h4>🧪 Try It Out</h4>
              <div class="input-group">
                <label>Request Body (JSON)</label>
                <textarea id="input-\${idx}" rows="4">\${getExampleInput(ep)}</textarea>
              </div>
              <button onclick="tryIt('\${ep.path}', '\${ep.method}', \${idx})">Send Request</button>
              <div class="response" id="response-\${idx}">Response will appear here...</div>
            </div>
          </div>
        </div>
      \`).join('');
    }

    function formatSchema(schema) {
      if (typeof schema === 'string') return schema;
      return JSON.stringify(schema, null, 2);
    }

    function getExampleInput(endpoint) {
      if (!endpoint.input) return '{}';
      if (typeof endpoint.input === 'string') return '{}';

      // Generate example from schema
      const example = {};
      for (const [key, value] of Object.entries(endpoint.input)) {
        const type = String(value);
        if (type.includes('optional')) continue;
        if (type.includes('string')) example[key] = 'example';
        else if (type.includes('number')) example[key] = 123;
        else if (type.includes('boolean')) example[key] = true;
        else if (type.includes('Array')) example[key] = [];
        else example[key] = {};
      }
      return JSON.stringify(example, null, 2);
    }

    function toggleCard(header) {
      header.parentElement.classList.toggle('open');
    }

    async function tryIt(path, method, idx) {
      const responseEl = document.getElementById('response-' + idx);
      const inputEl = document.getElementById('input-' + idx);
      const btn = event.target;

      responseEl.textContent = 'Sending request...';
      btn.disabled = true;

      try {
        const requestBody = inputEl.value ? JSON.parse(inputEl.value) : {};
        const url = \`\${baseUrl}/trpc/\${path}\`;

        const options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        };

        if (Object.keys(requestBody).length > 0) {
          options.body = JSON.stringify(requestBody);
        }

        const response = await fetch(url, options);
        const result = await response.json();

        responseEl.textContent = JSON.stringify(result, null, 2);
        responseEl.style.color = response.ok ? '#4ade80' : '#f87171';
      } catch (error) {
        responseEl.textContent = 'Error: ' + error.message;
        responseEl.style.color = '#f87171';
      } finally {
        btn.disabled = false;
      }
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderEndpoints(btn.dataset.filter);
      });
    });

    // Initial render
    renderEndpoints();
  </script>
</body>
</html>`;
}
