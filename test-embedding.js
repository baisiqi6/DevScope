// 测试硅基流动 embedding API
import 'dotenv/config';
import { BGEEmbeddingProvider } from './packages/ai/src/index.ts';

async function test() {
  console.log('=== 测试 BGE-M3 Embedding ===');
  console.log('环境变量:');
  console.log('- SILICONFLOW_API_KEY:', process.env.SILICONFLOW_API_KEY ? `${process.env.SILICONFLOW_API_KEY.slice(0, 10)}...` : 'NOT SET');
  console.log('- BGE_API_URL:', process.env.BGE_API_URL || 'NOT SET');
  console.log('- BGE_MODEL_NAME:', process.env.BGE_MODEL_NAME || 'NOT SET');
  console.log('');

  try {
    const embedder = new BGEEmbeddingProvider();
    console.log('Embedding Provider 初始化成功');
    console.log('');

    console.log('正在测试 embedding 生成...');
    const result = await embedder.embed('Hello, World!');
    console.log('成功! 向量维度:', result.length);
    console.log('前 5 个值:', result.slice(0, 5));
  } catch (error) {
    console.error('失败!');
    console.error('错误信息:', error.message);
    console.error('错误详情:', error);
  }
}

test();
