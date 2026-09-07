// Semgrep fixture (POSITIVE): writes into the App Group container without
// excluding the file from backup and without an explicit protection class, so
// `kiko-appgroup-write-needs-protection` MUST report a finding. Never "fix"
// this file.
import Foundation

enum FixtureBadContainerWriter {
    static func persist(_ payload: String) throws {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.example.fixture"
            )
        else {
            return
        }

        let fileURL = containerURL.appendingPathComponent("fixture.json")
        try payload.write(to: fileURL, atomically: true, encoding: .utf8)
    }
}
