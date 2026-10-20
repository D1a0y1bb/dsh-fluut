// Fluut 音频采样器（CoreAudio process tap 版）
//
// 用 CoreAudio 的 process tap 抓系统输出音频，算 7 段能量，每 50ms 往 stdout 打一行 JSON：
//   {"ok":true,"bands":[...],"cb":N}
// cb 是自上次输出以来收到的音频回调次数，宿主用它判断流是否卡死。
//
// 与旧的 ScreenCaptureKit 版本相比：只采音频，不触发 macOS 的录屏/共享提示。

import Foundation
import CoreAudio
import AudioToolbox
import Accelerate

let bandCount = 7
let frameInterval: Double = 0.05

final class LevelState {
    var bands = [Float](repeating: 0, count: bandCount)
    var callbackCount = 1
    var lock = os_unfair_lock_s()
}

let state = LevelState()

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

/// 读 tap 的流格式。
func tapFormat(_ tapID: AudioObjectID) -> AudioStreamBasicDescription? {
    var addr = address(kAudioTapPropertyFormat)
    var asbd = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    let status = AudioObjectGetPropertyData(tapID, &addr, 0, nil, &size, &asbd)
    return status == noErr ? asbd : nil
}

/// 建立 IOProc，把回调里的浮点样本按 7 个对数频段算能量。
func makeIOBlock(_ sampleRate: Double) -> AudioDeviceIOBlock {
    let log2n = vDSP_Length(9)                 // 512 点
    let fftSize = 1 << Int(log2n)
    let half = fftSize / 2
    let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
    let window = [Float](repeating: 0, count: fftSize)
    vDSP_hann_window(UnsafeMutablePointer(mutating: window), vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))

    var real = [Float](repeating: 0, count: half)
    var imag = [Float](repeating: 0, count: half)
    var samples = [Float](repeating: 0, count: fftSize)
    var magnitudes = [Float](repeating: 0, count: half)
    var pending = [Float](repeating: 0, count: bandCount)
    var smoothed = [Float](repeating: 0, count: bandCount)

    return { _, _, inputData, _, _, _ in
        guard let list = inputData else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
        guard buffers.count > 0, let raw = buffers[0].mData else { return }
        let frames = Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size
        guard frames > 0 else { return }
        let input = raw.assumingMemoryBound(to: Float.self)

        // 累积到 512 点再算 FFT，不足就保留到下次。
        var copied = 0
        while copied < frames {
            let take = min(frames - copied, fftSize)
            for i in 0..<take { samples[i] = input[copied + i] }
            for i in take..<fftSize { samples[i] = 0 }
            copied += take
            vDSP_vmul(samples, 1, window, 1, &samples, 1, vDSP_Length(fftSize))

            var splitR = DSPSplitComplex(realp: &real, imagp: &imag)
            samples.withUnsafeBufferPointer { sp in
                sp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) { cp in
                    vDSP_ctoz(cp, 2, &splitR, 1, vDSP_Length(half))
                }
            }
            vDSP_fft_zrip(setup, &splitR, 1, log2n, FFTDirection(FFT_FORWARD))
            vDSP_zvabs(&splitR, 1, &magnitudes, 1, vDSP_Length(half))

            // 7 个对数分布的频段，从 60Hz 到 12kHz。
            let nyquist = sampleRate / 2
            let lowF = 60.0
            let highF = min(12000.0, nyquist * 0.95)
            for b in 0..<bandCount {
                let f0 = lowF * pow(highF / lowF, Double(b) / Double(bandCount))
                let f1 = lowF * pow(highF / lowF, Double(b + 1) / Double(bandCount))
                let i0 = max(1, min(half - 1, Int(f0 / nyquist * Double(half))))
                let i1 = max(i0 + 1, min(half, Int(f1 / nyquist * Double(half))))
                var sum: Float = 0
                for i in i0..<i1 { sum += magnitudes[i] }
                let mean = sum / Float(i1 - i0)
                pending[b] = min(1, powf(mean * 9, 0.55))
            }
        }

        os_unfair_lock_lock(&state.lock)
        for b in 0..<bandCount {
            smoothed[b] = max(pending[b] * 0.75, smoothed[b] * 0.85)
            state.bands[b] = smoothed[b]
        }
        state.callbackCount += 1
        os_unfair_lock_unlock(&state.lock)
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    print("{\"ok\":false,\"bands\":[],\"cb\":0}")
    exit(1)
}

// 1. 建立全局立体声 tap（不排除任何进程）。
let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
description.uuid = UUID()
description.name = "Fluut Audio Tap"
description.isPrivate = true
description.muteBehavior = .unmuted

var tapID = AudioObjectID(kAudioObjectUnknown)
var status = AudioHardwareCreateProcessTap(description, &tapID)
if status != noErr { fail("create tap failed: \(status)") }

// 2. 把 tap 放进一个私有聚合设备。
let aggregate: [String: Any] = [
    kAudioAggregateDeviceNameKey as String: "Fluut Tap Device",
    kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
    kAudioAggregateDeviceIsPrivateKey as String: true,
    kAudioAggregateDeviceTapListKey as String: [
        [
            kAudioSubTapUIDKey as String: description.uuid.uuidString,
            kAudioSubTapDriftCompensationKey as String: true
        ]
    ]
]

var deviceID = AudioObjectID(kAudioObjectUnknown)
status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &deviceID)
if status != noErr { fail("create aggregate failed: \(status)") }

guard let asbd = tapFormat(tapID) else { fail("tap format unavailable") }
let sampleRate = asbd.mSampleRate > 0 ? asbd.mSampleRate : 48000

var procID: AudioDeviceIOProcID?
status = AudioDeviceCreateIOProcIDWithBlock(&procID, deviceID, nil, makeIOBlock(sampleRate))
if status != noErr { fail("create ioproc failed: \(status)") }

status = AudioDeviceStart(deviceID, procID)
if status != noErr { fail("start failed: \(status)") }

// 3. 每 50ms 打一行。
let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
timer.schedule(deadline: .now(), repeating: frameInterval)
timer.setEventHandler {
    os_unfair_lock_lock(&state.lock)
    let bands = state.bands
    let cb = state.callbackCount
    state.callbackCount = 0
    os_unfair_lock_unlock(&state.lock)
    let list = bands.map { String(format: "%.6f", $0) }.joined(separator: ",")
    print("{\"ok\":true,\"bands\":[\(list)],\"cb\":\(cb)")
    fflush(stdout)
}
timer.resume()

RunLoop.main.run()
