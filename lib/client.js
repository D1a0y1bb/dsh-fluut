/**
 * dsh-fluut — 客户端半边
 *
 * 三个开关，全部是纯视觉，都能随时还原：
 *   1. 精简品牌：去掉字标里的 HARNESS 徽章，保留鱼标和 deepseek 字标，并把鱼标对齐到面板图标。
 *   2. 隐藏「新会话」按钮。
 *   3. 侧栏不透明：把默认的半透明毛玻璃底换成官方的实心白（暗色主题下是实心深灰）。
 *
 * ── 锚点（来自 app.asar 源码，本插件只用这些）──────────────────────────
 *
 *   侧栏列（画背景的那层）：[data-slot="sidebar"] 的父元素
 *   侧栏根：              [data-slot="sidebar"] > div   （slot 锚点是 display:contents）
 *     ├─ div  品牌行：鱼标 + 字标 + 收起按钮
 *     ├─ button 「新会话」      ← root 的**直接子** button，没有插槽
 *     ├─ nav  面板列表
 *     └─ …
 *
 *   字标（插槽 sidebar.brand.name，单值槽）：
 *     <svg width="156" height="24" viewBox="26 0 156 24">
 *       <path/> × 17      ← "deepseek" 逐字
 *       <rect x="129.348" y="5.5" width="52" height="14" rx="2"/>   ← HARNESS 徽章底
 *     </svg>
 *
 *   徽章是这张 SVG 的一部分，不是独立元素。所以「只去掉 HARNESS」的做法是把
 *   viewBox 截到徽章左边缘：字标保留，徽章落在裁剪区外，不缩放、不留空。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────
 *   1. fail-open：任何锚点找不到就跳过那一项，侧栏保持官方样子。
 *   2. 可逆：每处改动都记下原值，离开时逐项还原。
 *   3. 幂等：侧栏折叠、切会话、开设置都会重渲染，观察器会重新贴一次。
 */
