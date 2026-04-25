---
name: sync-center-ui-adjust
overview: 同步中心UI调整：字体更细、右侧大底板删除、左侧底板和字体颜色按参考图调整
todos:
  - id: adjust-font-weight
    content: 在styles.css最终覆盖层中降低所有sync-center字体权重
    status: completed
  - id: remove-right-panel
    content: 移除右侧内容区毛玻璃底板效果（背景/边框/阴影/模糊滤镜）
    status: completed
  - id: adjust-left-colors
    content: 修改左侧侧边栏底板为rgb(60,73,83)和字体为rgb(246,248,250)
    status: completed
  - id: verify-and-cleanup
    content: 检查中间层重复定义并同步修改，确认选中态和hover态样式正常
    status: completed
    dependencies:
      - adjust-font-weight
      - remove-right-panel
      - adjust-left-colors
---

## 产品概述

同步中心页面UI样式微调，使其更接近参考图的设计风格

## 核心功能

- **字体更细**：降低同步中心所有侧边栏及内容区的 font-weight，从粗体(800/850/700)调整为细体(400/500/600)
- **右侧大底板删除**：移除右侧内容区（.sw-content / .dmw-content）的毛玻璃底板效果（背景、边框、阴影、模糊滤镜全部移除），使右侧内容直接透出，与参考图一致
- **左侧底板颜色调整**：侧边栏底板背景色改为 rgb(60, 73, 83)
- **左侧字体更白**：侧边栏文字颜色改为 rgb(246, 248, 250)

## 技术栈

- 纯CSS修改，无框架变更
- 主文件：`e:\project\dbsearch\src\styles.css`（同步中心样式集中在 11085-12800 行区间）

## 实现方案

在 `styles.css` 的 "Final sync center overrides" 区块（行 12549 起，这是最终覆盖层，优先级最高）中进行修改，确保改动不会被后续规则覆盖。

### 具体修改点

**1. 字体权重调细**（在行 12549 后的最终覆盖层中添加/修改）：

| 选择器 | 当前 font-weight | 目标 font-weight |
| --- | --- | --- |
| `.sync-center-sidebar-section-head` | 850 | 500 |
| `.sync-center-sidebar-mode, .sw-sidebar-item, .dmw-sidebar-item` | 800 | 500 |
| `.sync-center-sidebar-caption` | 800 | 500 |
| `.sync-center-sidebar-search input` | 700 | 400 |
| `.sync-center-sidebar-search` | 700 | 400 |
| `.sync-center-sidebar-empty` | 650 | 400 |
| `.sw-profile-name, .dmw .sw-profile-name` | 850 | 600 |
| `.sync-center-sidebar-copy small, .sw-sidebar-time, .dmw-sidebar-summary` | 650 | 400 |
| `.sync-center-sidebar-group, .dmw-sidebar-caption, .dmw-sidebar-count` | 800 | 500 |


**2. 右侧大底板删除**（修改行 12788-12795 区域）：

将 `.sync-center-file-body .sw-content` 和 `.dmw-root--embedded .dmw-content` 的：

- `background: rgba(43, 59, 84, 0.32)` → `background: transparent`
- `border: 1px solid var(--sc-line)` → `border: none`
- `box-shadow: ...` → `box-shadow: none`
- `backdrop-filter: blur(22px) saturate(126%)` → `backdrop-filter: none`
- `-webkit-backdrop-filter: ...` → `-webkit-backdrop-filter: none`

**3. 左侧底板颜色 + 字体颜色**：

底板背景：

- `.sync-center-sidebar-shell` 的 `background` 从 `linear-gradient(180deg, rgba(151,166,188,0.5), rgba(103,119,143,0.42))` → `rgb(60, 73, 83)`

字体颜色：

- `--sc-text-soft` CSS变量从 `rgba(225, 234, 247, 0.74)` → `rgba(246, 248, 250, 1)`（即 rgb(246,248,250)）
- `.sync-center-sidebar-section-head` 的 `color` → `rgb(246, 248, 250)`
- `.sync-center-sidebar-mode, .sw-sidebar-item, .dmw-sidebar-item` 的 `color` → `rgb(246, 248, 250)`
- `.sync-center-sidebar-caption` 的 `color` → `rgba(246, 248, 250, 0.7)`（次级文字略淡）
- `.sync-center-sidebar-copy small, .sw-sidebar-time, .dmw-sidebar-summary` 的 `color` → `rgba(246, 248, 250, 0.7)`

## 目录结构

```
e:\project\dbsearch\src\
└── styles.css  # [MODIFY] 修改同步中心相关CSS样式（行11085-12800区间）
```

## 实现注意事项

- 所有修改集中在 "Final sync center overrides" 区块（行12549起），因为这是最终覆盖层，优先级最高
- 同时需检查行 11903-12302 的 "weather-app layout" 区块是否有重复定义需同步修改
- 修改后确认选中态（.selected）的样式仍正确显示
- 底板删除后右侧内容区 padding 需保留，确保内容不贴边