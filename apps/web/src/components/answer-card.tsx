/**
 * @package @devscope/web
 * @description AI 回答展示组件
 *
 * 展示 AI 生成的综合回答。
 */

interface AnswerCardProps {
  answer: string;
}

export function AnswerCard({ answer }: AnswerCardProps) {
  return (
    <div className="p-6 bg-primary/5 border border-primary/20 rounded-lg">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span role="img" aria-label="robot">
          🤖
        </span>
        <span>AI Answer</span>
      </h2>
      <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
        {answer}
      </p>
    </div>
  );
}
