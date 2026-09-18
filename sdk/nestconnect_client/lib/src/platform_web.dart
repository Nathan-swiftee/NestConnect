/// A browser. Not the user agent's idea of the platform — an iPhone running
/// Flutter web has no APNs token and is not reachable the way an installed app
/// is, so calling it "ios" would file it under an address it does not have.
String defaultPushPlatform() => 'web';
