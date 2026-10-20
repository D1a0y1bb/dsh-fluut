// Fluut 音频采样器（CoreAudio process tap）
//
// 用 CoreAudio 的 process tap 抓系统输出音频，算 7 段能量，每 50ms 打一行 JSON：
//   {"ok":true,"bands":[...],"cb":N}
// cb 是自上次输出以来收到的音频回调次数。
//
// 与 ScreenCaptureKit 版本相比：只采音频，不触发系统录屏/共享提示。

import Foundation
import CoreAudio
import AudioToolbox
import Accelerate

let bandCount = 7
let fftLog2: vDSP_Length = 10
let fftSize = 1 << Int(fftLog2)
let fftHalf = fftSize / 2

final class LevelState {
    let fftSetup: FFTSetup
    var window: [Float]
    var real: [Float]
    var imag: [Float]
    var samples: [Float]
    var magnitudes: [Float]
    var smoothed: [Float]
    var pending: [Float]
    var bands: [Float]
    var callbackCount: Int = 1
    var sampleRate: Double = 48000
    var lock = os_unfair_lock_s()

    init() {
        fftSetup = vDSP_create_fftsetup(fftLog2, FFTRadix(kFFTRadix2))!
        window = [Float](repeating: 0, count: fftSize)
        window.withUnsafeMutableBufferPointer { buffer in
            vDSP_hann_window(buffer.baseAddress!, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
        }
        real = [Float](repeating: 0, count: fftHalf)
        imag = [Float](repeating: 0, count: fftHalf)
        samples = [Float](repeating: 0, count: fftSize)
        magnitudes = [Float](repeating: 0, count: fftHalf)
        smoothed = [Float](repeating: 0, count: bandCount)
        pending = [Float](repeating: 0, count: bandCount)
        bands = [Float](repeating: 0, count: bandCount)
    }

    deinit {
        vDSP_destroy_fftsetup(fftSetup)
    }

    /// 把一块交织浮点样本算成 7 个对数频段的能量并平滑。
    func ingest(_ input: UnsafePointer<Float>, frames: Int) {
        let take = min(frames, fftSize)
        samples.withUnsafeMutableBufferPointer { sb in
            for i in 0..<take { sb[i] = input[i] }
            for i in take..<fftSize { sb[i] = 0 }
        }
        vDSP_vmul(samples, 1, window, 1, &samples, 1, vDSP_Length(fftSize))

        real.withUnsafeMutableBufferPointer { rb in
            imag.withUnsafeMutableBufferPointer { ib in
                var split = DSPSplitComplex(realp: rb.baseAddress!, imagp: ib.baseAddress!)
                samples.withUnsafeBufferPointer { sb in
                    sb.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: fftHalf) { cp in
                        vDSP_ctoz(cp, 2, &split, 1, vDSP_Length(fftHalf))
                    }
                }
                vDSP_fft_zrip(fftSetup, &split, 1, fftLog2, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(fftHalf))
            }
        }

        let nyquist = sampleRate / 2
        let lowF = 60.0
        let highF = min(12000.0, nyquist * 0.95)
        let norm = 1.0 / Float(fftSize)
        for b in 0..<bandCount {
            let f0 = lowF * pow(highF / lowF, Double(b) / Double(bandCount))
            let f1 = lowF * pow(highF / lowF, Double(b + 1) / Double(bandCount))
            let i0 = max(1, min(fftHalf - 1, Int(f0 / nyquist * Double(fftHalf))))
            let i1 = max(i0 + 1, min(fftHalf, Int(f1 / nyquist * Double(fftHalf))))
            var energy: Float = 0
            for i in i0..<i1 {
                let v = magnitudes[i] * norm
                energy += v * v
            }
            let rms = sqrt(energy / Float(i1 - i0))
            // 20*log10 后映射到 0..1：-70dB 以下算静音，-15dB 以上算满。
            let db = 20 * log10(max(rms, 1e-7))
            pending[b] = min(1, max(0, (db + 70) / 55))
        }

        os_unfair_lock_lock(&lock)
        for b in 0..<bandCount {
            smoothed[b] = max(pending[b] * 0.75, smoothed[b] * 0.85)
            bands[b] = smoothed[b]
        }
        callbackCount += 1
        os_unfair_lock_unlock(&lock)
    }
}

let state = LevelState()

/// C 回调：CoreAudio 把音频块交到这里。
func audioIOProc(
    _ device: AudioObjectID,
    _ now: UnsafePointer<AudioTimeStamp>,
    _ inputData: UnsafePointer<AudioBufferList>,
    _ inputTime: UnsafePointer<AudioTimeStamp>,
    _ outputData: UnsafeMutablePointer<AudioBufferList>,
    _ outputTime: UnsafePointer<AudioTimeStamp>,
    _ clientData: UnsafeMutableRawPointer?
) -> OSStatus {
    let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
    guard list.count > 0,
          let raw = list[0].mData,
          list[0].mDataByteSize > 0 else { return noErr }
    let frames = Int(list[0].mDataByteSize) / MemoryLayout<Float>.size
    state.ingest(raw.assumingMemoryBound(to: Float.self), frames: frames)
    return noErr
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    print("{\"ok\":false,\"bands\":[],\"cb\":0}")
    exit(1)
}

func propAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

// 1. 全局立体声 tap
let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
description.uuid = UUID()
description.name = "Fluut Audio Tap"
description.isPrivate = true
description.muteBehavior = .unmuted

var tapID = AudioObjectID(kAudioObjectUnknown)
var status = AudioHardwareCreateProcessTap(description, &tapID)
if status != noErr { fail("create tap failed: \(status)") }

// 2. tap 装进私有聚合设备
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

// 3. 读 tap 的采样率
var fmtAddr = propAddress(kAudioTapPropertyFormat)
var asbd = AudioStreamBasicDescription()
var fmtSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
if AudioObjectGetPropertyData(tapID, &fmtAddr, 0, nil, &fmtSize, &asbd) == noErr, asbd.mSampleRate > 0 {
    state.sampleRate = asbd.mSampleRate
}

// 4. 启动 IOProc
var procID: AudioDeviceIOProcID?
status = AudioDeviceCreateIOProcID(deviceID, audioIOProc, nil, &procID)
if status != noErr { fail("create ioproc failed: \(status)") }
status = AudioDeviceStart(deviceID, procID)
if status != noErr { fail("start failed: \(status)") }

// 5. 每 50ms 输出一行
let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
timer.schedule(deadline: .now(), repeating: 0.05)
timer.setEventHandler {
    os_unfair_lock_lock(&state.lock)
    let out = state.bands
    let cb = state.callbackCount
    state.callbackCount = 0
    os_unfair_lock_unlock(&state.lock)
    let list = out.map { String(format: "%.6f", $0) }.joined(separator: ",")
    print("{\"ok\":true,\"bands\":[\(list)],\"cb\":\(cb)")
    fflush(stdout)
}
timer.resume()

RunLoop.main.run()
