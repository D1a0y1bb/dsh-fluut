/**
 * dsh-sidebar-tidy — 宿主半边
 *
 * 除了一件事之外全是空逻辑：本插件有一个「音频跳动」开关，需要系统音频频谱。
 * 界面跑在渲染进程里，拿不到系统音频；所以这段代码负责两件事：
 *
 *   1. 拉起原生采样器 `native/audio-level`（ScreenCaptureKit，每 50ms 往 stdout 打一行 JSON）
 *   2. 在 127.0.0.1 上开一个极小的 HTTP 服务，把最新一帧频谱给界面轮询
 *
 * 走 HTTP 而不是 DSH 的 typert 通道，是因为 typert 是代码生成的类型化 RPC，
 * 插件侧要手写描述符；这里只要单向、高频、无鉴权的数据，HTTP 更直接。
 *
 * 三条纪律：
 *   1. apply() 绝不抛错 —— 采样器缺失、端口被占、权限被拒，都只是「没有数据」。
 *   2. 进程与端口都在 effect 的 dispose 里清理，卸载插件不留后台进程。
 *   3. 采样器每行 JSON 都要容错解析，坏行跳过，不影响下一行。
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, statSync, openSync, writeSync, readFileSync, closeSync, unlinkSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_ID = "dsh-sidebar-tidy";
/** Port the renderer polls. High and specific to avoid a collision. */
const PORT = Number(process.env.FLUUT_PORT ?? 47821);
/** A frame older than this is reported as stale so bars settle instead of freezing. */
const STALE_MS = 1200;

/** Files whose change should reload the page. */
function revisionOf() {
  try {
    const file = fileURLToPath(new URL("./client.js", import.meta.url));
    const stat = statSync(file);
    return `${stat.mtimeMs}-${stat.size}`;
  } catch {
    return "unknown";
  }
}

/** Path to the compiled sampler that ships next to this file. */
function helperPath() {
  return fileURLToPath(new URL("../native/audio-level", import.meta.url));
}

/**
 * Start the sampler and the level server.
 *
 * @param log - sink for one-off diagnostics.
 * @returns cleanup that stops both.
 */
/**
 * The bridge is process-wide state: the HTTP port and the sampler belong to the
 * process, not to one cordis row. A second initialisation would spawn a second
 * sampler and the two would kill each other's child, so only the first call
 * starts it.
 */
let bridgeStarted = false;

