import ExpoModulesCore
import BackgroundTasks
import UIKit
import UserNotifications
import Darwin
import os

// Memory as iOS counts it against the app's limit (phys_footprint, what Xcode
// shows) and what is left before jetsam would kill the app.
private func memorySnapshot() -> [String: Any] {
  var info = task_vm_info_data_t()
  var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
  let status = withUnsafeMutablePointer(to: &info) {
    $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
    }
  }
  return ["footprintBytes": status == KERN_SUCCESS ? Double(info.phys_footprint) : NSNull(),
          "availableBytes": Double(os_proc_available_memory()),
          "thermalState": ProcessInfo.processInfo.thermalState.rawValue]
}

private enum ProcessingDiagnosticLog {
  private static let lock = NSLock()
  private static var entries: [[String: Any]] = []

  static func append(_ event: String, fields: [String: Any] = [:]) {
    var record = fields
    record["event"] = event
    record["timestampMs"] = Date().timeIntervalSince1970 * 1000
    lock.lock()
    defer { lock.unlock() }
    entries.append(record)
    if entries.count > 64 { entries.removeFirst(entries.count - 64) }
  }

  static func snapshot() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return entries
  }
}

private enum ProcessingTaskConfiguration {
  static var pattern: String? {
    guard let bundle = Bundle.main.bundleIdentifier, !bundle.isEmpty else { return nil }
    return "\(bundle).processing.*"
  }

  static var identifier: String? {
    guard let pattern else { return nil }
    return String(pattern.dropLast()) + "default"
  }

  static var status: String {
    guard let pattern else { return "missing-bundle-identifier" }
    let permitted = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] ?? []
    return permitted.contains(pattern) ? "configured" : "identifier-mismatch"
  }
}

public class NotatkiProcessingAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) { ProcessingLease.shared.register() }
    #endif
    return true
  }
}

public class NotatkiProcessingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotatkiProcessing")
    Events("onProcessingExpired")

    Function("getCapabilities") { () -> [String: Any] in
      var supported = false
      let configuration = ProcessingTaskConfiguration.status
      var gpu: Any = NSNull()
      var resources: Any = NSNull()
      var gpuUnavailableReason: Any = "unsupported-build"
      var registration = "unsupported-build"
      #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        let supportedResources = BGTaskScheduler.supportedResources
        gpu = supportedResources.contains(.gpu)
        resources = supportedResources.rawValue
        gpuUnavailableReason = NSNull()
        registration = ProcessingLease.shared.registrationStatus
        supported = configuration == "configured" && registration == "registered"
      } else {
        gpuUnavailableReason = "unsupported-system"
        registration = "unsupported-system"
      }
      #endif
      var hardware = utsname()
      uname(&hardware)
      let hardwareModel = withUnsafePointer(to: &hardware.machine) {
        String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self))
      }
      let os = ProcessInfo.processInfo.operatingSystemVersion
      return ["continuedProcessing": supported,
              "gpu": gpu,
              "gpuUnavailableReason": gpuUnavailableReason,
              "supportedResourcesRawValue": resources,
              "registrationStatus": registration,
              "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
              "configurationStatus": configuration,
              "taskIdentifierPattern": ProcessingTaskConfiguration.pattern ?? "",
              "osVersion": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
              "hardwareModel": hardwareModel,
              "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
              "appBuild": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
              "bundleIdentifier": Bundle.main.bundleIdentifier ?? ""]
    }

    Function("getLeaseDiagnostics") { ProcessingDiagnosticLog.snapshot() }

    Function("getMemory") { memorySnapshot() }

    AsyncFunction("begin") { (attempt: String, title: String, subtitle: String, promise: Promise) in
      #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        ProcessingLease.shared.begin(attempt: attempt, title: title, subtitle: subtitle, promise: promise) { [weak self] reason in
          self?.sendEvent("onProcessingExpired", ["attemptId": attempt, "reason": reason])
        }
        return
      }
      #endif
      promise.resolve(false)
    }.runOnQueue(.main)

    AsyncFunction("update") { (attempt: String, completed: Int, title: String, subtitle: String) in
      #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        ProcessingLease.shared.update(attempt: attempt, completed: completed, title: title, subtitle: subtitle)
      }
      #endif
    }.runOnQueue(.main)

    AsyncFunction("finish") { (attempt: String, success: Bool) in
      #if compiler(>=6.2)
      if #available(iOS 26.0, *) { ProcessingLease.shared.finish(attempt: attempt, success: success) }
      #endif
    }.runOnQueue(.main)

    AsyncFunction("requestNotifications") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
        if let error { promise.reject(error) } else { promise.resolve(granted) }
      }
    }
    AsyncFunction("notifyCompleted") { (identifier: String, title: String, body: String) in
      let center = UNUserNotificationCenter.current()
      center.getNotificationSettings { settings in
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // No note text is exposed on the lock screen.
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
      }
    }

    AsyncFunction("prepareProtectedFiles") { () throws in
      // Continue reading only after the phone has been unlocked once since boot.
      // Do not remove encryption or alter the user's backup policy.
      let manager = FileManager.default
      let roots = [manager.urls(for: .documentDirectory, in: .userDomainMask).first,
                   manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first]
      for root in roots.compactMap({ $0 }) where manager.fileExists(atPath: root.path) {
        try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: root.path)
        guard let files = manager.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { continue }
        for case let file as URL in files {
          if (try file.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == true { continue }
          try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file.path)
        }
      }
    }
  }
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
private final class ProcessingLease {
  static let shared = ProcessingLease()
  private var attempt: String?
  private var identifier: String?
  private var task: BGContinuedProcessingTask?
  private var pending: Promise?
  private var onExpiration: ((String) -> Void)?
  private var thermalObserver: NSObjectProtocol?
  private var registered = false
  private var registrationAttempted = false
  private var identifierRetired = false
  private var requestSubmitted = false
  private var expiring = false
  private let registrationStatusLock = NSLock()
  private var registrationSnapshot = "registration-failed"

