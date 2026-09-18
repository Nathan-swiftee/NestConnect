import 'dart:io';

/// Which kind of phone this is, for the push registration.
///
/// macOS counts as iOS because that is what its push tokens are: an APNs
/// address reached through the same Firebase project, and a separate value
/// would only be a third case for the server to have an opinion about.
String defaultPushPlatform() {
  if (Platform.isIOS || Platform.isMacOS) return 'ios';
  if (Platform.isAndroid) return 'android';
  return 'web';
}
