/**
 * @package @devscope/web/components
 * @description 创建分组对话框组件
 *
 * 提供创建新分组的表单界面。
 *
 * @module create-group-dialog
 */

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GROUP_COLORS, GROUP_ICONS, getGroupIcon, getGroupColor } from "@/lib/group-config";
import type { GroupColor, CreateGroupInput } from "@devscope/shared";

// ============================================================================
// 类型定义
// ============================================================================

interface CreateGroupDialogProps {
  /** 对话框是否打开 */
  open: boolean;
  /** 关闭对话框 */
  onOpenChange: (open: boolean) => void;
  /** 创建分组回调 */
  onCreate: (input: CreateGroupInput) => void;
}

// ============================================================================
// 组件
// ============================================================================

/**
 * 创建分组对话框组件
 */
export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColor, setSelectedColor] = useState<GroupColor>("blue");
  const [selectedIcon, setSelectedIcon] = useState("folder");

  // 重置表单
  const resetForm = () => {
    setName("");
    setDescription("");
    setSelectedColor("blue");
    setSelectedIcon("folder");
  };

  // 处理创建
  const handleCreate = () => {
    if (!name.trim()) {
      return;
    }

    onCreate({
      name: name.trim(),
      color: selectedColor,
      icon: selectedIcon,
      description: description.trim() || undefined,
    });

    resetForm();
    onOpenChange(false);
  };

  // 处理取消
  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  // 预览配置
  const colorConfig = getGroupColor(selectedColor);
  const iconConfig = getGroupIcon(selectedIcon);
  const IconComponent = iconConfig.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>创建新分组</DialogTitle>
          <DialogDescription>
            为你的仓库创建一个自定义分组，方便组织和管理。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 分组名称 */}
          <div className="space-y-2">
            <Label htmlFor="group-name">
              分组名称 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="group-name"
              placeholder="例如：前端框架、AI 工具"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
            />
            <p className="text-xs text-gray-500">
              {name.length}/50
            </p>
          </div>

          {/* 颜色选择 */}
          <div className="space-y-2">
            <Label>分组颜色</Label>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setSelectedColor(color.value as GroupColor)}
                  className={`
                    w-10 h-10 rounded-lg border-2 transition-all
                    ${selectedColor === color.value
                      ? `${color.solidBg} ${color.solidText} ring-2 ring-offset-2 ring-${color.value}-400`
                      : `${color.bg} ${color.border} hover:${color.hoverBg}`
                    }
                  `}
                  title={color.label}
                >
                  <div className={`w-4 h-4 rounded-full ${color.solidBg}`} />
                </button>
              ))}
            </div>
          </div>

          {/* 图标选择 */}
          <div className="space-y-2">
            <Label>分组图标</Label>
            <div className="grid grid-cols-7 gap-2">
              {GROUP_ICONS.map((iconOption) => {
                const IconComp = iconOption.icon;
                return (
                  <button
                    key={iconOption.value}
                    type="button"
                    onClick={() => setSelectedIcon(iconOption.value)}
                    className={`
                      flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all
                      ${selectedIcon === iconOption.value
                        ? "bg-blue-50 border-blue-500"
                        : "border-gray-200 hover:bg-gray-50"
                      }
                    `}
                    title={iconOption.label}
                  >
                    <IconComp className="h-4 w-4" />
                    <span className="text-[10px] text-gray-500">
                      {iconOption.label.slice(0, 2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 描述 */}
          <div className="space-y-2">
            <Label htmlFor="group-description">分组描述（可选）</Label>
            <Textarea
              id="group-description"
              placeholder="简单描述这个分组的用途..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={200}
            />
            <p className="text-xs text-gray-500">
              {description.length}/200
            </p>
          </div>

          {/* 预览 */}
          {name.trim() && (
            <div className="space-y-2">
              <Label>预览</Label>
              <div
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg border-2
                  ${colorConfig.solidBg} ${colorConfig.solidText}
                `}
              >
                {IconComponent && <IconComponent className="h-4 w-4" />}
                <span className="text-sm font-medium">{name}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
