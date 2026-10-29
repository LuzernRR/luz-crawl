# LuzCrawl MCP 服务

Docker 容器将 MCP 服务、OpenCLI 桥接、浏览器扩展、Chromium 与 noVNC 人工验证页面放在一起，通过 Streamable HTTP 提供 `/mcp`。

## 启动

在装有 Docker Compose 的 Linux 服务器执行：

```sh
cd mcp-server
printf 'LUZ_MCP_TOKEN=%s\nLUZ_PUBLIC_BASE_URL=http://127.0.0.1:8765\n' "$(openssl rand -base64 32)" > .env
chmod 600 .env
docker compose up -d --build
```

首次构建会下载 Chromium 和系统依赖，镜像较大；后续复用镜像与 `luz-crawl-data` 数据卷。数据卷包含浏览器配置、未完成任务和采集文件。用户可能在浏览器里登录网站，应保护此数据卷，不与他人共享。

服务只绑定服务器的 `127.0.0.1:8765`。本机 Codex 可用以下配置连接：

```toml
[mcp_servers.luz_crawl]
url = "http://127.0.0.1:8765/mcp"
bearer_token_env_var = "LUZ_MCP_TOKEN"
```

在 MCP 客户端环境中，将 `LUZ_MCP_TOKEN` 设为 `.env` 里的值。不要把令牌写入代码仓库或日志。工具包括 `luz_health`、`luz_capture`、`luz_search`、`luz_collect`、`luz_status`、`luz_continue`、`luz_cancel`、`luz_files` 和 `luz_read`。

## 人工验证

遇到登录或人工验证时，`luz_status` 会返回 `verification_url`。在本机浏览器打开该地址，在 `/verify/login` 输入同一个 MCP 令牌，然后通过 noVNC 操作**云端容器里的浏览器**，最后调用 `luz_continue` 并传入该任务 ID。本机只连接验证画面，不运行采集服务或本地浏览器插件。验证页面和采集任务使用同一份持久浏览器配置；不会导出 Cookie。

等待人工处理最多保留浏览器 30 分钟；超时后任务改为 `interrupted` 并关闭浏览器释放内存。需要继续时调用 `luz_continue`，服务会重新启动浏览器并尝试续接。

连接远程服务器时，可从工作电脑建立 SSH 隧道，服务器端口仍保持私有：

```sh
ssh -L 8765:127.0.0.1:8765 user@server
```

隧道方式下，服务器设置 `LUZ_PUBLIC_BASE_URL=http://127.0.0.1:8765`；MCP 请求和 noVNC WebSocket 都通过同一条隧道到达云端容器。如需直接远程访问，应在服务前配置 HTTPS 反向代理，支持 `/verify/ws` 的 WebSocket 升级，并将 `LUZ_PUBLIC_BASE_URL` 设为公开 HTTPS 根地址。不要暴露无认证的 VNC 端口。

## 内存与边界

浏览器按需启动：任务执行期间打开，任务完成后关闭；等待人工验证时最多保留 30 分钟。任务状态和结果保存在磁盘，服务常驻内存不保留历史任务索引；按任务 ID 查询时才读取对应记录。

Node V8 堆限制为 256 MiB。Compose 将容器限制为 1.25 GiB 内存、2 个 CPU、256 MiB 共享内存且不使用交换空间；当前 2 GiB ECS 的 Linux 可见内存约 1.7 GiB，宿主机约留 0.45 GiB。这里的数字是上限，不是实测占用；复杂网页或视频处理仍可能触及上限。单个数据卷只供一个服务实例使用，不要让多个副本同时打开同一浏览器 profile。服务一次运行一个采集任务。重启后进行中的任务会标记为中断，不会自动重放；先用 `luz_status` 检查，再决定是否 `luz_continue`。

当前 Node MCP SDK 固定在 1.32.2，使用其支持的 2025-11-25 Streamable HTTP 协议版本。Codex 配置支持 `bearer_token_env_var`，适合这个单用户部署；它不是完整 OAuth 授权服务器，也未验证只接受 2026-07 协议版本或强制 OAuth 的其他 MCP 客户端。

轻量单测不会启动 Docker、安装浏览器或访问第三方网站：

```sh
npm test
```
