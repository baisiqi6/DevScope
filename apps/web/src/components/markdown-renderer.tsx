/**
 * @package @devscope/web
 * @description Markdown 渲染组件
 *
 * 使用 react-markdown 渲染 Markdown 内容，支持 GitHub Flavored Markdown。
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * 自定义 Markdown 组件样式（浅色主题）
 */
const components: Components = {
  // 标题样式
  h1: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <h1 className={`text-2xl font-bold mt-6 mb-4 pb-2 border-b border-gray-200 ${align === 'center' ? 'text-center' : ''}`}>
        {children}
      </h1>
    );
  },
  h2: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <h2 className={`text-xl font-bold mt-5 mb-3 pb-1 border-b border-gray-200 ${align === 'center' ? 'text-center' : ''}`}>
        {children}
      </h2>
    );
  },
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-3 mb-2">{children}</h4>
  ),

  // 段落样式
  p: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <p className={`mb-4 leading-7 text-gray-700 ${align === 'center' ? 'text-center' : ''}`}>
        {children}
      </p>
    );
  },

  // 链接样式
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline"
    >
      {children}
    </a>
  ),

  // 列表样式
  ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-1 text-gray-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-4 space-y-1 text-gray-700">{children}</ol>,
  li: ({ children }) => <li className="ml-4">{children}</li>,

  // 代码块样式
  code: ({ className, children }) => {
    // 判断是行内代码还是代码块
    const isInline = !className;
    return isInline ? (
      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-red-600">
        {children}
      </code>
    ) : (
      <code className={className}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-gray-50 p-4 rounded-md overflow-x-auto mb-4 text-sm font-mono border border-gray-200">
      {children}
    </pre>
  ),

  // 引用块样式
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-gray-400 pl-4 italic text-gray-600 mb-4 bg-gray-50 py-2">
      {children}
    </blockquote>
  ),

  // 表格样式（GFM 支持）
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="min-w-full border border-gray-300 divide-y divide-gray-200">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-100">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-gray-200">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-gray-50">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2 text-sm text-gray-700">{children}</td>
  ),

  // 分隔线样式
  hr: () => <hr className="my-6 border-t border-gray-200" />,

  // 图片样式
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="max-w-full h-auto rounded-md my-4" />
  ),

  // 删除线样式（GFM 支持）
  del: ({ children }) => <del className="text-gray-400 line-through">{children}</del>,

  // 强调样式
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-700">{children}</em>,

  // HTML 标签样式支持
  div: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <div className={align === 'center' ? 'text-center' : ''}>
        {children}
      </div>
    );
  },
  br: () => <br />,

  // details/summary 样式（折叠块）
  details: ({ children }) => (
    <details className="mb-4 bg-gray-50 border border-gray-200 rounded-md p-4">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer font-semibold text-gray-900 hover:text-gray-700 select-none">
      {children}
    </summary>
  ),
};

/**
 * Markdown 渲染组件
 */
export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
