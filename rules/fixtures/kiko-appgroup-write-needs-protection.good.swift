// Semgrep fixture (NEGATIVE): the same write, correctly hardened — the file is
// excluded from backup and given an explicit protection class after every
// write. `kiko-appgroup-write-needs-protection` MUST report nothing here.
import Foundation

enum FixtureGoodContainerWriter {
    static func persist(_ payload: String) throws {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.example.fixture"
            )
        else {
            return
        }

        var fileURL = containerURL.appendingPathComponent("fixture.json")
        try payload.write(to: fileURL, atomically: true, encoding: .utf8)

        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: fileURL.path
        )

        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try fileURL.setResourceValues(values)
    }
}
