# BGE-M3 Embedding 服务配置指南

本项目使用 **BGE-M3** 模型生成文本向量嵌入，支持多语言语义搜索。

## 什么是 BGE-M3？

BGE-M3 (BAAI General Embedding) 是由北京智源人工智能研究院开发的多语言、多粒度嵌入模型：

- **向量维度**: 1024
- **支持语言**: 100+ 种语言（包括中文、英文）
- **最大输入**: 8192 tokens
- **特点**: 支持短文本、长文本、文档三种粒度

## 安装 Xinference (推荐)

Xinference 是一个简单易用的模型推理框架，支持 BGE-M3。

### 1. 安装 Xinference

```bash
pip install xinference
```

### 2. 启动 Xinference 服务

```bash
# 启动本地服务（默认端口 9997）
xinference-local --host 0.0.0.0 --port 9997
```

### 3. 启动 BGE-M3 模型

```bash
# 启动 BGE-M3 embedding 模型
xinference launch --model-name bge-m3 --model-type embedding
```

或者指定端口：

```bash
xinference launch --model-name bge-m3 --model-type embedding --port 9997
```

### 4. 验证服务

测试服务是否正常运行：

```bash
curl http://localhost:9997/v1/models
```

应该返回类似：

```json
{
  "data": [
    {
      "id": "bge-m3",
      "object": "model",
      ...
    }
  ]
}
```

## 其他部署选项

### 使用 Docker

```bash
docker run -d \
  --name xinference \
  -p 9997:9997 \
  -v ~/.xinference:/root/.xinference \
  xprobe/xinference:latest \
  xinference-local --host 0.0.0.0 --port 9997
```

### 使用 LocalAI

```bash
# 安装 LocalAI
curl https://localai.io/install.sh | sh

# 启动 BGE-M3
localai run bge-m3
```

## 环境变量配置

确保 `.env` 文件中配置了正确的 BGE API URL：

```bash
# 默认 Xinference 地址
BGE_API_URL=http://localhost:9997/v1

# 如果使用其他端口，修改端口号
# BGE_API_URL=http://localhost:9999/v1
```

## 性能优化

### GPU 加速

如果系统有 NVIDIA GPU，安装 GPU 版本的 Xinference：

```bash
pip install "xinference[gpu]"
```

### 批量处理

项目已实现批量 embedding 生成，可以高效处理大量文本：

```typescript
// 批量生成向量
const vectors = await embedder.embedBatch([
  "文本 1",
  "文本 2",
  "文本 3"
]);
```

## 常见问题

### Q: 模型下载失败？

A: BGE-M3 模型较大（约 2GB），首次启动需要下载。可以使用镜像加速：

```bash
export HF_ENDPOINT=https://hf-mirror.com
xinference launch --model-name bge-m3 --model-type embedding
```

### Q: 端口冲突？

A: 修改启动命令中的端口号：

```bash
xinference-local --port 9999
xinference launch --model-name bge-m3 --model-type embedding --port 9999
```

同时更新 `.env` 文件：

```bash
BGE_API_URL=http://localhost:9999/v1
```

### Q: 内存不足？

A: BGE-M3 需要约 4GB 内存。如果内存不足，可以考虑：

1. 使用量化版本
2. 减小批次大小
3. 升级服务器配置

## 监控和日志

查看 Xinference 日志：

```bash
# 查看运行中的模型
xinference list --model-type embedding

# 停止模型
xinference terminate --model-name bge-m3
```

## 相关链接

- [Xinference GitHub](https://github.com/xorbitsai/inference)
- [BGE-M3 模型卡片](https://huggingface.co/BAAI/bge-m3)
- [BGE 系列模型介绍](https://github.com/FlagOpen/FlagEmbedding)
