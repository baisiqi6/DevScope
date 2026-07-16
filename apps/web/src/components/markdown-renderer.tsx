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
 * 自定义 Markdown 组件样式，使用全局语义 token 支持深浅色主题。
 */
const components: Components = {
  // 标题样式
  h1: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <h1 className={`mb-4 mt-6 border-b pb-2 text-2xl font-bold ${align === 'center' ? 'text-center' : ''}`}>
        {children}
      </h1>
    );
  },
  h2: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <h2 className={`mb-3 mt-5 border-b pb-1 text-xl font-bold ${align === 'center' ? 'text-center' : ''}`}>
        {children}
      </h2>
    );
  },
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-3 text-base font-semibold">{children}</h4>
  ),

  // 段落样式
  p: ({ children, node }) => {
    const align = (node as any)?.properties?.align;
    return (
      <p className={`mb-4 leading-7 text-foreground/90 ${align === 'center' ? 'text-center' : ''}`}>
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
      className="text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  ),

  // 列表样式
  ul: ({ children }) => <ul className="mb-4 list-inside list-disc space-y-1 text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-inside list-decimal space-y-1 text-foreground/90">{children}</ol>,
  li: ({ children }) => <li className="ml-4">{children}</li>,

  // 代码块样式
  code: ({ className, children }) => {
    // 判断是行内代码还是代码块
    const isInline = !className;
    return isInline ? (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-primary">
        {children}
      </code>
    ) : (
      <code className={className}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-md border bg-muted/45 p-4 font-mono text-sm">
      {children}
    </pre>
  ),

  // 引用块样式
  blockquote: ({ children }) => (
    <blockquote className="mb-4 rounded-md border bg-muted/35 px-4 py-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),

  // 表格样式（GFM 支持）
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="min-w-full divide-y rounded-md border">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/45">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2 text-sm text-foreground/90">{children}</td>
  ),

  // 分隔线样式
  hr: () => <hr className="my-6 border-t" />,

  // 图片样式
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="max-w-full h-auto rounded-md my-4" />
  ),

  // 删除线样式（GFM 支持）
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

  // 强调样式
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,

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
    <details className="mb-4 rounded-md border bg-muted/35 p-4">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer select-none font-semibold text-foreground hover:text-primary">
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
