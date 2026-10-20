// dsh-audio-level — 系统音频频谱采样器
//
// 用 ScreenCaptureKit 抓系统输出音频，算 7 段能量，每 50ms 往 stdout 打一行 JSON：
//   {"ok":true,"bands":[0.1,...,0.9]}
//
// 权限被拒时打 {"ok":false,"reason":"permission"}，由宿主侧决定怎么提示。
import Foundation
import ScreenCaptureKit
import AVFoundation
import Accelerate

let BAND_COUNT = 7
let FLOOR_HZ: Float = 60
let CEIL_HZ: Float = 12000
let EMIT_INTERVAL: Double = 0.05

/// 每帧音频回调里累加的能量；主循环按固定节奏取走并清零。
final class Spectrum: NSObject, SCStreamOutput, @unchecked Sendable {
    private let lock = NSLock()
    private var pending = [Float](repeating: 0, count: BAND_COUNT)
    private var callbacks = 0
    private var sampleRate: Float = 44100
    private let bandEdges: [Float]

    override init() {
        // 对数分布的频段边界，人耳分辨率更均匀
        var edges: [Float] = []
        let logFloor = log2(FLOOR_HZ)
        let logCeil = log2(CEIL_HZ)
        for i in 0...BAND_COUNT {
            let t = Float(i) / Float(BAND_COUNT)
            edges.append(pow(2, logFloor + (logCeil - logFloor) * t))
        }
        bandEdges = edges
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        lock.lock(); callbacks += 1; lock.unlock()
        guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return }
        sampleRate = Float(asbd.mSampleRate)
        guard asbd.mFormatID == kAudioFormatLinearPCM else { return }

        // ScreenCaptureKit hands audio over as one interleaved Float32 block.
        // Reading it through CMBlockBuffer avoids the AudioBufferList sizing
        // dance (a stack ABL is too small for non-interleaved plans).
        guard let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length = 0
        var pointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            dataBuffer, atOffset: 0, lengthAtOffsetOut: nil,
            totalLengthOut: &length, dataPointerOut: &pointer)
        guard status == noErr, let raw = pointer else { return }
        let channels = max(1, Int(asbd.mChannelsPerFrame))
        let floats = length / MemoryLayout<Float>.size
        let frames = floats / channels
        guard frames > 64 else { return }
        let samples = UnsafeRawPointer(raw).assumingMemoryBound(to: Float.self)
        accumulate(samples: samples, count: frames)
    }

    /// 用自相关式的带能量估计：对每个频段做 Goertzel，省掉整段 FFT 的开销。
    private func accumulate(samples: UnsafePointer<Float>, count: Int) {
        let n = min(count, 2048)
        var local = [Float](repeating: 0, count: BAND_COUNT)
        for band in 0..<BAND_COUNT {
            let lo = bandEdges[band]
            let hi = bandEdges[band + 1]
            // 每段取 3 个探针频率，取最大响应，避免窄带信号漏检
            var best: Float = 0
            for probe in 0..<3 {
                let freq = lo + (hi - lo) * (Float(probe) + 0.5) / 3.0
                let omega = 2 * Float.pi * freq / sampleRate
                let coeff = 2 * cos(omega)
                var s0: Float = 0, s1: Float = 0, s2: Float = 0
                for i in 0..<n {
                    s0 = samples[i] + coeff * s1 - s2
                    s2 = s1
                    s1 = s0
                }
                let power = s1 * s1 + s2 * s2 - coeff * s1 * s2
                best = max(best, power)
            }
            // 归一化到 0..1：先开方压掉动态范围，再轻度放大，避免低段长期顶满。
            let magnitude = sqrt(max(0, best)) / Float(n)
            local[band] = min(1, powf(magnitude * 9, 0.55))
        }
        lock.lock()
        for i in 0..<BAND_COUNT { pending[i] = max(pending[i] * 0.75, local[i]) }
        lock.unlock()
    }

    /// How many audio buffers arrived since the previous call. Zero means the
    /// stream is alive but stalled, which the host uses as a restart signal.
    func takeCallbackDelta() -> Int {
        lock.lock()
        defer { lock.unlock() }
        let value = callbacks
        callbacks = 0
        return value
    }

    func take() -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        let out = pending.map { min(1, $0) }
        for i in 0..<BAND_COUNT { pending[i] *= 0.5 }
        return out
    }
}

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

let spectrum = Spectrum()

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            emit(["ok": false, "reason": "no-display"])
            exit(2)
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 44100
        config.channelCount = 2
        // 视频流是 SCStream 的必需品，压到最小成本
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(spectrum, type: .audio, sampleHandlerQueue: DispatchQueue(label: "audio", qos: .userInteractive))
        try await stream.startCapture()
        emit(["ok": true, "bands": [Float](repeating: 0, count: BAND_COUNT)])

        while true {
            try? await Task.sleep(nanoseconds: UInt64(EMIT_INTERVAL * 1_000_000_000))
            emit(["ok": true, "bands": spectrum.take(), "cb": spectrum.takeCallbackDelta()])
        }
    } catch {
        emit(["ok": false, "reason": "capture", "detail": String(describing: error)])
        exit(3)
    }
}

RunLoop.main.run()
