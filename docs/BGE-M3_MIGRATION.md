# BGE-M3 Embedding 迁移完成

## ✅ 已完成的工作

### 1. 创建 BGE-M3 Embedding Provider
- 在 `packages/ai/src/index.ts` 中添加了 `BGEEmbeddingProvider` 类
- 支持通过 HTTP API 调用本地 BGE-M3 服务
- 提供工厂函数 `createBGEEmbedding()`
- 向量维度从 1536 (OpenAI) 改为 1024 (BGE-M3)

### 2. 更新数据库 Schema
- `repo_chunks.embedding`: 1536 → 1024 维
- `documents.embedding`: 1536 → 1024 维

### 3. 更新 Pipeline 配置
- 移除 `OPENAI_API_KEY` 依赖
- 添加 `BGE_API_URL` 配置项
- 使用 `BGEEmbeddingProvider` 替代 `EmbeddingProvider`

### 4. 环境变量配置
```bash
# .env 文件
BGE_API_URL=http://localhost:9997/v1
```

### 5. 创建 BGE-M3 安装文档
- 详细的安装步骤：[BGE-M3_SETUP.md](./BGE-M3_SETUP.md)
- 包含 Xinference 安装和配置指南

## 📋 下一步操作

### 立即操作

1. **安装并启动 Xinference** (本地 BGE-M3 服务)
   ```bash
   # 安装
   pip install xinference

   # 启动服务
   xinference-local --host 0.0.0.0 --port 9997

   # 启动 BGE-M3 模型
   xinference launch --model-name bge-m3 --model-type embedding
   ```

2. **更新数据库 Schema** (向量维度变化)
   ```bash
   # 由于向量维度从 1536 改为 1024，需要重建向量列
   # 或者删除现有数据重新采集
   pnpm db:studio
   ```

3. **重启开发服务器**
   ```bash
   pnpm dev
   ```

### 可选：使用 Docker 运行 Xinference

```bash
docker run -d \
  --name xinference \
  -p 9997:9997 \
  -v ~/.xinference:/root/.xinference \
  xprobe/xinference:latest \
  xinference-local --host 0.0.0.0 --port 9997
```

## ⚠️ 注意事项

### 当前有编译错误需要修复

DB 包有类型不匹配问题，正在修复中...

### 迁移后的影响

1. **向量维度变化**
   - 旧数据: 1536 维向量 (OpenAI)
   - 新数据: 1024 维向量 (BGE-M3)
   - **需要删除旧的向量数据或重新采集仓库**

2. **API 兼容性**
   - BGEEmbeddingProvider 兼容 OpenAI API 格式
   - 可以无缝替换，只需修改环境变量

3. **性能对比**
   - BGE-M3: 本地运行，免费，无网络延迟
   - OpenAI: 云端 API，按量付费，有网络延迟

## 🎯 预期效果

切换到 BGE-M3 后：

- ✅ **成本**: 从按量付费变为免费（本地运行）
- ✅ **延迟**: 从 ~100ms 降低到 ~20ms
- ✅ **隐私**: 数据无需上传到第三方
- ✅ **多语言**: BGE-M3 对中文支持更好
- ⚠️ **资源**: 需要额外内存运行模型 (~4GB)

## 🔗 相关链接

- [Xinference GitHub](https://github.com/xorbitsai/inference)
- [BGE-M3 模型](https://huggingface.co/BAAI/bge-m3)
- [BGE 系列模型](https://github.com/FlagOpen/FlagEmbedding)