  var registrationStatus: String {
    if ProcessingTaskConfiguration.status != "configured" { return "not-configured" }
    // Sync capabilities runs on JavaScriptActor; the lease itself stays on main.
    registrationStatusLock.lock()
    defer { registrationStatusLock.unlock() }
    return registrationSnapshot
  }

  private func publishRegistrationStatus(_ status: String) {
    registrationStatusLock.lock()
    defer { registrationStatusLock.unlock() }
    registrationSnapshot = status
  }

  func register() {
    // Re-signing may change CFBundleIdentifier without updating the permitted
    // task patterns. Fail closed and expose that mismatch before registration.
    guard !registrationAttempted, ProcessingTaskConfiguration.status == "configured",
          let identifier = ProcessingTaskConfiguration.identifier else { return }
    // The wildcard permits concrete identifiers; it is not a launch handler.
    // Keep one handler for the single concurrent lease, even if registration fails.
    registrationAttempted = true
    registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] received in
      guard let self, let attempt = self.attempt, self.identifier == received.identifier,
            self.task == nil,
            let received = received as? BGContinuedProcessingTask else {
        ProcessingDiagnosticLog.append("grant-discarded", fields: ["identifier": received.identifier])
        // A repeated callback for the owned object must not complete that lease.
        if self?.task !== received { received.setTaskCompleted(success: false) }
        return
      }
      self.task = received
      ProcessingDiagnosticLog.append("granted", fields: ["attemptId": attempt, "identifier": received.identifier,
                                                         "requiredResources": "default"])
      received.progress.totalUnitCount = 10000
      received.progress.completedUnitCount = 0
      received.expirationHandler = { [weak self] in
        DispatchQueue.main.async { self?.expire(attempt: attempt, reason: "system") }
      }
      self.thermalObserver = NotificationCenter.default.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        if ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue {
          self?.expire(attempt: attempt, reason: "thermal")
        }
      }
      self.pending?.resolve(true)
      self.pending = nil
    }
    publishRegistrationStatus(registered ? "registered" : "registration-failed")
    ProcessingDiagnosticLog.append("registration", fields: ["success": registered, "identifier": identifier])
  }

  func begin(attempt: String, title: String, subtitle: String, promise: Promise, expired: @escaping (String) -> Void) {
    let denied: String? = UIApplication.shared.applicationState != .active ? "app-not-active"
      : !registered ? "unregistered"
        : identifierRetired ? "identifier-retired"
          : self.attempt != nil ? "lease-busy"
            : ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue ? "thermal" : nil
    guard denied == nil else {
      ProcessingDiagnosticLog.append("begin-denied", fields: ["attemptId": attempt, "reason": denied ?? "unknown"])
      promise.resolve(false)
      return
    }
    guard let identifier = ProcessingTaskConfiguration.identifier else { promise.resolve(false); return }
    self.attempt = attempt
    self.identifier = identifier
    self.pending = promise
    self.onExpiration = expired
    self.requestSubmitted = false
    self.expiring = false
    let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
    request.strategy = .fail
    // CPU only. No GPU entitlement is requested or presumed available.
    ProcessingDiagnosticLog.append("requested", fields: ["attemptId": attempt, "identifier": identifier,
                                                         "requiredResources": "default"])
    do {
      try BGTaskScheduler.shared.submit(request)
      requestSubmitted = true
      ProcessingDiagnosticLog.append("submitted", fields: ["attemptId": attempt])
    } catch {
      let failure = error as NSError
      ProcessingDiagnosticLog.append("submission-failed", fields: ["attemptId": attempt,
        "errorDomain": failure.domain, "errorCode": failure.code])
      finish(attempt: attempt, success: false)
      return
    }
    // submit() is not a grant. A late callback after timeout is rejected above.
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
      guard let self, self.attempt == attempt, self.task == nil else { return }
      ProcessingDiagnosticLog.append("grant-timeout", fields: ["attemptId": attempt])
      self.finish(attempt: attempt, success: false)
    }
  }

  func update(attempt: String, completed: Int, title: String, subtitle: String) {
    guard self.attempt == attempt, let task else { return }
    task.progress.completedUnitCount = max(task.progress.completedUnitCount, Int64(min(9999, max(0, completed))))
    task.updateTitle(title, subtitle: subtitle)
  }

  private func expire(attempt: String, reason: String) {
    guard self.attempt == attempt, !expiring else { return }
    expiring = true
    ProcessingDiagnosticLog.append("expired", fields: ["attemptId": attempt, "reason": reason])
    onExpiration?(reason)
    // JS acknowledges only after the native generation drains and the paused
    // attempt is persisted. Completing immediately can suspend that cleanup.
    // The OS may still revoke time; bounded fallback avoids a stranded task.
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
      guard let self, self.attempt == attempt, self.expiring else { return }
      self.finish(attempt: attempt, success: false)
    }
  }

  func finish(attempt: String, success: Bool) {
    guard self.attempt == attempt else { return }
    if task == nil && requestSubmitted {
      // cancel() does not acknowledge that a pending launch handler has drained.
      // Reusing this ID could attach that old grant to a new attempt. Retire it
      // until relaunch; granted tasks may continue to reuse the handler normally.
      identifierRetired = true
      publishRegistrationStatus("identifier-retired")
      ProcessingDiagnosticLog.append("identifier-retired", fields: ["attemptId": attempt,
        "identifier": identifier ?? "", "reason": "cancelled-before-grant", "recovery": "app-relaunch"])
    }
    ProcessingDiagnosticLog.append("finished", fields: ["attemptId": attempt, "success": success && !expiring])
    if let task {
      if success && !expiring { task.progress.completedUnitCount = task.progress.totalUnitCount }
      task.setTaskCompleted(success: success && !expiring)
    }
    if let identifier {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }
    if let thermalObserver { NotificationCenter.default.removeObserver(thermalObserver) }
    pending?.resolve(false)
    pending = nil
    thermalObserver = nil
    task = nil
    identifier = nil
    requestSubmitted = false
    onExpiration = nil
    expiring = false
    self.attempt = nil
  }
}
#endif