function startAudioBridge(log) {
  if (bridgeStarted) {
    log("音频桥已经启动，跳过重复初始化");
    return () => {};
  }
  bridgeStarted = true;
  const debugPath = fileURLToPath(new URL("../native/.host.log", import.meta.url));
  const trace = (message) => {
    try {
      appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`);
    } catch {
      /* tracing must never break the bridge */
    }
  };

  const binary = helperPath();
  if (!existsSync(binary)) log(`音频采样器不存在（${binary}），将持续重试；版本端点仍然可用`);

  let latest = { ok: false, reason: "starting", bands: [] };
  let latestAt = 0;
  let buffer = "";
  let child = null;
  let reported = "";

  /** Report the sampler's own complaint once; repeated lines would flood the log. */
  const note = (message) => {
    if (message === reported) return;
    reported = message;
    log(message);
  };

  let restarts = 0;
  /** True when this process owns the cross-process sampler lock. */
  let ownsLock = false;

  /** Path of the lock that keeps two DSH hosts from capturing at once. */
  const lockPath = () => fileURLToPath(new URL("../native/.sampler.pid", import.meta.url));

  /** True when a process with this id is still alive. */
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /** Take the lock, or report that another host already holds it. */
  const takeLock = () => {
    const file = lockPath();
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      ownsLock = true;
      return true;
    } catch {
      try {
        const held = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
        if (Number.isFinite(held) && held !== process.pid && alive(held)) return false;
        // Stale lock from a crash: take it over.
        const fd2 = openSync(file, "w");
        writeSync(fd2, String(process.pid));
        closeSync(fd2);
        ownsLock = true;
        return true;
      } catch {
        ownsLock = true;
        return true;
      }
    }
  };

  /** Release the lock if this process holds it. */
  const dropLock = () => {
    if (!ownsLock) return;
    ownsLock = false;
    try {
      unlinkSync(lockPath());
    } catch {
      /* already gone */
    }
  };
  /** Retry handle for when the sampler file is missing at launch time. */
  let retryTimer = 0;
  let restartTimer = 0;
  /** Frames in a row with no audio callback: the stream is alive but stalled. */
  let stalledFrames = 0;
  /** Wall clock of the last restart, used to rate-limit the watchdog. */
  let lastRestartAt = 0;

  /** Restart the sampler after an unexpected exit, but not in a tight loop. */
  const scheduleRestart = () => {
    if (restarts >= 5) {
      log("音频采样器反复退出，已停止重试；「音频琴键」不会有数据");
      return;
    }
    restarts += 1;
    if (restartTimer !== 0) return;
    restartTimer = setTimeout(() => {
      restartTimer = 0;
      launch();
    }, 3000);
  };

  const launch = () => {
  // Re-check on every launch: the file can appear or disappear while the app runs.
  if (!existsSync(binary)) {
    if (retryTimer === 0) {
      retryTimer = setTimeout(() => {
        retryTimer = 0;
        launch();
      }, 5000);
    }
    return;
  }
  try {
    // Two hosts each starting a sampler makes both capture silence, so only the
    // process holding the lock may spawn one.
    if (!takeLock()) {
      note("另一个 DSH 进程正在采集音频，本进程跳过采样器");
      return;
    }
    // Two samplers running at once make both capture silence, so clear any
    // leftover from a previous session before starting a fresh one.
    try {
      spawnSync("pkill", ["-f", binary], { stdio: "ignore" });
    } catch {
      /* pkill missing is not fatal */
    }
    child = spawn(binary, [], { stdio: ["ignore", "pipe", "pipe"] });
    trace(`spawn pid=${child.pid} stdout=${child.stdout !== null} stderr=${child.stderr !== null}`);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text.length > 0) note(`音频采样器: ${text.slice(0, 200)}`);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length > 0) {
          try {
            const frame = JSON.parse(line);

            if (Array.isArray(frame?.bands)) {
              latest = { ok: frame.ok !== false, bands: frame.bands };
              latestAt = Date.now();
              // A live stream delivers ~20 audio buffers per 50 ms frame. If
              // that drops to zero the capture is wedged even though the
              // process still runs, and only a fresh process recovers it.
              if (Number(frame.cb) > 0) {
                stalledFrames = 0;
              } else {
                stalledFrames += 1;
                if (stalledFrames > 60 && Date.now() - lastRestartAt > 5000) {
                  stalledFrames = 0;
                  lastRestartAt = Date.now();
                  note("音频采样流卡住，重启采样器");
                  try {
                    if (child !== null) child.kill("SIGKILL");
                  } catch {
                    /* already gone */
                  }
                }
              }
            } else if (frame?.ok === false) {
              latest = { ok: false, reason: String(frame.reason ?? "unknown"), bands: [] };
              note(`音频采样器未就绪 (${String(frame.reason ?? "unknown")})${frame.detail ? ": " + String(frame.detail).slice(0, 160) : ""}`);
            }
          } catch (error) {
            trace(`parse failed: ${String(error).slice(0, 120)} line=${line.slice(0, 40)}`);
          }
        }
        index = buffer.indexOf("\n");
      }
    });
    child.on("error", () => {
      latest = { ok: false, reason: "spawn", bands: [] };
    });
    child.on("exit", (code, signal) => {
      trace(`exit code=${code} signal=${signal}`);
      dropLock();
      child = null;
      latest = { ok: false, reason: "stopped", bands: [] };
      scheduleRestart();
    });
  } catch {
    log("音频采样器启动失败，「音频跳动」不会有数据");
    return () => {};
  }
  };

  launch();

  const server = createServer((request, response) => {
    if (request.url !== undefined && request.url.startsWith("/notify")) {
      // Renderer asks for a native banner. osascript keeps this out of the page
      // permission model, which a custom scheme cannot satisfy.
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        const title = (url.searchParams.get("title") ?? "DSH").slice(0, 80);
        const body = (url.searchParams.get("body") ?? "").slice(0, 240);
        const escape = (text) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        spawnSync("osascript", ["-e", `display notification "${escape(body)}" with title "${escape(title)}"`], { stdio: "ignore" });
      } catch {
        /* a failed banner must not break the bridge */
      }
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-private-network": "true" });
      response.end();
      return;
    }
    if (request.url !== undefined && request.url.startsWith("/rev")) {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-allow-private-network": "true",
      });
      response.end(JSON.stringify({ rev: revisionOf() }));
      return;
    }
    const stale = Date.now() - latestAt > STALE_MS;
    const payload = JSON.stringify({
      ok: latest.ok && !stale,
      reason: latest.reason,
      bands: stale ? [] : latest.bands,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      // The renderer runs on a custom scheme, so this is a cross-origin read.
      "access-control-allow-origin": "*",
      "access-control-allow-private-network": "true",
    });
    response.end(payload);
  });

  let listening = false;
  try {
    server.listen(PORT, "127.0.0.1", () => {
      listening = true;
    });
    server.on("error", () => {
      /* port busy: the renderer simply gets nothing */
    });
  } catch {
    /* nothing to clean up */
  }

  return () => {
    try {
      if (restartTimer !== 0) clearTimeout(restartTimer);
      restartTimer = 0;
      restarts = 99;
      if (child !== null) child.kill();
    } catch {
      /* already gone */
    }
    try {
      if (listening) server.close();
    } catch {
      /* already closed */
    }
  };
}

/**
 * @param ctx 宿主 cordis 上下文
 */
export function apply(ctx) {
  try {
    const candidate = ctx?.logger;
    const sink = typeof candidate === "function" ? candidate(PACKAGE_ID) : candidate;
    const log = (message) => {
      try {
        if (sink && typeof sink.info === "function") sink.info(`[${PACKAGE_ID}] ${message}`);
        else console.info(`[${PACKAGE_ID}] ${message}`);
      } catch {
        /* 连日志都不能抛 */
      }
    };
    if (typeof ctx?.effect === "function") {
      ctx.effect(() => startAudioBridge(log), "sidebar-tidy: audio bridge");
    } else {
      startAudioBridge(log);
    }
  } catch {
    /* 任何失败都只意味着没有频谱数据 */
  }
}

export default { apply };
