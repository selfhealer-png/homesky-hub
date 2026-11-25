import AuthenticationServices
import Capacitor
import EventKit
import Photos
import UIKit

/// What the app reads from the iPad itself, for the in-page Worker's `env.DEVICE` binding
/// (src/shared/device.ts, src/web/app/device.ts): the calendars and reminders set up on this iPad
/// (EventKit), Apple Photos albums including Shared Albums (PhotoKit), and the system sign-in
/// sheet used to connect Google. Read-only throughout: nothing here creates or changes anything.
@objc(HubNativePlugin)
public class HubNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "HubNativePlugin"
    public let jsName = "HubNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "access", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reminderLists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "events", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "albums", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "image", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
    ]

    private var store = EKEventStore()
    private var authSession: ASWebAuthenticationSession?

    // MARK: Access

    private func accessName(_ status: EKAuthorizationStatus) -> String {
        if #available(iOS 17.0, *) {
            switch status {
            case .fullAccess: return "granted"
            case .writeOnly: return "denied" // can add, can't read: no use to a display
            default: break
            }
        }
        switch status {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "notDetermined"
        }
    }

    private func photoAccessName(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "notDetermined"
        }
    }

    private func currentAccess(_ what: String) -> String {
        switch what {
        case "calendars": return accessName(EKEventStore.authorizationStatus(for: .event))
        case "reminders": return accessName(EKEventStore.authorizationStatus(for: .reminder))
        default: return photoAccessName(PHPhotoLibrary.authorizationStatus(for: .readWrite))
        }
    }

    @objc func access(_ call: CAPPluginCall) {
        call.resolve(["access": currentAccess(call.getString("what") ?? "")])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        let what = call.getString("what") ?? ""
        if what == "photos" {
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                call.resolve(["access": self.photoAccessName(status)])
            }
            return
        }
        let type: EKEntityType = what == "reminders" ? .reminder : .event
        let done: (Bool, Error?) -> Void = { _, _ in
            // A store made before access was given doesn't see anything: start a fresh one.
            self.store = EKEventStore()
            call.resolve(["access": self.currentAccess(what)])
        }
        if #available(iOS 17.0, *) {
            if type == .event { store.requestFullAccessToEvents(completion: done) } else { store.requestFullAccessToReminders(completion: done) }
        } else {
            store.requestAccess(to: type, completion: done)
        }
    }

    // MARK: Calendars and reminders

    private func hex(_ color: CGColor?) -> String {
        guard let c = color.flatMap({ UIColor(cgColor: $0) }) else { return "#2563FF" }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(max(0, min(1, r)) * 255), Int(max(0, min(1, g)) * 255), Int(max(0, min(1, b)) * 255))
    }

    private func describe(_ cals: [EKCalendar]) -> [[String: Any]] {
        cals.map { ["id": $0.calendarIdentifier, "title": $0.title, "color": hex($0.cgColor), "account": $0.source?.title ?? ""] }
    }

    @objc func calendars(_ call: CAPPluginCall) {
        call.resolve(["calendars": describe(store.calendars(for: .event))])
    }

    @objc func reminderLists(_ call: CAPPluginCall) {
        call.resolve(["lists": describe(store.calendars(for: .reminder))])
    }

    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        f.timeZone = TimeZone.current
        return f
    }()

    /// All-day events and due dates are plain local dates, the way the agenda feed has them.
    private func localDate(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private func parseDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    @objc func events(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        guard let from = parseDate(call.getString("from")), let to = parseDate(call.getString("to")) else {
            call.reject("from and to are required")
            return
        }
        let cals = ids.compactMap { store.calendar(withIdentifier: $0) }
        if cals.isEmpty { call.resolve(["events": []]); return }
        let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: cals))
        let out: [[String: Any]] = found.map { e in
            // Repeating events share one identifier: the start time tells the occurrences apart.
            var item: [String: Any] = [
                "id": "\(e.calendarItemIdentifier)@\(Int(e.startDate.timeIntervalSince1970))",
                "calendar": e.calendar.calendarIdentifier,
                "title": e.title ?? "",
                "allDay": e.isAllDay,
            ]
            if e.isAllDay {
                item["start"] = localDate(e.startDate)
                // EventKit ends an all-day event at 23:59:59 on its last day; the feed's end is the day after.
                item["end"] = localDate(e.endDate.addingTimeInterval(1))
            } else {
                item["start"] = isoFormatter.string(from: e.startDate)
                item["end"] = isoFormatter.string(from: e.endDate)
            }
            if let loc = e.location, !loc.isEmpty { item["location"] = loc }
            return item
        }
        call.resolve(["events": out])
    }

    @objc func reminders(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        let lists = ids.compactMap { store.calendar(withIdentifier: $0) }
        if lists.isEmpty { call.resolve(["reminders": []]); return }
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: lists)
        store.fetchReminders(matching: predicate) { found in
            let out: [[String: Any]] = (found ?? []).map { r in
                var item: [String: Any] = ["id": r.calendarItemIdentifier, "list": r.calendar.calendarIdentifier, "title": r.title ?? ""]
                if let due = r.dueDateComponents.flatMap({ Calendar.current.date(from: $0) }) { item["due"] = self.localDate(due) }
                return item
            }
            call.resolve(["reminders": out])
        }
    }

    // MARK: Photos

    private func imagesOnly(limit: Int = 0) -> PHFetchOptions {
        let o = PHFetchOptions()
        o.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        if limit > 0 { o.fetchLimit = limit }
        return o
    }

    @objc func albums(_ call: CAPPluginCall) {
        var out: [[String: Any]] = []
        let add: (PHAssetCollection) -> Void = { c in
            let count = PHAsset.fetchAssets(in: c, options: self.imagesOnly()).count
            if count == 0 { return }
            out.append(["id": c.localIdentifier, "title": c.localizedTitle ?? "Album", "count": count, "shared": c.assetCollectionSubtype == .albumCloudShared])
        }
        PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .smartAlbumFavorites, options: nil).enumerateObjects { c, _, _ in add(c) }
        PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil).enumerateObjects { c, _, _ in add(c) }
        call.resolve(["albums": out])
    }

    @objc func assets(_ call: CAPPluginCall) {
        guard let id = call.getString("album"),
              let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.resolve(["assets": []])
            return
        }
        var out: [[String: Any]] = []
        // The newest 500 are plenty for a frame that shows one every minute and a half.
        PHAsset.fetchAssets(in: album, options: imagesOnly(limit: 500)).enumerateObjects { a, _, _ in
            out.append([
                "id": a.localIdentifier,
                "width": a.pixelWidth,
                "height": a.pixelHeight,
                "taken": a.creationDate.map { self.isoFormatter.string(from: $0) as Any } ?? NSNull(),
            ])
        }
        call.resolve(["assets": out])
    }

    @objc func image(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.resolve(["data": NSNull()])
            return
        }
        let maxPx = CGFloat(call.getInt("maxPx") ?? 2048)
        let opts = PHImageRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.resizeMode = .fast
        opts.isNetworkAccessAllowed = true // "Optimise iPad Storage" keeps the full photos in iCloud
        opts.isSynchronous = false
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: maxPx, height: maxPx), contentMode: .aspectFit, options: opts) { img, info in
            if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
            guard let jpeg = img?.jpegData(compressionQuality: 0.85) else {
                call.resolve(["data": NSNull()])
                return
            }
            call.resolve(["data": jpeg.base64EncodedString()])
        }
    }

    // MARK: Sign-in sheet

    /// Opens Google's sign-in in the system sheet and returns the URL Google sends back to the app.
    @objc func authenticate(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), let scheme = call.getString("callbackScheme") else {
            call.reject("url and callbackScheme are required")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { back, error in
                self.authSession = nil
                if let back { call.resolve(["url": back.absoluteString]); return }
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { call.reject("cancelled"); return }
                call.reject(error?.localizedDescription ?? "Sign-in failed")
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() { call.reject("The sign-in sheet couldn't open") }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
