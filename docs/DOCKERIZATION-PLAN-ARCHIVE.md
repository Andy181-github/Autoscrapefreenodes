# Docker 化走查（历史记录）

> ⚠️ **文档与实现不符**：本文档描述的 `Dockerfile`、`.dockerignore`、`docker-compose.yml` 均**不存在于当前仓库**。
> 该走查为历史会话产物，未随仓库提交。保留此文仅作为 Docker 化方案的参考记录；
> 如需落地，请按下方"参考方案"重新创建相应文件并验证。

## 参考方案（未落地）

当时记录的 Docker 化步骤如下，可作为未来落地的 checklist：

1. 创建 `.dockerignore`：排除 `node_modules`、`data`、`.git`、`logs`、`.cache`、`artifacts`。
2. 创建 `Dockerfile`：基于 `node:18-alpine`，安装生产依赖，暴露 3000/3001 端口，挂载 `./data` 卷。
3. 创建 `docker-compose.yml`：定义 `autoscrape` 服务，映射宿主机 3000 端口，挂载 `./data`，时区 `Asia/Shanghai`。
4. 在 `README.md` 增加 "Docker Deployment" 小节。

## 历史走查原文（存档）

<details>
<summary>原始 Dockerization Walkthrough</summary>

I have successfully dockerized the `AutoScrapeFreeNodes` project. Here is a summary of the changes and how to use them.

## Changes Made

1.  **Created `.dockerignore`**:
    - Excluded `node_modules`, `data`, `.git`, etc. to keep the image clean and build fast.

2.  **Created `Dockerfile`**:
    - Base image: `node:18-alpine` (lightweight and secure).
    - Installs production dependencies.
    - Exposes port 3000 and 3001.
    - Sets up a volume for persistent data storage.

3.  **Created `docker-compose.yml`**:
    - Defines the `autoscrape` service.
    - Maps host port 3000 to container port 3000.
    - Mounts the `./data` directory to persist scraped nodes.
    - Sets the timezone to `Asia/Shanghai`.

4.  **Updated `README.md`**:
    - Added a "Docker Deployment" section with clear instructions.

## How to Run

### Using Docker Compose (Recommended)

```bash
docker compose up -d
```

The application will be available at `http://localhost:3000`.

### Using Docker CLI

```bash
docker build -t autoscrape-free-nodes .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name autoscrape autoscrape-free-nodes
```

</details>
