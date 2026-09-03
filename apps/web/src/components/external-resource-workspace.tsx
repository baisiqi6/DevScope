"use client";

import React, { useEffect, useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { ExternalResource } from "@devscope/shared";
import {
  ArrowUpDown,
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  FolderPlus,
  Globe2,
  LayoutGrid,
  Loader2,
  List,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AnimatedBackground } from "@/components/animated-background";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { filterAndSortExternalResources } from "@/lib/external-resource-filters";

type ExternalResourceType = "article" | "paper" | "website";
type Filter = "all" | ExternalResourceType;
type StatusFilter = "all" | "unread" | "read" | "pinned";

const typeLabels: Record<ExternalResourceType, string> = {
  article: "文章",
  paper: "论文",
  website: "网站",
};

const typeIcons: Record<ExternalResourceType, typeof BookOpen> = {
  article: FileText,
  paper: BookOpen,
  website: Globe2,
};

const typeStyles: Record<ExternalResourceType, string> = {
  article: "border-sky-400/25 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  paper: "border-violet-400/25 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  website: "border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface ResourceCardProps {
  resource: ExternalResource;
  groups: Array<{ id: number; name: string }>;
  onAddToGroup: (groupId: number, resourceId: number) => void;
  onEdit: (resource: ExternalResource) => void;
  onDelete: (resource: ExternalResource) => void;
  onToggleRead: (resource: ExternalResource) => void;
  onTogglePinned: (resource: ExternalResource) => void;
  onRequestContent?: (resource: ExternalResource) => void;
  onReadContent?: (resource: ExternalResource) => void;
  density: "grid" | "list";
  pending: boolean;
}

export function ResourceCard({ resource, groups, onAddToGroup, onEdit, onDelete, onToggleRead, onTogglePinned, onRequestContent, onReadContent, density, pending }: ResourceCardProps) {
  const Icon = typeIcons[resource.resourceType];
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const previewImage = resource.previewImageUrl && !imageFailed ? resource.previewImageUrl : null;
  const favicon = resource.faviconUrl && !faviconFailed ? resource.faviconUrl : null;

  return (
    <Card className={cn("group flex h-full flex-col overflow-hidden transition-[transform,border-color,background-color] duration-150 hover:-translate-y-0.5 hover:border-border-hover hover:bg-card-hover", density === "list" && "lg:grid lg:grid-cols-[minmax(180px,260px)_1fr]", resource.isPinned && "border-primary/35")}>
      <div className={cn("relative aspect-[16/8] overflow-hidden border-b border-border/70 bg-muted/35", density === "list" && "lg:aspect-auto lg:min-h-full lg:border-b-0 lg:border-r")}>
        {previewImage ? (
          <img src={previewImage} alt="" loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_20%_20%,oklch(var(--primary)/.18),transparent_45%),linear-gradient(135deg,oklch(var(--muted)),transparent)] text-primary/70">
            <Icon aria-hidden="true" className="h-10 w-10" />
          </div>
        )}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <Badge variant="outline" className={cn("gap-1.5 backdrop-blur-sm", typeStyles[resource.resourceType])}>
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {typeLabels[resource.resourceType]}
          </Badge>
          {resource.isPinned && <Badge variant="outline" className="gap-1 border-primary/25 bg-background/85 text-primary"><Pin aria-hidden="true" className="h-3.5 w-3.5" />置顶</Badge>}
        </div>
      </div>

      <CardHeader className="gap-3 p-4 pb-2">
        <div className="flex items-start gap-3">
          {favicon ? <img src={favicon} alt="" loading="lazy" onError={() => setFaviconFailed(true)} className="mt-0.5 h-5 w-5 rounded-sm" /> : <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-sm bg-primary/10 text-[10px] font-bold text-primary">{getHostname(resource.url).slice(0, 1).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-base leading-snug">{resource.title}</CardTitle>
            <p className="mt-1 truncate text-xs text-muted-foreground">{resource.siteName || getHostname(resource.url)}{resource.author ? ` · ${resource.author}` : ""}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 px-4 pb-3">
        <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-muted-foreground">{resource.description || "暂无简介，打开原文查看详细内容。"}</p>
        <div className="flex flex-wrap gap-1.5">
          {resource.tags.map((tag) => <Badge key={tag} variant="secondary" className="font-normal">#{tag}</Badge>)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{resource.publishedAt ? formatDate(resource.publishedAt) : `保存于 ${formatDate(resource.createdAt)}`}</span>
          <span className={resource.isRead ? "text-muted-foreground" : "font-medium text-primary"}>{resource.isRead ? "已读" : "未读"}</span>
        </div>
        <div className="flex items-center gap-2 text-xs"><Badge variant="outline">正文：{resource.contentStatus}</Badge>{resource.contentError && <span className="truncate text-destructive">{resource.contentError}</span>}</div>
        {resource.notes && <p className="line-clamp-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs text-foreground/80">{resource.notes}</p>}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t border-border/60 p-3">
        <Button asChild size="sm" className="flex-1">
          <a href={resource.url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />打开</a>
        </Button>
        {resource.ingestionMode === "content" && resource.contentStatus !== "completed" && onRequestContent && <Button size="sm" variant="outline" onClick={() => onRequestContent(resource)} disabled={pending || resource.contentStatus === "processing" || resource.contentStatus === "pending"}>{resource.contentStatus === "failed" ? "重试正文" : "采集正文"}</Button>}
        {resource.contentStatus === "completed" && onReadContent && <Button size="sm" variant="outline" onClick={() => onReadContent(resource)}>查看正文</Button>}
        <Button size="sm" variant="outline" onClick={() => onToggleRead(resource)} aria-label={resource.isRead ? "标记为未读" : "标记为已读"} disabled={pending}>
          {resource.isRead ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
          {resource.isRead ? "未读" : "已读"}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => onTogglePinned(resource)} aria-label={resource.isPinned ? "取消置顶" : "置顶"} className={resource.isPinned ? "text-primary" : undefined} disabled={pending}><Pin aria-hidden="true" /></Button>
        <Button size="icon" variant="ghost" onClick={() => onEdit(resource)} aria-label="编辑资源"><span aria-hidden="true">⋯</span></Button>
        <Button size="icon" variant="ghost" onClick={() => onDelete(resource)} aria-label="删除资源" className="text-muted-foreground hover:text-destructive"><Trash2 aria-hidden="true" /></Button>
        {groups.length > 0 && <select aria-label="添加到外部资源分组" defaultValue="" disabled={pending} onChange={(event) => { if (event.target.value) onAddToGroup(Number(event.target.value), resource.id); event.target.value = ""; }} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background/80 px-2 text-xs text-muted-foreground"><option value="">加入分组…</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
      </CardFooter>
    </Card>
  );
}

function ResourceForm({ initial, onSubmit, pending, onCancel }: { initial?: ExternalResource; onSubmit: (value: { url: string; resourceType: ExternalResourceType; title?: string; description?: string; siteName?: string; author?: string; previewImageUrl?: string; faviconUrl?: string; tags: string[]; notes?: string }) => void; pending: boolean; onCancel: () => void }) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [resourceType, setResourceType] = useState<ExternalResourceType>(initial?.resourceType ?? "article");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [siteName, setSiteName] = useState(initial?.siteName ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [previewImageUrl, setPreviewImageUrl] = useState(initial?.previewImageUrl ?? "");
  const [faviconUrl, setFaviconUrl] = useState(initial?.faviconUrl ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    if (!initial && !url.trim()) { setFormError("请填写资源 URL"); return; }
    if (!initial && !/^https?:\/\//i.test(url.trim())) { setFormError("URL 只支持 http 或 https"); return; }
    setFormError(null);
    onSubmit({ url: url.trim(), resourceType, title: title.trim() || undefined, description: description.trim() || undefined, siteName: siteName.trim() || undefined, author: author.trim() || undefined, previewImageUrl: previewImageUrl.trim() || undefined, faviconUrl: faviconUrl.trim() || undefined, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), notes: notes.trim() || undefined });
  };

  return (
    <div className="grid gap-4 py-2">
      {!initial && <div className="grid gap-2"><Label htmlFor="resource-url">URL</Label><Input id="resource-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" autoFocus /></div>}
      <div className="grid gap-2"><Label htmlFor="resource-type">类型</Label><select id="resource-type" value={resourceType} onChange={(event) => setResourceType(event.target.value as ExternalResourceType)} className="h-10 rounded-md border border-input bg-background/80 px-3 text-sm"><option value="article">文章</option><option value="paper">论文</option><option value="website">网站</option></select></div>
      <div className="grid gap-2"><Label htmlFor="resource-title">标题</Label><Input id="resource-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资源标题" maxLength={300} /></div>
      <div className="grid gap-2"><Label htmlFor="resource-description">简介</Label><Textarea id="resource-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话说明它为什么值得收藏" maxLength={2000} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="resource-site">站点</Label><Input id="resource-site" value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="例如：arXiv" /></div><div className="grid gap-2"><Label htmlFor="resource-author">作者/发布者</Label><Input id="resource-author" value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="可选" /></div></div>
      {!initial && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="resource-favicon">Favicon URL</Label><Input id="resource-favicon" type="url" value={faviconUrl} onChange={(event) => setFaviconUrl(event.target.value)} placeholder="可选" /></div><div className="grid gap-2"><Label htmlFor="resource-preview">预览图 URL</Label><Input id="resource-preview" type="url" value={previewImageUrl} onChange={(event) => setPreviewImageUrl(event.target.value)} placeholder="可选" /></div></div>}
      <div className="grid gap-2"><Label htmlFor="resource-tags">标签</Label><Input id="resource-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔，例如：UI, 灵感" /></div>
      <div className="grid gap-2"><Label htmlFor="resource-notes">我的备注</Label><Textarea id="resource-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录收藏原因或下一步" maxLength={5000} /></div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>取消</Button><Button type="button" onClick={submit} disabled={pending}>{pending && <Loader2 className="animate-spin" />}保存</Button></DialogFooter>
    </div>
  );
}

export function ExternalResourceWorkspace() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sortPinnedFirst, setSortPinnedFirst] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [editing, setEditing] = useState<ExternalResource | null>(null);
  const [deleting, setDeleting] = useState<ExternalResource | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [density, setDensity] = useState<"grid" | "list">("grid");
  const [resourceOffset, setResourceOffset] = useState(0);
  const [resourcePages, setResourcePages] = useState<Array<{ offset: number; items: ExternalResource[] }>>([]);
  const [readingId, setReadingId] = useState<number | null>(null);

  const pageSize = 50;
  const resourcesQuery = trpc.externalResources.list.useQuery({ limit: pageSize, offset: resourceOffset }, { refetchOnWindowFocus: false });
  const groupsQuery = trpc.externalResourceGroups.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const membersQuery = trpc.externalResourceGroups.members.useQuery(selectedGroupId === null ? skipToken : { groupId: selectedGroupId }, { refetchOnWindowFocus: false });
  const resetResources = () => { setResourceOffset(0); setResourcePages([]); };
  const createResource = trpc.externalResources.save.useMutation({ onSuccess: async () => { setShowCreate(false); resetResources(); await utils.externalResources.list.invalidate(); } });
  const updateResource = trpc.externalResources.update.useMutation({ onSuccess: async () => { setEditing(null); resetResources(); await utils.externalResources.list.invalidate(); } });
  const removeResource = trpc.externalResources.remove.useMutation({ onSuccess: async () => { setDeleting(null); resetResources(); await Promise.all([utils.externalResources.list.invalidate(), utils.externalResourceGroups.list.invalidate()]); } });
  const requestContent = trpc.externalResources.requestContent.useMutation({ onSuccess: () => resourcesQuery.refetch() });
  const readContent = trpc.externalResources.readContent.useQuery({ resourceId: readingId ?? 0 }, { enabled: readingId !== null });
  const createGroup = trpc.externalResourceGroups.create.useMutation({ onSuccess: async () => { setShowGroupCreate(false); setGroupName(""); setGroupDescription(""); await utils.externalResourceGroups.list.invalidate(); } });
  const addToGroup = trpc.externalResourceGroups.add.useMutation({ onSuccess: async () => { await Promise.all([utils.externalResourceGroups.list.invalidate(), selectedGroupId !== null ? utils.externalResourceGroups.members.invalidate({ groupId: selectedGroupId }) : Promise.resolve()]); } });
  const requestResourceContent = (resource: ExternalResource) => requestContent.mutate({ resourceId: resource.id });
  const showResourceContent = (resource: ExternalResource) => setReadingId(resource.id);

  useEffect(() => {
    if (!resourcesQuery.data || resourcesQuery.isFetching) return;
    setResourcePages((pages) => [...pages.filter((page) => page.offset !== resourceOffset), { offset: resourceOffset, items: resourcesQuery.data ?? [] }].sort((a, b) => a.offset - b.offset));
  }, [resourceOffset, resourcesQuery.data, resourcesQuery.isFetching]);

  const resources = useMemo(() => resourcePages.flatMap((page) => page.items), [resourcePages]);
  const canLoadMore = !resourcesQuery.isFetching && (resourcesQuery.data?.length ?? 0) === pageSize;
  const groupResourceIds = useMemo(() => selectedGroupId === null ? undefined : new Set((membersQuery.data ?? []).map((member) => member.resourceId)), [membersQuery.data, selectedGroupId]);
  const visibleResources = useMemo(() => filterAndSortExternalResources(resources, { filter, statusFilter, query, pinnedFirst: sortPinnedFirst, groupResourceIds }), [filter, groupResourceIds, query, resources, sortPinnedFirst, statusFilter]);

  const handleToggle = (resource: ExternalResource, field: "isRead" | "isPinned") => updateResource.mutate({ resourceId: resource.id, [field]: !resource[field] });
  const handleCreateGroup = () => { if (!groupName.trim()) return; createGroup.mutate({ name: groupName.trim(), description: groupDescription.trim() || undefined }); };

  return (
    <main className="min-h-screen"><AnimatedBackground /><div className="container mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="command-page-header mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="command-kicker">研究资料库</p><h1 className="text-2xl font-semibold tracking-tight">外部资源</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">把文章、论文和工具网站收进独立的预览收藏库。默认只保存预览元数据，不自动抓取正文。</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => resourcesQuery.refetch()} disabled={resourcesQuery.isFetching}><RefreshCw className={cn(resourcesQuery.isFetching && "animate-spin")} />刷新</Button><Button onClick={() => setShowCreate(true)}><Plus />保存资源</Button></div></header>

      <section className="command-surface mb-5 p-3 sm:p-4" aria-label="外部资源筛选"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、站点、作者、标签或 URL" className="pl-9" aria-label="搜索外部资源" /></div><div className="flex flex-wrap gap-2"><div className="flex rounded-md border border-border/80 bg-background/60 p-1" role="group" aria-label="资源类型"><FilterButton active={filter === "all"} onClick={() => setFilter("all")}>全部</FilterButton>{(Object.keys(typeLabels) as ExternalResourceType[]).map((type) => <FilterButton key={type} active={filter === type} onClick={() => setFilter(type)}>{typeLabels[type]}</FilterButton>)}</div><div className="flex rounded-md border border-border/80 bg-background/60 p-1" role="group" aria-label="阅读状态"><FilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部状态</FilterButton><FilterButton active={statusFilter === "unread"} onClick={() => setStatusFilter("unread")}>未读</FilterButton><FilterButton active={statusFilter === "read"} onClick={() => setStatusFilter("read")}>已读</FilterButton><FilterButton active={statusFilter === "pinned"} onClick={() => setStatusFilter("pinned")}><Pin className="h-3.5 w-3.5" />置顶</FilterButton></div><Button size="sm" variant="ghost" onClick={() => setSortPinnedFirst((value) => !value)} aria-pressed={sortPinnedFirst}><ArrowUpDown />{sortPinnedFirst ? "置顶优先" : "最近更新"}</Button><div className="flex rounded-md border border-border/80 bg-background/60 p-1" role="group" aria-label="显示密度"><FilterButton active={density === "grid"} onClick={() => setDensity("grid")}><LayoutGrid className="h-3.5 w-3.5" />卡片</FilterButton><FilterButton active={density === "list"} onClick={() => setDensity("list")}><List className="h-3.5 w-3.5" />列表</FilterButton></div></div></div></section>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 overflow-x-auto pb-1"><Button size="sm" variant={selectedGroupId === null ? "secondary" : "ghost"} onClick={() => setSelectedGroupId(null)}>全部资源 <span className="ml-1 text-xs text-muted-foreground">{resources.length}</span></Button>{(groupsQuery.data ?? []).map((group) => <Button key={group.id} size="sm" variant={selectedGroupId === group.id ? "secondary" : "ghost"} onClick={() => setSelectedGroupId(group.id)}>{group.name}<span className="ml-1 text-xs text-muted-foreground">{group.resourceCount}</span></Button>)}<Button size="sm" variant="ghost" onClick={() => setShowGroupCreate(true)}><FolderPlus />新建分组</Button></div><p className="text-sm text-muted-foreground">显示 {visibleResources.length} / {resources.length}</p></div>

      {resourcesQuery.isLoading && resources.length === 0 ? <div aria-busy="true" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-[360px] animate-pulse-soft rounded-lg border bg-muted/50" />)}</div> : resourcesQuery.error && resources.length === 0 ? <div role="alert" className="command-surface border-destructive/30 bg-destructive/5 px-4 py-8 text-center"><p className="font-medium text-destructive">外部资源加载失败</p><p className="mt-1 text-sm text-muted-foreground">{resourcesQuery.error.message}</p><Button variant="outline" className="mt-4" onClick={() => resourcesQuery.refetch()}>重新加载</Button></div> : visibleResources.length === 0 ? <div className="command-surface border-dashed px-4 py-12 text-center"><Globe2 className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">还没有匹配的外部资源</p><p className="mt-1 text-sm text-muted-foreground">保存一篇文章、一篇论文或一个值得回访的网站。</p><Button className="mt-4" onClick={() => setShowCreate(true)}><Plus />保存第一条资源</Button></div> : <><div className={cn("grid gap-4", density === "grid" ? "md:grid-cols-2 xl:grid-cols-3" : "xl:grid-cols-2")}>{visibleResources.map((resource) => <ResourceCard key={resource.id} density={density} resource={resource} groups={groupsQuery.data ?? []} pending={updateResource.isPending || addToGroup.isPending || requestContent.isPending} onAddToGroup={(groupId, resourceId) => addToGroup.mutate({ groupId, resourceId })} onEdit={setEditing} onDelete={setDeleting} onToggleRead={(item) => handleToggle(item, "isRead")} onTogglePinned={(item) => handleToggle(item, "isPinned")} onRequestContent={requestResourceContent} onReadContent={showResourceContent} />)}</div>{canLoadMore && <div className="flex justify-center pt-6"><Button variant="outline" onClick={() => setResourceOffset(resources.length)} disabled={resourcesQuery.isFetching}>加载更多</Button></div>}</>}
    </div>

    <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>保存外部资源</DialogTitle><DialogDescription>保存 URL 和预览信息；默认不自动抓取正文或生成 embedding。</DialogDescription></DialogHeader><ResourceForm onSubmit={(value) => createResource.mutate(value)} pending={createResource.isPending} onCancel={() => setShowCreate(false)} /></DialogContent></Dialog>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>编辑收藏</DialogTitle><DialogDescription>只更新当前用户的备注、标签和预览元数据。</DialogDescription></DialogHeader>{editing && <ResourceForm initial={editing} onSubmit={(value) => updateResource.mutate({ resourceId: editing.id, title: value.title, description: value.description ?? null, siteName: value.siteName ?? null, author: value.author ?? null, tags: value.tags, notes: value.notes ?? null })} pending={updateResource.isPending} onCancel={() => setEditing(null)} />}</DialogContent></Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>删除这条收藏？</DialogTitle><DialogDescription>将删除“{deleting?.title}”及它在外部资源分组中的成员关系。此操作不可撤销。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" onClick={() => deleting && removeResource.mutate({ resourceId: deleting.id })} disabled={removeResource.isPending}>{removeResource.isPending && <Loader2 className="animate-spin" />}确认删除</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={showGroupCreate} onOpenChange={setShowGroupCreate}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>新建外部资源分组</DialogTitle><DialogDescription>分组只管理文章、论文和网站，不会混入 GitHub 仓库。</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="resource-group-name">名称</Label><Input id="resource-group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="例如：UI 素材、待读论文" maxLength={50} autoFocus /></div><div className="grid gap-2"><Label htmlFor="resource-group-description">描述</Label><Textarea id="resource-group-description" value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder="可选" maxLength={500} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowGroupCreate(false)}>取消</Button><Button onClick={handleCreateGroup} disabled={!groupName.trim() || createGroup.isPending}>{createGroup.isPending && <Loader2 className="animate-spin" />}创建分组</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={readingId !== null} onOpenChange={(open) => !open && setReadingId(null)}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>正文</DialogTitle><DialogDescription>{readContent.data ? `${readContent.data.contentType.toUpperCase()} · ${readContent.data.finalUrl}` : "读取已采集的正文"}</DialogDescription></DialogHeader>{readContent.isFetching ? <div aria-busy="true" className="py-8 text-center text-sm text-muted-foreground">正在读取正文…</div> : readContent.error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">正文读取失败：{readContent.error.message}</div> : readContent.data ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm leading-6">{readContent.data.text.slice(0, 50_000)}{readContent.data.text.length > 50_000 ? "\n\n（正文过长，仅展示前 50,000 个字符）" : ""}</pre> : <p className="py-8 text-center text-sm text-muted-foreground">尚未采集正文。</p>}</DialogContent></Dialog>
    </main>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors duration-150", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>;
}