window.__ModuleLoader__.load({
  id: "dsh-fluut",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    /** Marks an SVG whose viewBox this plugin cropped. */
    var CROP_ATTR = "data-sbt-cropped";
    /** Marks an element this plugin hid. */
    var HIDE_ATTR = "data-sbt-hidden";
    /** Marks the brand container whose left offset this plugin nudged. */
    var ALIGN_ATTR = "data-sbt-aligned";
    /** Marks the sidebar column while it is painted opaque. */
    var COLUMN_ATTR = "data-sbt-column";
    /** Marks the document while the opaque sidebar is on. */
    var OPAQUE_ATTR = "data-sbt-opaque";
    /** Marks the soft seam drawn where the header meets the content. */
    /** Marks the frosted band at the header's lower edge. */
    var SEAM_ATTR = "data-sbt-seam";
    /** Marks the sidebar collapse/expand toggle. */
    var TOGGLE_ATTR = "data-sbt-toggle";
    /** Marks our chip button that replaces the tab strip. */
    var CHIP_ATTR = "data-sbt-chip";
    /** Marks our chip's dropdown. */
    var CHIPMENU_ATTR = "data-sbt-chipmenu";
    /** Marks the "Workspaces" section header (label plus its three buttons). */
    var WSHEADER_ATTR = "data-sbt-wsheader";
    /** Marks the label inside that header. */
    var WSLABEL_ATTR = "data-sbt-wslabel";
    /** Marks the three action buttons inside that header. */
    var WSACTIONS_ATTR = "data-sbt-wsactions";
    /** Marks the conversation header while the tab strip is lifted into its first row. */
    var HEADER_ATTR = "data-sbt-header";
    /** Marks the chat/trajectory tab strip. */
    var TABS_ATTR = "data-sbt-tabs";
    /** Marks the rail whose tick lengths the audio currently drives. */
    var KEYS_ATTR = "data-sbt-keys";
    /** Marks the composer's send button, resized to match the add button. */
    var SEND_ATTR = "data-sbt-send";
    /** Marks the turn navigator that this plugin moved to the left edge. */
    var TRAIL_ATTR = "data-sbt-trail";
    /** Marks the conversation scroller whose native scrollbar is hidden. */
    var SCROLL_ATTR = "data-sbt-scroll";
    /** Breathing room between the wordmark's last glyph and the badge, in viewBox units. */
    var GAP = 4;
    /** Preference key in localStorage. */
    var STORAGE_KEY = "dsh.sidebarTidy.settings";
    /** Dictionary namespace for the settings page. */
    var NS = "sidebarTidy";

    var en = {
      nav: "Fluut",
      title: "Fluut",
      subtitle: "Small visual changes to the shell. Every switch takes effect immediately.",
      trimBrand: "Trim the brand",
      trimBrandDesc: "Remove the HARNESS badge and line the whale mark up with the panel icons.",
      hideNewSession: "Hide “New session”",
      hideNewSessionDesc: "Use ⌥⌘N or the + in the input box to start a session.",
      opaqueSidebar: "Opaque sidebar",
      opaqueSidebarDesc: "Replace the translucent window material with the official solid fill.",
      moveTrail: "Turn map on the left",
      moveTrailDesc: "Move the per-turn navigation marks from the right edge to the left edge of the conversation.",
      autoHideScrollbar: "Auto-hide scrollbar",
      autoHideScrollbarDesc: "Hide the content scrollbar until you scroll.",
      audioBars: "Audio keys",
      audioBarsDesc: "The turn ticks stretch with system audio. Needs Screen Recording permission.",
      hoverToggle: "Toggle button on hover",
      hoverToggleDesc: "Hide the collapse button until the pointer enters the sidebar.",
    };

    var zh = {
      nav: "Fluut",
      title: "Fluut",
      subtitle: "界面的小改动。每个开关立即生效。",
      trimBrand: "精简品牌",
      trimBrandDesc: "去掉 HARNESS 徽章，并把鱼标对齐到下面的面板图标。",
      hideNewSession: "隐藏「新会话」",
      hideNewSessionDesc: "改用 ⌥⌘N 或输入框左边的 + 新建会话。",
      opaqueSidebar: "侧栏不透明",
      opaqueSidebarDesc: "把半透明的窗口材质换成官方的实心底色。",
      moveTrail: "轨迹轨移到左侧",
      moveTrailDesc: "把右侧每轮对话的导航刻度挪到内容区左边。",
      autoHideScrollbar: "滚动条自动隐藏",
      autoHideScrollbarDesc: "不滚动时隐藏内容区滚动条，滚动时才出现。",
      audioBars: "音频琴键",
      audioBarsDesc: "左侧每轮刻度的长度跟随系统音频伸缩。需要「屏幕录制」权限。",
      hoverToggle: "收起按钮悬停显示",
      hoverToggleDesc: "默认隐藏侧栏收起按钮，鼠标进入侧栏才出现。",
      showViewTabs: "显示「对话 / 轨迹」",
      showViewTabsDesc: "关闭后两个页签直接隐藏，顶栏收成一行。",
      softSeam: "顶栏柔和过渡",
      softSeamDesc: "页签隐藏时，顶栏下沿加一条轻微高斯模糊带，内容经过时被柔化。",
    };

    /** Switch defaults: the first two are this plugin's purpose, the third is opt-in. */
    var DEFAULTS = { trimBrand: true, hideNewSession: true, opaqueSidebar: false, moveTrail: true, autoHideScrollbar: true, audioBars: true, hoverToggle: true, showViewTabs: true, softSeam: true };
    /** Every switch this plugin owns. */
    var KEYS = ["trimBrand", "hideNewSession", "opaqueSidebar", "moveTrail", "autoHideScrollbar", "audioBars", "hoverToggle", "showViewTabs", "softSeam"];

    /** Read the stored preferences; a broken store must not break the plugin. */
    function readState() {
      var state = {};
      for (var k = 0; k < KEYS.length; k += 1) state[KEYS[k]] = DEFAULTS[KEYS[k]];
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return state;
        var parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return state;
        for (var i = 0; i < KEYS.length; i += 1) {
          if (typeof parsed[KEYS[i]] === "boolean") state[KEYS[i]] = parsed[KEYS[i]];
        }
        return state;
      } catch {
        return state;
      }
    }

    /** Write the preferences; a full or blocked store is not an error here. */
    function writeState(state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* the switches still work for this page life */
      }
    }

    /** The sidebar root: the slot anchor renders with `display: contents`, so its first child paints. */
    function sidebarRoot() {
      var anchor = document.querySelector('[data-slot="sidebar"]');
      return anchor === null ? null : anchor.firstElementChild;
    }

    /** The column that paints the sidebar background. */
    function sidebarColumn() {
      var anchor = document.querySelector('[data-slot="sidebar"]');
      return anchor === null ? null : anchor.parentElement;
    }

    /** @param root - the sidebar root element. */
    function hideNewSession(root) {
      try {
        var button = null;
        for (var i = 0; i < root.children.length; i += 1) {
          if (root.children[i].tagName === "BUTTON") {
            button = root.children[i];
            break;
          }
        }
        if (button === null || button.hasAttribute(HIDE_ATTR)) return;
        button.setAttribute(HIDE_ATTR, "");
        button.style.display = "none";
      } catch {
        /* a missing button is not an error */
      }
    }

    /**
     * Crop the brand wordmark down to the "deepseek" glyphs.
     *
     * The badge is the only `<rect>` in the wordmark that carries both `rx` and
     * an explicit `x`; the others are clip paths without coordinates. Reading
     * its `x` instead of hard-coding 129.348 means a redesigned wordmark still
     * crops in the right place.
     *
     * @param svg - the wordmark element inside `[data-slot="sidebar.brand.name"]`.
     */
    function cropBadge(svg) {
      try {
        if (svg.hasAttribute(CROP_ATTR)) return;
        var badge = null;
        var rects = svg.querySelectorAll("rect");
        for (var i = 0; i < rects.length; i += 1) {
          if (rects[i].getAttribute("rx") !== null && rects[i].getAttribute("x") !== null) {
            badge = rects[i];
            break;
          }
        }
        if (badge === null) return;
        var rawViewBox = svg.getAttribute("viewBox");
        if (rawViewBox === null) return;
        var box = rawViewBox.trim().split(/[\s,]+/).map(Number);
        if (box.length !== 4 || !box.every(Number.isFinite)) return;
        var badgeX = Number(badge.getAttribute("x"));
        if (!Number.isFinite(badgeX)) return;
        var keep = badgeX - box[0] - GAP;
        if (keep <= box[2] * 0.5 || keep >= box[2]) return;
        svg.dataset.sbtViewBox = rawViewBox;
        svg.dataset.sbtWidth = svg.getAttribute("width") || "";
        svg.setAttribute("viewBox", box[0] + " " + box[1] + " " + keep + " " + box[3]);
        svg.setAttribute("width", String(keep));
        svg.setAttribute(CROP_ATTR, "");
      } catch {
        /* a missing wordmark is not an error */
      }
    }

    /**
     * Line the brand mark up with the panel icons below it.
     *
     * The two rows disagree by a few pixels: the brand row pads itself by 4px,
     * while a panel row is `margin: 0 2px; padding: 7px 8px` inside a column
     * that pads by 12px. The gap is measured at runtime, not hard-coded.
     *
     * The correction is applied incrementally: each pass moves the container by
     * whatever the current gap is, so it converges instead of accumulating.
     */
    function alignBrand() {
      try {
        var mark = document.querySelector('[data-slot="sidebar.brand.mark"] svg');
        if (mark === null) return;
        var nav = document.querySelector('[data-slot="sidebar"] nav');
        var icon = nav === null ? null : nav.querySelector("button svg");
        if (icon === null) return;
        var identity = brandContainer(mark);
        if (identity === null) return;
        var delta = icon.getBoundingClientRect().left - mark.getBoundingClientRect().left;
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
        if (!identity.hasAttribute(ALIGN_ATTR)) {
          identity.setAttribute(ALIGN_ATTR, "");
          identity.dataset.sbtMargin = identity.style.marginLeft || "";
        }
        var current = parseFloat(window.getComputedStyle(identity).marginLeft);
        if (!Number.isFinite(current)) current = 0;
        identity.style.marginLeft = current + delta + "px";
      } catch {
        /* a missing mark or panel row is not an error */
      }
    }

    /**
     * Find the container that holds both brand slots.
     *
     * Structural, not class-based: walk up from the mark until an ancestor also
     * owns the name slot. Null while the sidebar is collapsed, because the name
     * slot is not rendered then.
     */
    function brandContainer(mark) {
      var node = mark.parentElement;
      for (var hops = 0; node !== null && hops < 6; hops += 1) {
        if (node.querySelector('[data-slot="sidebar.brand.name"]') !== null) return node;
        node = node.parentElement;
      }
      return null;
    }

    /** Paint the sidebar column opaque, or take the attribute back off. */
    function applyOpaque(on) {
      try {
        var root = document.documentElement;
        if (!on) {
          root.removeAttribute(OPAQUE_ATTR);
          return;
        }
        var column = sidebarColumn();
        if (column === null) return;
        column.setAttribute(COLUMN_ATTR, "");
        root.setAttribute(OPAQUE_ATTR, "");
      } catch {
        /* a missing column is not an error */
      }
    }

    /**
     * Give the send button the same footprint as the add button.
     *
     * The shell ships them uneven: the add button is 28×28 with a 14px glyph,
     * the send button 34×34 with a 16px glyph. Because the row centres its
     * children, the taller button also drags the row's optical centre off by a
     * couple of pixels, which is what makes the model arrow look low.
     *
     * The send button carries no stable attribute, so it is identified by
     * position: the rightmost button inside the composer card.
     */
    function tagSendButton() {
      try {
        var card = document.querySelector("[data-composer-card]");
        if (card === null) return;
        var buttons = card.querySelectorAll("button");
        var pick = null;
        var best = -Infinity;
        for (var i = 0; i < buttons.length; i += 1) {
          var right = buttons[i].getBoundingClientRect().right;
          if (right > best) {
            best = right;
            pick = buttons[i];
          }
        }
        if (pick === null || pick.hasAttribute(SEND_ATTR)) return;
        pick.setAttribute(SEND_ATTR, "");
      } catch {
        /* a missing composer is not an error */
      }
    }







    /**
     * Align the "Workspaces" label with the panel icons, and keep its three
     * buttons out of the way until the header is hovered.
     *
     * The section header has no stable attribute, so it is found from the first
     * workspace row: the actions container is the nearest element above it that
     * holds two or more buttons.
     */
    function applyWorkspaceHeader() {
      try {
        var stale = document.querySelectorAll("[" + WSHEADER_ATTR + "],[" + WSLABEL_ATTR + "],[" + WSACTIONS_ATTR + "]");
        for (var st = 0; st < stale.length; st += 1) {
          stale[st].removeAttribute(WSHEADER_ATTR);
          stale[st].removeAttribute(WSLABEL_ATTR);
          stale[st].removeAttribute(WSACTIONS_ATTR);
          stale[st].style.removeProperty("margin-left");
        }
        var sidebar = document.querySelector('[data-slot="sidebar"]');
        if (sidebar === null) return;

        // 1. Marker and title alignment. This applies to every display mode
        // (grouped, tree, single list), so it does not depend on the section
        // header existing at all.
        var panelIcon = sidebar.querySelector("nav button svg");
        var panelRow = sidebar.querySelector("nav button");
        if (panelIcon === null || panelRow === null) return;
        var panelIconLeft = panelIcon.getBoundingClientRect().left;
        var panelTitle = null;
        var panelLeaves = panelRow.querySelectorAll("*");
        for (var pl = 0; pl < panelLeaves.length; pl += 1) {
          if (panelLeaves[pl].children.length === 0 && (panelLeaves[pl].textContent || "").trim().length > 0) {
            panelTitle = panelLeaves[pl];
            break;
          }
        }
        var panelTextLeft = panelTitle === null ? null : panelTitle.getBoundingClientRect().left;

        var rows = sidebar.querySelectorAll("[data-row-key]");
        for (var r = 0; r < rows.length; r += 1) {
          var rowEl = rows[r];
          var icon = rowEl.querySelector("svg");
          if (icon === null || icon.getBoundingClientRect().width === 0) icon = rowEl.firstElementChild;
          if (icon !== null && icon.getBoundingClientRect().width > 0) {
            var gap = panelIconLeft - icon.getBoundingClientRect().left;
            if (Number.isFinite(gap) && Math.abs(gap) >= 0.5) {
              var pad = parseFloat(window.getComputedStyle(rowEl).paddingInlineStart);
              if (!Number.isFinite(pad)) pad = 0;
              rowEl.style.paddingInlineStart = pad + gap + "px";
              rowEl.setAttribute("data-sbt-rowshift", "");
            }
          }
          if (panelTextLeft === null) continue;
          // The title is the longest text leaf outside the marker.
          var title = null;
          var bestLen = 0;
          var cands = rowEl.querySelectorAll("*");
          for (var c = 0; c < cands.length; c += 1) {
            var cand = cands[c];
            if (icon !== null && (cand === icon || icon.contains(cand))) continue;
            if (cand.children.length !== 0) continue;
            var len = (cand.textContent || "").trim().length;
            if (len > bestLen) { bestLen = len; title = cand; }
          }
          if (title === null) continue;
          var need = panelTextLeft - title.getBoundingClientRect().left;
          if (!Number.isFinite(need) || Math.abs(need) < 0.5) continue;
          var cur = parseFloat(window.getComputedStyle(title).marginLeft);
          if (!Number.isFinite(cur)) cur = 0;
          title.style.marginLeft = cur + need + "px";
          rowEl.setAttribute("data-sbt-textshift", "");
        }

        // 1b. The footer row (avatar + name) sits on the same vertical line as the
        // panel icons, so it gets the same treatment.
        try {
          var box = sidebar.getBoundingClientRect();
          var marks = sidebar.querySelectorAll("img, [class*='avatar']");
          var avatar = null;
          for (var a = 0; a < marks.length; a += 1) {
            var ar = marks[a].getBoundingClientRect();
            if (ar.width > 0 && ar.top > box.top + box.height * 0.7) { avatar = marks[a]; break; }
          }
          if (avatar !== null) {
            var footer = avatar.closest("button") || avatar.parentElement;
            if (footer !== null) {
              var footGap = panelIconLeft - avatar.getBoundingClientRect().left;
              if (Number.isFinite(footGap) && Math.abs(footGap) >= 0.5) {
                var footPad = parseFloat(window.getComputedStyle(footer).paddingLeft);
                if (!Number.isFinite(footPad)) footPad = 0;
                footer.style.paddingLeft = footPad + footGap + "px";
                footer.setAttribute("data-sbt-footershift", "");
              }
            }
          }
        } catch {
          /* the footer is optional */
        }

        // 2. Section header: align its label and hide its buttons until hover.
        // Only grouped and tree modes have this header.
        var header = null;
        var node = sidebar.querySelector("[data-row-key]");
        for (var up = 0; up < 6 && node !== null; up += 1) {
          var prev = node.previousElementSibling;
          if (prev !== null) {
            var text = (prev.textContent || "").trim();
            if (prev.querySelectorAll("button").length >= 2 && text.length > 0 && text.length <= 24) {
              header = prev;
              break;
            }
          }
          node = node.parentElement;
        }
        if (header === null) return;
        header.setAttribute(WSHEADER_ATTR, "");
        header.setAttribute(WSACTIONS_ATTR, "");
        if (document.__sbtHoverWatch !== true) {
          document.__sbtHoverWatch = true;
          document.addEventListener("pointermove", function (event) {
            var lit = document.querySelectorAll("[data-sbt-actions-on]");
            for (var i = 0; i < lit.length; i += 1) {
              if (!lit[i].contains(event.target)) lit[i].removeAttribute("data-sbt-actions-on");
            }
          }, true);
        }
        if (header.dataset.sbtHoverBound === undefined) {
          header.dataset.sbtHoverBound = "1";
          header.addEventListener("pointerenter", function () {
            header.setAttribute("data-sbt-actions-on", "");
          });
          header.addEventListener("pointerleave", function () {
            header.removeAttribute("data-sbt-actions-on");
          });
        }
        var label = null;
        var leaves = header.querySelectorAll("*");
        for (var l = 0; l < leaves.length; l += 1) {
          var leaf = leaves[l];
          if (leaf.closest("button") !== null) continue;
          var leafText = (leaf.textContent || "").trim();
          if (leaf.children.length === 0 && leafText.length > 0 && leafText.length <= 12) {
            label = leaf;
            break;
          }
        }
        if (label === null) return;
        label.setAttribute(WSLABEL_ATTR, "");
        var delta = panelIconLeft - label.getBoundingClientRect().left;
        if (Number.isFinite(delta) && Math.abs(delta) >= 0.5) {
          var current = parseFloat(window.getComputedStyle(label).marginLeft);
          if (!Number.isFinite(current)) current = 0;
          label.style.marginLeft = current + delta + "px";
        }
      } catch {
        /* a missing sidebar section is not an error */
      }
    }


    /**
     * Find the per-turn navigation rail.
     *
     * It is a `<nav>` inside the conversation whose class is a build hash, so
     * the plugin identifies it by shape: absolutely positioned, narrow, and
     * holding one button per turn. Anything else in the conversation is a
     * toolbar, not this rail.
     */
    function findTrail() {
      var scope = document.querySelector('[data-slot="main.conversation"]');
      if (scope === null) return null;
      var navs = scope.querySelectorAll("nav");
      for (var i = 0; i < navs.length; i += 1) {
        var nav = navs[i];
        var rect = nav.getBoundingClientRect();
        if (rect.width === 0 || rect.width > 60) continue;
        if (nav.querySelectorAll("button").length < 2) continue;
        if (window.getComputedStyle(nav).position !== "absolute") continue;
        return nav;
      }
      return null;
    }

    /** Move the rail to the conversation's left edge, or put it back on the right. */

    /**
     * Hide the sidebar collapse button until the pointer enters the sidebar.
     *
     * @param on - the switch value.
     */
    function applyToggleHover(on) {
      try {
        var all = document.querySelectorAll("[" + TOGGLE_ATTR + "]");
        for (var i = 0; i < all.length; i += 1) all[i].removeAttribute(TOGGLE_ATTR);
        if (!on) return;
        var sidebar = document.querySelector('[data-slot="sidebar"]');
        if (sidebar === null) return;
        var buttons = sidebar.querySelectorAll("button");
        for (var j = 0; j < buttons.length; j += 1) {
          var cls = (buttons[j].className || "").toString();
          if (cls.indexOf("toggle") >= 0) buttons[j].setAttribute(TOGGLE_ATTR, "");
        }
      } catch {
        /* a missing sidebar is not an error */
      }
    }

    /**
     * Show or hide the chat/trajectory tabs, without moving or restyling them.
     *
     * @param on - the switch value; false hides the strip.
     */
    /**
     * The strip that holds the chat and trajectory tabs.
     *
     * It has no stable attribute, so it is identified by shape: a row of two or
     * more short-labelled buttons inside the conversation header.
     *
     * @returns the strip element, or null when the view has no tabs.
     */
    function findTabStrip() {
      try {
        var scope = document.querySelector('[data-slot="main.conversation"]');
        if (scope === null) return null;
        var header = scope.querySelector("header");
        if (header === null) return null;
        var nodes = header.querySelectorAll("div");
        for (var i = 0; i < nodes.length; i += 1) {
          var node = nodes[i];
          var kids = node.children;
          if (kids.length < 2) continue;
          var allButtons = true;
          for (var k = 0; k < kids.length; k += 1) {
            if (kids[k].tagName !== "BUTTON") { allButtons = false; break; }
          }
          if (!allButtons) continue;
          var label = (kids[0].textContent || "").trim();
          if (label.length > 0 && label.length <= 6) return node;
        }
        return null;
      } catch {
        return null;
      }
    }

    /**
     * Remove leftovers from older builds.
     *
     * Earlier versions created floating tab elements and attached them to the
     * body. Nothing creates them now, so any that remain are dead weight: they
     * enlarge the page and show up when the page is scrolled.
     */
    function dropStrayFloaters() {
      try {
        var stray = document.querySelectorAll("body > .sbt-chip, body > .sbt-chipmenu");
        for (var i = 0; i < stray.length; i += 1) stray[i].remove();
      } catch {
        /* cleanup is best effort */
      }
    }

    function applyViewTabs(on) {
      try {
        var strip = document.querySelector("[data-sbt-tabs]");
        if (strip === null) {
          var found = findTabStrip();
          if (found === null) return;
          found.setAttribute(TABS_ATTR, "");
          strip = found;
        }
        // The strip owns the header's second row. Hiding it alone would leave an
        // empty band, so the header also loses its fixed height and second row.
        var header = strip.closest("header");
        // The shell draws a 1px divider under the header. It reads as a hard line
        // against the content, so it is dropped while this plugin manages tabs.
        if (header !== null) header.setAttribute("data-sbt-noline", "");
        if (on) {
          strip.removeAttribute("data-sbt-hide");
          if (header !== null) header.removeAttribute("data-sbt-narrows");
          return;
        }
        strip.setAttribute("data-sbt-hide", "");
        if (header !== null) header.setAttribute("data-sbt-narrows", "");
      } catch {
        /* a missing strip is not an error */
      }
    }


    /** The frosted band drawn at the header's lower edge. */
    var seamEl = null;

    /** Create the band once. */
    function ensureSeam() {
      if (seamEl !== null && seamEl.isConnected) return;
      seamEl = document.createElement("div");
      seamEl.className = "sbt-seam";
      seamEl.setAttribute(SEAM_ATTR, "");
      document.body.appendChild(seamEl);
    }

    /**
     * Draw a light frosted band at the header's lower edge.
     *
     * Only the backdrop is blurred: no tint, no sheen. The band fades out at its
     * lower edge, so content slides under it instead of hitting a cut line.
     *
     * @param on - true when the switch is on and the tabs are hidden.
     */
    function applySeam(on) {
      try {
        if (!on) {
          if (seamEl !== null) seamEl.removeAttribute("data-sbt-show");
          return;
        }
        var scroller = document.querySelector("[data-conversation-scroll]");
        if (scroller === null) {
          if (seamEl !== null) seamEl.removeAttribute("data-sbt-show");
          return;
        }
        ensureSeam();
        var area = scroller.getBoundingClientRect();
        seamEl.style.left = Math.round(area.left) + "px";
        seamEl.style.width = Math.round(area.width) + "px";
        seamEl.style.top = Math.round(area.top) + "px";
        seamEl.setAttribute("data-sbt-show", "");
      } catch {
        /* the band is decoration only */
      }
    }

    function applyTrail(on) {
      try {
        var existing = document.querySelectorAll("[" + TRAIL_ATTR + "]");
        for (var i = 0; i < existing.length; i += 1) existing[i].removeAttribute(TRAIL_ATTR);
        if (!on) return;
        var trail = findTrail();
        if (trail === null) return;
        trail.setAttribute(TRAIL_ATTR, "");
        // The shell centres the rail inside the message list, which sits a bit
        // above the content area's centre. Push it back down to centre.
        var scroller = document.querySelector("[data-conversation-scroll]");
        if (scroller !== null) {
          var railBox = trail.getBoundingClientRect();
          var areaBox = scroller.getBoundingClientRect();
          var off = (areaBox.top + areaBox.bottom) / 2 - (railBox.top + railBox.bottom) / 2;
          if (Number.isFinite(off) && Math.abs(off) >= 0.5) {
            var margin = parseFloat(window.getComputedStyle(trail).marginTop);
            if (!Number.isFinite(margin)) margin = 0;
            trail.style.marginTop = margin + off + "px";
            trail.setAttribute("data-sbt-railcentred", "");
          }
        }
      } catch {
        /* a missing rail is not an error */
      }
    }

    /** The custom scrollbar thumb this plugin draws while scrolling. */
    var thumb = null;
    /** Pending hide timer for the thumb. */
    var thumbTimer = 0;

    /** Create the thumb once and reuse it. */
    function ensureThumb() {
      if (thumb !== null && thumb.isConnected) return thumb;
      thumb = document.createElement("div");
      thumb.className = "sbt-thumb";
      document.body.appendChild(thumb);
      return thumb;
    }

    /** The scroller the thumb is currently tracking. */
    var activeScroller = null;

    /**
     * Every area that should get the auto-hiding scrollbar.
     *
     * The conversation scroller has a stable attribute. Dialog scrollers (the
     * settings sheet and its panes) do not, so they are found by what they are:
     * a box inside a dialog that actually overflows vertically.
     */
    function scrollables() {
      var found = [];
      try {
        var conversation = document.querySelector("[data-conversation-scroll]");
        if (conversation !== null) found.push(conversation);
        var dialogs = document.querySelectorAll('[role="dialog"]');
        for (var d = 0; d < dialogs.length; d += 1) {
          var nodes = [dialogs[d]].concat([].slice.call(dialogs[d].querySelectorAll("*")));
          for (var i = 0; i < nodes.length; i += 1) {
            var node = nodes[i];
            if (node.scrollHeight - node.clientHeight < 8) continue;
            if (node.getBoundingClientRect().height < 60) continue;
            var overflow = window.getComputedStyle(node).overflowY;
            if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
            found.push(node);
          }
        }
      } catch {
        /* best effort */
      }
      return found;
    }

    /** Place the thumb against one scroller's current geometry. */
    function updateThumb(scroller) {
      try {
        if (scroller === undefined || scroller === null) scroller = activeScroller;
        if (scroller === null || thumb === null || !scroller.isConnected) return;
        activeScroller = scroller;
        var rect = scroller.getBoundingClientRect();
        var scrollable = scroller.scrollHeight - scroller.clientHeight;
        if (scrollable < 8 || rect.height < 40) {
          thumb.removeAttribute("data-sbt-show");
          return;
        }
        var trackTop = rect.top + 6;
        var trackHeight = rect.height - 12;
        var size = Math.max(26, (scroller.clientHeight / scroller.scrollHeight) * trackHeight);
        var travel = trackHeight - size;
        var top = trackTop + (scroller.scrollTop / scrollable) * travel;
        thumb.style.top = Math.round(top) + "px";
        thumb.style.left = Math.round(rect.right - 16) + "px";
        thumb.style.height = Math.round(size) + "px";
      } catch {
        /* geometry is best-effort */
      }
    }

    /** Show the thumb for a moment after a scroll. */
    function flashThumb(target) {
      try {
        var scroller = null;
        if (target !== undefined && target !== null && target.hasAttribute && target.hasAttribute(SCROLL_ATTR)) {
          scroller = target;
        } else {
          scroller = document.querySelector("[" + SCROLL_ATTR + "]");
        }
        if (scroller === null) return;
        ensureThumb();
        updateThumb(scroller);
        if (thumb === null || thumb.style.height === "") return;
        thumb.setAttribute("data-sbt-show", "");
        if (thumbTimer !== 0) window.clearTimeout(thumbTimer);
        thumbTimer = window.setTimeout(function () {
          thumbTimer = 0;
          if (thumb !== null) thumb.removeAttribute("data-sbt-show");
        }, 900);
      } catch {
        /* never let the indicator break scrolling */
      }
    }

    /** Hide the native scrollbars and keep our own thumb, or restore them. */
    function applyScrollbar(on) {
      try {
        var all = document.querySelectorAll("[" + SCROLL_ATTR + "]");
        for (var i = 0; i < all.length; i += 1) all[i].removeAttribute(SCROLL_ATTR);
        if (!on) {
          activeScroller = null;
          if (thumb !== null) thumb.removeAttribute("data-sbt-show");
          return;
        }
        var found = scrollables();
        for (var j = 0; j < found.length; j += 1) found[j].setAttribute(SCROLL_ATTR, "");
        ensureThumb();
      } catch {
        /* a missing scroller is not an error */
      }
    }

    /** Address of the level server the host half runs. */
    var LEVEL_URL = "http://127.0.0.1:47821/levels";
    /** Self-scheduling poll handle. */
    var audioTimer = 0;
    /** True while the switch is on, so a late response cannot revive the effect. */
    var audioOn = false;

    /**
     * Paint one frame of levels onto the turn rail's ticks.
     *
     * Each tick is a `::before` scaled on X from its right edge, so driving
     * `scaleX` through a custom property keeps the shell's own state classes in
     * charge of colour and hover; this only replaces the length.
     *
     * @param frame - `{ok, bands}` from the host bridge, or null on failure.
     */
    function renderAudio(frame) {
      try {
        var trail = findTrail();
        if (trail === null) return;
        var bands = frame !== null && frame.ok === true && Array.isArray(frame.bands) ? frame.bands : [];
        var peaks = 0;
        for (var p = 0; p < bands.length; p += 1) peaks = Math.max(peaks, Number(bands[p]) || 0);
        if (bands.length === 0 || peaks < 0.08) {
          clearAudio();
          return;
        }
        var marks = trail.querySelectorAll("button[data-index]");
        for (var i = 0; i < marks.length; i += 1) {
          var band = Math.min(bands.length - 1, Math.floor((i * bands.length) / marks.length));
          var value = Math.min(1, Math.max(0, Number(bands[band]) || 0));
          marks[i].style.setProperty("--sbt-level", (0.18 + value * 0.82).toFixed(3));
        }
        trail.setAttribute(KEYS_ATTR, "");
      } catch {
        /* never let the visualiser break the shell */
      }
    }

    /** Hand the ticks back to the shell. */
    function clearAudio() {
      try {
        var live = document.querySelectorAll("[" + KEYS_ATTR + "]");
        for (var i = 0; i < live.length; i += 1) {
          live[i].removeAttribute(KEYS_ATTR);
          var marks = live[i].querySelectorAll("button[data-index]");
          for (var j = 0; j < marks.length; j += 1) marks[j].style.removeProperty("--sbt-level");
        }
      } catch {
        /* nothing to clear */
      }
    }

    /** Poll the level server on a short interval; stops when switched off. */
    function pollAudio() {
      if (!audioOn) return;
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var guard = controller === null ? 0 : window.setTimeout(function () {
        try {
          controller.abort();
        } catch {
          /* already finished */
        }
      }, 400);
      var done = function (frame) {
        if (guard !== 0) window.clearTimeout(guard);
        if (!audioOn) return;
        renderAudio(frame);
        audioTimer = window.setTimeout(pollAudio, 60);
      };
      try {
        fetch(LEVEL_URL, controller === null ? { cache: "no-store" } : { cache: "no-store", signal: controller.signal })
          .then(function (response) { return response.json(); })
          .then(done)
          .catch(function () { done(null); });
      } catch {
        done(null);
      }
    }

    /** Turn the audio-driven ticks on or off. */
    function applyAudio(on) {
      try {
        if (on) {
          if (audioOn) return;
          audioOn = true;
          pollAudio();
          return;
        }
        audioOn = false;
        if (audioTimer !== 0) {
          window.clearTimeout(audioTimer);
          audioTimer = 0;
        }
        clearAudio();
      } catch {
        /* a missing rail is not an error */
      }
    }

    /** Undo every edit, leaving the sidebar exactly as the shell rendered it. */
    function restore() {
      try {
        if (seamEl !== null) {
          seamEl.remove();
          seamEl = null;
        }
        var cropped = document.querySelectorAll("[" + CROP_ATTR + "]");
        for (var i = 0; i < cropped.length; i += 1) {
          var svg = cropped[i];
          if (svg.dataset.sbtViewBox !== undefined) svg.setAttribute("viewBox", svg.dataset.sbtViewBox);
          if (svg.dataset.sbtWidth) svg.setAttribute("width", svg.dataset.sbtWidth);
          delete svg.dataset.sbtViewBox;
          delete svg.dataset.sbtWidth;
          svg.removeAttribute(CROP_ATTR);
        }
        var hidden = document.querySelectorAll("[" + HIDE_ATTR + "]");
        for (var j = 0; j < hidden.length; j += 1) {
          hidden[j].style.removeProperty("display");
          hidden[j].removeAttribute(HIDE_ATTR);
        }
        var aligned = document.querySelectorAll("[" + ALIGN_ATTR + "]");
        for (var k = 0; k < aligned.length; k += 1) {
          var base = aligned[k].dataset.sbtMargin || "";
          if (base) aligned[k].setAttribute("style", "margin-left: " + base);
          else aligned[k].style.removeProperty("margin-left");
          delete aligned[k].dataset.sbtMargin;
          aligned[k].removeAttribute(ALIGN_ATTR);
        }
        var columns = document.querySelectorAll("[" + COLUMN_ATTR + "]");
        for (var m = 0; m < columns.length; m += 1) columns[m].removeAttribute(COLUMN_ATTR);
        document.documentElement.removeAttribute(OPAQUE_ATTR);
        var sends = document.querySelectorAll("[" + SEND_ATTR + "]");
        for (var q = 0; q < sends.length; q += 1) sends[q].removeAttribute(SEND_ATTR);
        var textShifted = document.querySelectorAll("[data-sbt-textshift]");
        for (var ts = 0; ts < textShifted.length; ts += 1) {
          var tRow = textShifted[ts];
          var tTitle = null;
          var tKids = tRow.querySelectorAll("*");
          for (var tk = 0; tk < tKids.length; tk += 1) {
            if (tRow.dataset.sbtTextBase !== undefined && tKids[tk].children.length === 0) {
              tKids[tk].style.removeProperty("margin-left");
              break;
            }
          }
          delete tRow.dataset.sbtTextBase;
          tRow.removeAttribute("data-sbt-textshift");
        }
        var footers = document.querySelectorAll("[data-sbt-footershift]");
        for (var fs = 0; fs < footers.length; fs += 1) {
          footers[fs].style.removeProperty("padding-left");
          footers[fs].removeAttribute("data-sbt-footershift");
        }
        var shifted = document.querySelectorAll("[data-sbt-rowshift]");
        for (var sh = 0; sh < shifted.length; sh += 1) {
          shifted[sh].style.removeProperty("padding-inline-start");
          shifted[sh].removeAttribute("data-sbt-rowshift");
        }
        var wsAll = document.querySelectorAll("[" + WSHEADER_ATTR + "],[" + WSLABEL_ATTR + "],[" + WSACTIONS_ATTR + "]");
        for (var wsi = 0; wsi < wsAll.length; wsi += 1) {
          wsAll[wsi].removeAttribute(WSHEADER_ATTR);
          wsAll[wsi].removeAttribute(WSLABEL_ATTR);
          wsAll[wsi].removeAttribute(WSACTIONS_ATTR);
          wsAll[wsi].style.removeProperty("margin-left");
        }
        var nolines = document.querySelectorAll("[data-sbt-noline]");
        for (var nl = 0; nl < nolines.length; nl += 1) nolines[nl].removeAttribute("data-sbt-noline");
        var narrows = document.querySelectorAll("[data-sbt-narrows]");
        for (var nr = 0; nr < narrows.length; nr += 1) narrows[nr].removeAttribute("data-sbt-narrows");
        var strips = document.querySelectorAll("[data-sbt-hide]");
        for (var si = 0; si < strips.length; si += 1) strips[si].removeAttribute("data-sbt-hide");
        var hdr = document.querySelector("[data-sbt-header]");
        if (hdr !== null) {
          hdr.removeAttribute(HEADER_ATTR);
          hdr.style.removeProperty("--sbt-tabs-left");
          var staleTabs = hdr.querySelectorAll("[" + TABS_ATTR + "]");
          for (var sti = 0; sti < staleTabs.length; sti += 1) staleTabs[sti].removeAttribute(TABS_ATTR);
        }
        var trails = document.querySelectorAll("[" + TRAIL_ATTR + "]");
        for (var n = 0; n < trails.length; n += 1) trails[n].removeAttribute(TRAIL_ATTR);
        var scrollers = document.querySelectorAll("[" + SCROLL_ATTR + "]");
        for (var p = 0; p < scrollers.length; p += 1) scrollers[p].removeAttribute(SCROLL_ATTR);
        if (thumb !== null) {
          thumb.remove();
          thumb = null;
        }
        if (thumbTimer !== 0) {
          window.clearTimeout(thumbTimer);
          thumbTimer = 0;
        }
        audioOn = false;
        if (audioTimer !== 0) {
          window.clearTimeout(audioTimer);
          audioTimer = 0;
        }
        clearAudio();
      } catch {
        /* restoring best-effort is still better than throwing on unload */
      }
    }

    /**
     * The rules the switches need. Colours come from theme tokens, never literals.
     *
     * The opaque sidebar paints with `--dsw-alias-bg-base`, not
     * `--dsw-specific-sidebar-fill`: those are two different tokens (#fff vs
     * #f9fafb in light, #151517 vs #1b1b1c in dark), and side by side the
     * difference reads as a seam. Matching the content column is the point of
     * the switch.
     */
    var CSS = [
      'html[' + OPAQUE_ATTR + '] [' + COLUMN_ATTR + ']{',
      "  background: var(--dsw-alias-bg-base) !important;",
      "  border-right-color: transparent !important;",
      "}",
      '[' + TRAIL_ATTR + ']{right:auto !important;left:12px !important}',
      // The hover card is a `role=tooltip` child positioned to the rail's LEFT
      // (`right: calc(100% + 10px)`). Once the rail sits on the left edge that
      // puts the card off-screen, so flip it to the right side.
      "[" + TRAIL_ATTR + "]>[role=\"tooltip\"]{right:auto !important;left:calc(100% + 10px) !important}",
      // Collapse button: invisible until the pointer is inside the sidebar.
      "[" + TOGGLE_ATTR + "]{opacity:0 !important}",
      '[' + TOGGLE_ATTR + ']:hover,[' + TOGGLE_ATTR + ']:focus-visible{opacity:1 !important}',
      "[" + TABS_ATTR + "][data-sbt-hide]{display:none !important}",
      '[data-sbt-noline]{border-bottom:0 !important}',
      '[data-sbt-narrows]{min-height:0 !important;grid-template-rows:auto !important}', 
      // The section's three buttons stay invisible until the header is hovered,
      // so the sidebar reads as a plain list.
      "[" + WSACTIONS_ATTR + "] button{opacity:0 !important;pointer-events:none !important}",
      "[" + WSACTIONS_ATTR + "]:hover button,[" + WSACTIONS_ATTR + "]:focus-within button{opacity:1 !important;pointer-events:auto !important}",
      '[data-sbt-noline]{border-bottom:0 !important}',
      "[" + SEAM_ATTR + "]{position:fixed;display:none;height:7px;pointer-events:none;z-index:6;",
      "  -webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px)}",
      "[" + SEAM_ATTR + "][data-sbt-show]{display:block;",
      "  -webkit-mask-image:linear-gradient(to bottom,black 0%,black 55%,transparent 100%);",
      "  mask-image:linear-gradient(to bottom,black 0%,black 55%,transparent 100%)}",
      '[' + SCROLL_ATTR + ']{scrollbar-width:none !important}',
      '[' + SCROLL_ATTR + ']::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important}',
      // The turn rail's tick is a ::before scaled on X from its right edge.
      // While audio drives it, the length comes from --sbt-level instead.
      "nav[" + KEYS_ATTR + "] button[data-index]::before{",
      "  transform:translateY(-50%) scaleX(var(--sbt-level,.2)) !important;",
        // `--dsw-alias-brand-primary` is the near-black button fill; the equaliser
  // wants the blue accent instead.
"  background:var(--dsw-alias-state-business-primary,#4176e6) !important;",
      "  opacity:1 !important;",
      "  transition:transform .07s linear, background-color .2s ease !important;",
      "}",
      ".sbt-thumb{position:fixed;z-index:70;width:8px;border-radius:4px;background:var(--dsw-alias-scrollbar-bg-l2,rgba(120,120,120,.45));opacity:0;transition:opacity .18s ease;pointer-events:none}",
      ".sbt-thumb[data-sbt-show]{opacity:1}",
      // Match the add button's footprint so the whole tool row centres evenly.
      // One header row: the grid becomes a flex row, the divider goes, and the
      // tab strip sits to the right of the title cluster.
      // The shell nudges the 34px button up by 2px; that nudge is wrong once
      // the button is 28px, and it is what made the row look uneven.
      "[" + SEND_ATTR + "]{width:28px !important;height:28px !important;min-width:28px !important;border-radius:999px !important;transform:none !important}",
      "[" + SEND_ATTR + "] svg{width:14px !important;height:14px !important}",
      // The section title matches the settings nav's label size and sits on the
      // same line as the first nav item instead of towering above it.
      ".sbt-page{display:flex;flex-direction:column;max-width:640px;padding:19px 0 24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
      ".sbt-title{margin:0 0 10px;font-size:14px;line-height:22px;font-weight:600}",
      ".sbt-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
      ".sbt-row:last-child{border-bottom:none}",
      ".sbt-text{min-width:0}",
      ".sbt-label{font-weight:500}",
      ".sbt-desc{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
    ].join("\n");

    /**
     * The settings page.
     *
     * Uses the shell's own `Switch` when the primitives package resolves, and a
     * plain checkbox when it does not. A missing primitive must not blank the
     * page.
     */
    function SettingsPage({ t, prefs }) {
      var valueState = React.useState(function () {
        return prefs.get();
      });
      var value = valueState[0];
      var setValue = valueState[1];

      React.useEffect(function () {
        return prefs.subscribe(function () {
          setValue(prefs.get());
        });
      }, [prefs]);

      var Switch = null;
      try {
        Switch = require("@deepseek-ai/dsh-client-ui-primitives").Switch || null;
      } catch {
        Switch = null;
      }

      var row = function (key, labelKey, descKey) {
        var checked = value[key] === true;
        var toggle = function () {
          prefs.set(key, !checked);
        };
        var control = Switch === null
          ? h("input", {
              key: "input",
              type: "checkbox",
              checked: checked,
              "aria-label": t(labelKey),
              onChange: toggle,
            })
          : h(Switch, { key: "switch", checked: checked, onChange: toggle, label: t(labelKey) });
        return h("div", { className: "sbt-row", key: key },
          h("div", { className: "sbt-text" },
            h("div", { className: "sbt-label" }, t(labelKey)),
            h("div", { className: "sbt-desc" }, t(descKey))),
          control);
      };

      return h("div", { className: "sbt-page" },
        h("h2", { className: "sbt-title" }, t("title")),
        row("trimBrand", "trimBrand", "trimBrandDesc"),
        row("hideNewSession", "hideNewSession", "hideNewSessionDesc"),
        row("opaqueSidebar", "opaqueSidebar", "opaqueSidebarDesc"),
        row("moveTrail", "moveTrail", "moveTrailDesc"),
        row("autoHideScrollbar", "autoHideScrollbar", "autoHideScrollbarDesc"),
        row("audioBars", "audioBars", "audioBarsDesc"),
        row("hoverToggle", "hoverToggle", "hoverToggleDesc"),
        row("showViewTabs", "showViewTabs", "showViewTabsDesc"),
        row("softSeam", "softSeam", "softSeamDesc"));
    }

    /** @param ctx - client root context. */
    function apply(ctx) {
      if (typeof document === "undefined") return;

      var prefs = readState();
      var listeners = new Set();
      var notify = function () {
        listeners.forEach(function (listener) {
          try {
            listener();
          } catch {
            /* one broken listener must not stop the others */
          }
        });
      };

      /** Reconcile the sidebar with the stored preferences. */
      var tidy = function () {
        // A throw here must never escape: it would take down the shell's
        // mutation handling and freeze the UI.
        try {
        var root = sidebarRoot();
        var svg = document.querySelector('[data-slot="sidebar.brand.name"] svg');
        if (prefs.trimBrand) {
          if (svg !== null) cropBadge(svg);
          alignBrand();
        }
        if (prefs.hideNewSession && root !== null) hideNewSession(root);
        applyOpaque(prefs.opaqueSidebar && root !== null);
        applyTrail(prefs.moveTrail);
        applyScrollbar(prefs.autoHideScrollbar);
        applyAudio(prefs.audioBars);
        tagSendButton();
        applyWorkspaceHeader();
        applyToggleHover(prefs.hoverToggle);
        applyViewTabs(prefs.showViewTabs);
        applySeam(prefs.softSeam && !prefs.showViewTabs);
        dropStrayFloaters();
        } catch {
          /* one failed pass must not stop the next one */
        }
      };

      var api = {
        get: function () {
          var snapshot = {};
          for (var i = 0; i < KEYS.length; i += 1) snapshot[KEYS[i]] = prefs[KEYS[i]];
          return snapshot;
        },
        set: function (key, next) {
          if (KEYS.indexOf(key) < 0) return;
          if (prefs[key] === next) return;
          prefs[key] = next === true;
          writeState(prefs);
          // Turning a switch off must undo its edit, so replay from a clean slate.
          restore();
          tidy();
          notify();
        },
        subscribe: function (listener) {
          listeners.add(listener);
          return function () {
            listeners.delete(listener);
          };
        },
      };

      ctx.effect(function () {
        var tagId = "dsh-fluut/styles.css";
        if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return function () {};
        var tag = document.createElement("style");
        tag.dataset.pluginCss = tagId;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      }, "sidebar-tidy: styles");

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "sidebar-tidy: dictionaries");

      ctx.effect(function () {
        var frame = 0;
        var scheduled = false;
        var observer = new MutationObserver(function () {
          if (scheduled) return;
          scheduled = true;
          frame = window.requestAnimationFrame(function () {
            scheduled = false;
            frame = 0;
            tidy();
          });
        });
        var onScroll = function (event) {
          if (prefs.autoHideScrollbar) flashThumb(event.target);
        };
        var onResize = function () {
          if (!prefs.autoHideScrollbar) return;
          applyScrollbar(true);
          updateThumb();
        };
        tidy();
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        return function () {
          observer.disconnect();
          document.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onResize);
          if (frame !== 0) window.cancelAnimationFrame(frame);
          restore();
        };
      }, "sidebar-tidy: apply");

      ctx.slots.inject("settings.section", function () {
        var t = ctx.locale.bind(NS);
        return ctx.slots.register({
          name: "settings.section",
          id: "sidebar-tidy",
          order: 30,
          label: function () {
            return t("nav");
          },
          locale: NS,
          inject: function () {
            return { prefs: api };
          },
        }, SettingsPage);
      });
    }

    exports.inject = ["slots", "locale"];
    exports.apply = apply;
    return module.exports;
  },
});
