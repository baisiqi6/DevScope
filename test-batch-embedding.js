// 测试批量 embedding
import 'dotenv/config';
import { BGEEmbeddingProvider } from './packages/ai/src/index.ts';

async function test() {
  const embedder = new BGEEmbeddingProvider();

  // 模拟实际的文本分块（使用真实的长文本）
  const sampleText = `# React

React is a JavaScript library for building user interfaces.

* Declarative: React makes it painless to create interactive UIs. Design simple views for each state in your application, and React will efficiently update and render just the right components when your data changes.

* Component-Based: Build encapsulated components that manage their own state, then compose them to make complex UIs.

* Learn Once, Write Anywhere: We don't make assumptions about the rest of your technology stack, so you can develop new features in React without rewriting existing code.

## Installation

    npm install react

## Usage

    import React from 'react';
    import ReactDOM from 'react-dom';
    import App from './App';

    ReactDOM.render(<App />, document.getElementById('root'));

`.repeat(5); // 增加文本长度

  // 测试不同批量大小
  const batchSizes = [1, 5, 10];
  for (const size of batchSizes) {
    try {
      console.log(`\n=== 测试批量大小 ${size} ===`);
      const texts = Array(size).fill(sampleText);
      console.log(`文本数量: ${texts.length}`);
      console.log(`总字符数: ${texts.join('').length}`);

      const start = Date.now();
      const results = await embedder.embedBatch(texts);
      const duration = Date.now() - start;

      console.log(`✅ 成功! 生成 ${results.length} 个向量`);
      console.log(`耗时: ${duration}ms`);
    } catch (error) {
      console.error(`❌ 失败!`);
      console.error(`错误: ${error.message}`);
      console.error(`状态码: ${error.status}`);
    }
  }
}

test();
