#if TESTER_REPORT
import AVFoundation
import Speech

/// Tester tooling (#61). On-device dictation only: if this device cannot recognise speech on the device,
/// there is no transcript and the tester types the note. Audio never leaves the phone.
/// All work runs on its own queue, off the main thread.
final class TesterDictation: @unchecked Sendable {
    private let work = DispatchQueue(label: "presence.tester-dictation")
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var running = false

    /// Starts listening. `heard` is called on the main actor with the transcript so far.
    func start(heard: @escaping @MainActor @Sendable (String) -> Void) {
        work.async { [self] in
            running = true
            SFSpeechRecognizer.requestAuthorization { status in
                guard status == .authorized else { return }
                AVAudioApplication.requestRecordPermission { granted in
                    guard granted else { return }
                    self.work.async { self.begin(heard: heard) }
                }
            }
        }
    }

    func stop() {
        work.async { [self] in
            running = false
            engine?.stop()
            engine?.inputNode.removeTap(onBus: 0)
            request?.endAudio()
            engine = nil
            request = nil
            // The task delivers its final result, then ends; it is released on its next callback.
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func begin(heard: @escaping @MainActor @Sendable (String) -> Void) {
        guard running, engine == nil,
              let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(),
              recognizer.isAvailable, recognizer.supportsOnDeviceRecognition
        else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        let engine = AVAudioEngine()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            nonisolated(unsafe) let sink = request
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in sink.append(buffer) }
            engine.prepare()
            try engine.start()
        } catch {
            return
        }
        self.engine = engine
        self.request = request
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            if let text = result?.bestTranscription.formattedString {
                Task { @MainActor in heard(text) }
            }
            if error != nil || result?.isFinal == true {
                self?.work.async { self?.task = nil }
            }
        }
    }
}
#endif
