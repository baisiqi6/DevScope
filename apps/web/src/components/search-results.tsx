/**
 * @package @devscope/web
 * @description 搜索结果展示组件
 *
 * 展示语义搜索返回的相关分块。
 */

interface SearchResultsProps {
  chunks: Array<{
    id: number;
    content: string;
    chunkType: string;
    sourceId?: string;
    chunkIndex: number;
  }>;
  repository: {
    fullName: string;
  };
  duration: number;
}

export function SearchResults({
  chunks,
  repository,
  duration,
}: SearchResultsProps) {
  if (chunks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No results found for your query in {repository.fullName}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Found {chunks.length} result{chunks.length !== 1 ? "s" : ""} in {duration}ms from{" "}
        <span className="font-medium">{repository.fullName}</span>
      </div>

      {chunks.map((chunk) => (
        <div
          key={chunk.id}
          className="p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-1 bg-secondary text-secondary-foreground text-xs rounded">
              {chunk.chunkType}
            </span>
            {chunk.sourceId && (
              <span className="text-sm text-muted-foreground">
                #{chunk.sourceId}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Chunk #{chunk.chunkIndex}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">
            {chunk.content}
          </p>
        </div>
      ))}
    </div>
  );
}
