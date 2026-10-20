# Fluut

DSH 界面微调。五个开关，全部是纯视觉，随时可以还原：

| 开关 | 默认 | 作用 |
|---|---|---|
| 精简品牌 | 开 | 去掉 `HARNESS` 徽章，鱼标对齐到下面的面板图标 |
| 隐藏「新会话」 | 开 | 移除品牌行下面的新会话按钮 |
| 侧栏不透明 | 关 | 把半透明毛玻璃底换成实心底色 |
| 轨迹轨移到左侧 | 开 | 每轮对话的导航刻度从右侧挪到内容区左边 |
| 滚动条自动隐藏 | 开 | 不滚动时隐藏内容区滚动条，滚动时才出现 |
| 音频琴键 | 开 | 左侧每轮刻度的长度跟随系统音频伸缩 |

设置位置：设置 → 界面微调。

## CoreAudio 说明

音频采样器使用 CoreAudio 的 process tap 采集系统输出，不触发系统录屏提示。

## 五个实现细节

### 1. HARNESS 徽章不是元素，是字标 SVG 的一部分

字标是一张 156×24 的 SVG：

```
<svg width="156" height="24" viewBox="26 0 156 24">
  <path/> × 17                                   ← "deepseek" 逐字
  <rect x="129.348" y="5.5" width="52" rx="2"/>  ← HARNESS 徽章底
</svg>
```

插件把 `viewBox` 和 `width` 截到徽章左边缘（`129.348 - 26 - 4 ≈ 99.35`）。徽章坐标从 DOM 读取，不是写死的。

### 2. 鱼标和面板图标差 6px

品牌行 `padding-left: 4px`；面板行是 `margin: 0 2px; padding: 7px 8px`，外层列还有 `12px` 内边距。量出来鱼标在 16px、图标在 22px。

插件运行时量出差值再补 `margin-left`，每次只补「还差多少」，所以会收敛。实测两者左边缘差值为 0。

### 3. 侧栏不透明用内容区的底色

| | 亮色 | 暗色 |
|---|---|---|
| `--dsw-specific-sidebar-fill`（侧栏默认） | `#f9fafb` | `#1b1b1c` |
| `--dsw-alias-bg-base`（内容区） | `#fff` | `#151517` |

用前者会和纯白内容区差出一道色差，所以不透明模式用后者，左右同色。

### 4. 轨迹轨的悬浮卡片要跟着翻向

轨道本身是 `position:absolute; right:12px`，改成 `left:12px` 就到左边。但它里面的悬浮卡片是 `right: calc(100% + 10px)`，即贴在轨道左侧。轨道移到左边后，卡片会弹到屏幕外。

卡片有稳定的 `role="tooltip"`，插件把它翻成 `left: calc(100% + 10px)`，卡片就朝右弹出。

### 5. 滚动条是自绘的

原生滚动条无法做到「滚动时出现、停下隐藏」，所以插件隐藏原生滚动条，自己画一根：

- 监听 `scroll`（捕获阶段，挂 document 上，不用逐个元素绑定）
- 按滚动比例算位置和高度
- 停下 0.9 秒后淡出

`pointer-events: none`，不挡点击。

### 6. 音频琴键：三段式

界面拿不到系统音频，所以拆成三段：

```
Swift 采样进程         宿主半边(Node)            界面半边
ScreenCaptureKit  →   stdout 每 50ms 一行  →   本地 HTTP 127.0.0.1:47821
算 7 段能量           起服务 + 加 CORS 头         每 60ms 轮询，写 --sbt-level
```

刻度线是 `::before` 上的 `scaleX`，`transform-origin: 100%`，所以从右端往左伸缩。插件只改长度，颜色和悬停仍由官方状态类控制。

**需要「屏幕录制」权限**：采样器由 App 拉起，macOS 会按 App 归属授权。没授权时刻度不动，其余功能正常。

采样流会偶发卡死（进程还活着但收不到音频缓冲）。插件用两层措施兜底：

- 采样器每帧上报「本轮收到几个音频回调」，连续 3 秒为零就判定卡住，杀掉重开
- 启动前先清掉遗留的采样器进程：两个实例同时采集会互相导致静音

### 7. 发送按钮与设置页排版

两个小修：

- **发送按钮 34×34 → 28×28，图标 16 → 14**。和左边上传按钮同尺寸。它自带一个 `translateY(-2px)` 的视觉补偿，那是给 34px 做的，缩小后必须一起去掉，否则整行光学中心偏 2px——这就是之前看着不齐的原因。
- **设置页标题 20px → 14px**，和左侧导航项同字号，并且垂直中心对齐第一行导航项。同时去掉副标题。

发送按钮没有稳定属性，靠位置识别：输入框卡片里最靠右的那个按钮。

## 稳定性

| DSH 更新改了什么 | 结果 |
|---|---|
| CSS 类名 | 不受影响，插件不用类名 |
| 字标图形坐标 | 不受影响，运行时读取 |
| 插槽名 `sidebar.brand.name` | 跳过裁剪，其余照常 |
| 侧栏结构（root 的直接子 button） | 跳过隐藏，其余照常 |
| 轨道结构 | 靠「会话区内、绝对定位、窄、多按钮」识别；找不到就跳过 |
| 设置页插槽 `settings.section` | 页面消失，开关不可调；侧栏保持上次状态 |

所有改动都可逆：卸载或热重载时把 `viewBox`、`width`、`margin-left`、`display`、定位与滚动条属性逐项还原。

## 偏好存储

`localStorage` 的 `dsh.sidebarTidy.settings`：

```json
{ "trimBrand": true, "hideNewSession": true, "opaqueSidebar": false, "moveTrail": true, "autoHideScrollbar": true }
```

存储读写都在 `try/catch` 里。

## 安装

```bash
dsh plugin --profile desktop add /Users/<you>/.dsh/plugins/dsh-sidebar-tidy
```

装完重启 App。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-sidebar-tidy
```

## 文件

- `lib/index.js` —— 宿主半边。零逻辑，只让这个包成为 cordis 树的一行。
- `lib/client.js` —— 全部逻辑：五个开关、设置页、跟随重渲染、可逆还原。
- `cordis.patch.yml` —— 往 profile 的插件树里插一行。
