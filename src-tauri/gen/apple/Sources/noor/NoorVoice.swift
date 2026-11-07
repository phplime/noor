// Spoken notifications (iPhone).
//
// iOS runs no app code when a local notification fires, so Noor can't speak at that moment.
// Instead it renders each notification text to a short audio file ahead of time with the
// built-in voices, saves it in Library/Sounds, and uses it as that notification's sound.
// Rust calls this class by name from a background thread (src/ios_voice.rs).
import AVFoundation
import Foundation

@objc(NoorVoice)
final class NoorVoice: NSObject {

    /// The best installed voice for "bn" or "en".
    private static func voice(_ lang: String) -> AVSpeechSynthesisVoice? {
        let all = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix(lang) }
        let preferred = lang == "en" ? ["en-US", "en-GB", "en-IN"] : ["bn-BD", "bn-IN"]
        let ranked = all.sorted { a, b in
            if a.quality != b.quality { return a.quality.rawValue > b.quality.rawValue }
            let ia = preferred.firstIndex(of: a.language) ?? 99
            let ib = preferred.firstIndex(of: b.language) ?? 99
            return ia < ib
        }
        return ranked.first
    }

    /// `{"bn":true,"en":true}`: which languages have a voice on this iPhone.
    @objc static func voicesJSON() -> String {
        let bn = voice("bn") != nil
        let en = voice("en") != nil
        return "{\"bn\":\(bn),\"en\":\(en)}"
    }

    /// Render `text` in `lang` ("bn" | "en") to a 16-bit PCM .caf at `path`. Returns success.
    @objc(renderText:lang:path:)
    static func render(_ text: String, lang: String, path: String) -> Bool {
        guard let v = voice(lang) else { return false }
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: url)

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = v
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        utterance.preUtteranceDelay = 0.15
        utterance.postUtteranceDelay = 0.3

        let synth = AVSpeechSynthesizer()
        let lock = NSLock()
        var file: AVAudioFile?
        var frames: AVAudioFramePosition = 0
        var finished = false
        let done = DispatchSemaphore(value: 0)

        synth.write(utterance) { buffer in
            lock.lock()
            defer { lock.unlock() }
            guard !finished, let pcm = buffer as? AVAudioPCMBuffer else { return }
            if pcm.frameLength == 0 {
                finished = true
                done.signal()
                return
            }
            do {
                if file == nil {
                    let settings: [String: Any] = [
                        AVFormatIDKey: kAudioFormatLinearPCM,
                        AVSampleRateKey: pcm.format.sampleRate,
                        AVNumberOfChannelsKey: pcm.format.channelCount,
                        AVLinearPCMBitDepthKey: 16,
                        AVLinearPCMIsFloatKey: false,
                        AVLinearPCMIsBigEndianKey: false,
                    ]
                    file = try AVAudioFile(forWriting: url, settings: settings,
                                           commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
                }
                try file?.write(from: pcm)
                frames += AVAudioFramePosition(pcm.frameLength)
            } catch {
                finished = true
                done.signal()
            }
        }
        // Some iOS versions never send the final empty buffer: give up waiting after 20 s.
        _ = done.wait(timeout: .now() + 20)
        lock.lock()
        finished = true
        let ok = frames > 0
        file = nil // closes the file
        lock.unlock()
        _ = synth // keep alive until here
        if !ok { try? FileManager.default.removeItem(at: url) }
        return ok
    }
}
