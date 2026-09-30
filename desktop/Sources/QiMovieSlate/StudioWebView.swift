import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor final class StudioWebView: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
    let view: WKWebView
    var origin: URL?
    var onStatus: ((String) -> Void)?
    var onRestoreSession: (() async throws -> Void)?
    private var destinations: [ObjectIdentifier: URL] = [:]
    private var activeSavePanel: NSSavePanel?
    private var activeSaveDownloadID: ObjectIdentifier?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        view = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "qiMoviSession")
        view.navigationDelegate = self; view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = false
        view.underPageBackgroundColor = NSColor(calibratedRed: 0.035, green: 0.043, blue: 0.052, alpha: 1)
    }

    private func isLocal(_ url: URL) -> Bool {
        guard let origin else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port && url.user == nil && url.password == nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // A single action from our own main frame; never accept a URL, token,
        // filesystem path, or instruction from web content.
        guard message.name == "qiMoviSession", message.frameInfo.isMainFrame,
              message.webView === view, let frameURL = message.frameInfo.request.url,
              isLocal(frameURL), let pageURL = view.url, isLocal(pageURL),
              let body = message.body as? [String: String], body == ["action": "restore"],
              let onRestoreSession else {
            replyHandler(nil, "Local session restoration is unavailable for this page."); return
        }
        Task {
            do { try await onRestoreSession(); replyHandler(true, nil) }
            catch { replyHandler(nil, "Access could not be restored. Keep this window open and check the local connection.") }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if isLocal(url) || (url.scheme == "blob" && url.absoluteString.hasPrefix("blob:\(origin?.absoluteString ?? "invalid")/")) {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } else {
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated && url.scheme == "https" { NSWorkspace.shared.open(url) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true
        decisionHandler(attachment || !response.canShowMIMEType ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onStatus?("Local workspace · Saved work stays on this Mac") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { onStatus?("Connection interrupted. Saved work remains on disk; use Reconnect.") }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let frameURL = frame.request.url, isLocal(frameURL) else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard activeSavePanel == nil, let window = view.window, window.attachedSheet == nil else {
            onStatus?("Finish or cancel the open dialog before requesting another export.")
            completionHandler(nil); return
        }
        let panel = NSSavePanel(); panel.nameFieldStringValue = (suggestedFilename as NSString).lastPathComponent
        panel.canCreateDirectories = true
        activeSavePanel = panel; activeSaveDownloadID = ObjectIdentifier(download)
        onStatus?("Choose where to save the export.")
        panel.beginSheetModal(for: window) { [weak self] result in
            if self?.activeSavePanel === panel {
                self?.activeSavePanel = nil; self?.activeSaveDownloadID = nil
            }
            guard result == .OK, let url = panel.url else {
                self?.onStatus?("Save cancelled. Your saved project remains on disk.")
                completionHandler(nil); return
            }
            // WKDownload writes a new file only; never silently replace an existing export.
            guard !FileManager.default.fileExists(atPath: url.path) else {
                self?.onStatus?("Choose a new filename to preserve the existing export."); completionHandler(nil); return
            }
            self?.destinations[ObjectIdentifier(download)] = url; completionHandler(url)
        }
    }
    func downloadDidFinish(_ download: WKDownload) {
        if let url = destinations.removeValue(forKey: ObjectIdentifier(download)) { onStatus?("Saved \(url.lastPathComponent)") }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let id = ObjectIdentifier(download)
        if activeSaveDownloadID == id { activeSavePanel?.cancel(nil) }
        destinations.removeValue(forKey: id)
        if (error as NSError).code == NSURLErrorCancelled {
            // A rejected duplicate must not replace the active sheet's status.
            if activeSavePanel == nil { onStatus?("Save cancelled. Your saved project remains on disk.") }
        } else { onStatus?("Export did not finish. Retry from the saved draft.") }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(request.url.map(isLocal) == true ? .allow : .cancel)
    }
}
