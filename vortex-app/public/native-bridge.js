/* Vortex SC — the native bridge.
 *
 * The app is one HTML file that has always run in a browser. Inside a WKWebView — which is what
 * an iOS app is — five things it does every day stop working, and four of the five stop SILENTLY:
 * no error, no console warning, nothing on screen. A coach taps "Print" and the paper never comes.
 *
 *   window.print()          does nothing. Session plans, meet programs, invoices.
 *   <a download> / blob:    does nothing. Every CSV and PDF export.
 *   window.open()           returns null unless the host implements WKUIDelegate. This is how
 *                           _openUrl() shows a child's document, so documents simply never open.
 *   navigator.share         unreliable across iOS versions in a webview.
 *   Web Push                does not exist in a WKWebView at all — see registerForApns below.
 *
 * This file patches the first four to call native code when native code is there, and changes
 * nothing at all in a normal browser. That last property is the point: the same proto.html is
 * served to Safari, Chrome, the Android TWA and the iOS app, and only one of them has Capacitor.
 *
 * Load it BEFORE the app so the patches are in place before the first tap.
 */
(function () {
  'use strict';

  var Cap = window.Capacitor;
  var native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  // Tell the app (and the staging banner, and support) what it is running inside.
  window.__vxNative = native;
  window.__vxPlatform = native ? ((Cap.getPlatform && Cap.getPlatform()) || 'native') : 'web';

  if (!native) return;   // a browser already does all of this correctly

  document.documentElement.setAttribute('data-vx-native', window.__vxPlatform);

  function plugin(name) {
    return (Cap.Plugins && Cap.Plugins[name]) || null;
  }

  // ---- print ---------------------------------------------------------------------------
  // The app builds a whole printable document as an HTML string and opens it in a new window,
  // then that window prints itself. Neither half works here, so the native side takes the HTML
  // and hands it to UIPrintInteractionController.
  var Printer = plugin('VxPrint');
  var webPrint = window.print && window.print.bind(window);
  window.print = function () {
    if (!Printer) return webPrint && webPrint();
    var html = '<!doctype html><html><head><meta charset="utf-8">'
      + (document.head ? document.head.innerHTML : '')
      + '</head><body>' + (document.body ? document.body.innerHTML : '') + '</body></html>';
    Printer.printHtml({ html: html, name: document.title || 'Vortex SC' });
  };
  // The app's own print path builds the document itself, so give it a direct door rather than
  // making it round-trip through a window it cannot open.
  window.__vxPrintHtml = function (title, html) {
    if (Printer) return Printer.printHtml({ html: html, name: title || 'Vortex SC' });
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  };

  // ---- saving a file -------------------------------------------------------------------
  // <a download> is inert here. Anything the app wants to hand over goes to the native share
  // sheet instead, which is the iOS way to save a file anyway: the user picks Files, Mail,
  // WhatsApp, wherever.
  var Files = plugin('VxFiles');
  window.__vxSaveFile = function (filename, data, mime) {
    if (!Files) return false;
    Files.save({ filename: filename || 'vortex.txt', data: String(data == null ? '' : data), mime: mime || 'text/plain' });
    return true;
  };

  // Catch the ordinary <a download> too, so exports written months ago keep working without
  // every one of them having to know this file exists.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (!a || !Files) return;
    var href = a.getAttribute('href') || '';
    if (!href) return;
    e.preventDefault();
    var name = a.getAttribute('download') || 'vortex';
    if (/^data:/i.test(href)) {
      var head = href.slice(5, href.indexOf(','));
      var mime = head.split(';')[0] || 'application/octet-stream';
      var body = href.slice(href.indexOf(',') + 1);
      var text = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
      Files.save({ filename: name, data: text, mime: mime });
    } else if (/^blob:/i.test(href)) {
      // A blob URL means nothing to native code, so read it here and send the bytes.
      fetch(href).then(function (r) { return r.blob(); }).then(function (b) {
        var fr = new FileReader();
        fr.onload = function () {
          var d = String(fr.result || '');
          Files.save({ filename: name, data: d.slice(d.indexOf(',') + 1), mime: b.type || 'application/octet-stream', base64: true });
        };
        fr.readAsDataURL(b);
      }).catch(function () {});
    } else {
      Files.openUrl({ url: new URL(href, location.href).href });
    }
  }, true);

  // ---- opening a link ------------------------------------------------------------------
  // window.open returning null is what makes a child's document "just not open". In-app links
  // stay in the app; anything external goes to SFSafariViewController, which is also what
  // Google requires for OAuth — an embedded webview gets disallowed_useragent (error 403).
  var Browser = plugin('Browser');
  var webOpen = window.open;
  window.open = function (url, name, features) {
    var u = String(url || '');
    if (!u || u === 'about:blank') return webOpen ? webOpen.call(window, url, name, features) : null;
    var abs;
    try { abs = new URL(u, location.href); } catch { return null; }
    if (abs.origin === location.origin) { location.assign(abs.href); return window; }
    if (Browser && Browser.open) { Browser.open({ url: abs.href, presentationStyle: 'popover' }); return window; }
    if (Files && Files.openUrl) { Files.openUrl({ url: abs.href }); return window; }
    return webOpen ? webOpen.call(window, url, name, features) : null;
  };

  // ---- sharing -------------------------------------------------------------------------
  var Share = plugin('Share');
  if (Share && Share.share) {
    navigator.share = function (data) {
      data = data || {};
      return Share.share({ title: data.title || '', text: data.text || '', url: data.url || '', dialogTitle: data.title || 'Share' });
    };
    navigator.canShare = function () { return true; };
  }

  // ---- notifications -------------------------------------------------------------------
  // Web Push does not exist in a WKWebView. The app's "Enable notifications" button calls
  // Notification.requestPermission and then pushManager.subscribe, and both are absent here, so
  // the button did nothing and said it had worked. Both are replaced by the APNs equivalents.
  var Push = plugin('PushNotifications');
  window.__vxApnsToken = null;

  window.__vxRegisterPush = function () {
    return new Promise(function (resolve) {
      if (!Push) return resolve({ ok: false, reason: 'not-available' });
      Push.addListener('registration', function (t) {
        window.__vxApnsToken = (t && t.value) || null;
        resolve({ ok: !!window.__vxApnsToken, token: window.__vxApnsToken });
      });
      Push.addListener('registrationError', function (err) {
        resolve({ ok: false, reason: (err && err.error) || 'registration-failed' });
      });
      Push.requestPermissions().then(function (res) {
        if (res && res.receive === 'granted') Push.register();
        else resolve({ ok: false, reason: 'denied' });
      }).catch(function () { resolve({ ok: false, reason: 'denied' }); });
    });
  };

  // Tapping a notification should land on the screen it is about, exactly as the service
  // worker's notificationclick handler does on the web.
  if (Push && Push.addListener) {
    Push.addListener('pushNotificationActionPerformed', function (a) {
      var url = a && a.notification && a.notification.data && a.notification.data.url;
      if (url && String(url).charAt(0) === '/') location.assign(url);
    });
  }

  // Stand-ins so code written for the browser does not throw here.
  if (typeof window.Notification === 'undefined') {
    window.Notification = { permission: 'default', requestPermission: function () {
      return window.__vxRegisterPush().then(function (r) { return r.ok ? 'granted' : 'denied'; });
    } };
  }

  // ---- keyboard and safe areas ----------------------------------------------------------
  // Without this the keyboard covers the field being typed into on the sign-in screen.
  var Keyboard = plugin('Keyboard');
  if (Keyboard && Keyboard.addListener) {
    Keyboard.addListener('keyboardWillShow', function (info) {
      document.documentElement.style.setProperty('--vx-keyboard', ((info && info.keyboardHeight) || 0) + 'px');
    });
    Keyboard.addListener('keyboardWillHide', function () {
      document.documentElement.style.setProperty('--vx-keyboard', '0px');
    });
  }
})();
